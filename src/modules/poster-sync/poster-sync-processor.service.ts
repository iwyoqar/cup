import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../../common/config/config.service';
import { PosterTransactionImportService } from '../poster-import/poster-transaction-import.service';
import { PosterService } from '../poster/poster.service';
import { PosterTransaction } from '../poster/poster.types';
import { PosterSyncRepository, WebhookEventRow } from './poster-sync.repository';

const BATCH = 25; // events claimed per tick (=> at most this many distinct Poster reads)
const LEASE_MS = 5 * 60 * 1000; // a PROCESSING event older than this belongs to a dead worker
const LINK_LOOKUPS = { lookbackDays: 3, max: 20 }; // the automatic path resolves CUP-order links narrowly (each import caches what it finds)
const NOT_FOUND_RETRIES = 3;

export type TickSummary =
  | { status: 'DISABLED' | 'BUSY' }
  | { status: 'RAN'; reclaimed: number; claimed: number; transactions: number; imported: number; deferred: number; failed: number; dead: number; outcomes: Record<string, number> };

// Delay before the nth failed attempt is retried: 30 s, 1 min, 2 min, ... capped at 30 min.
export const backoffMs = (attempts: number): number => Math.min(30 * 60 * 1000, 30_000 * 2 ** Math.max(0, attempts - 1));

// Phase 20 — the background processor. A webhook only says "transaction N changed"; the CANONICAL transaction is re-read from Poster (dash.getTransaction,
// read-only) and handed to the Phase 19 import engine (PosterTransactionImportService.importTransactions = the same classification and the same atomic,
// idempotent writes as the reviewed import). Events for the same transaction are coalesced into one read. It is restart-safe (rows are a durable queue with a
// lease), retry-safe (exponential backoff, then DEAD and visible), duplicate-safe (the Poster transaction id is unique in CUP) and does nothing at all while
// POSTER_SYNC_ENABLED is off.
@Injectable()
export class PosterSyncProcessorService {
  private readonly logger = new Logger(PosterSyncProcessorService.name);
  private running = false;
  private kickTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly repository: PosterSyncRepository,
    private readonly poster: PosterService,
    private readonly importer: PosterTransactionImportService,
    private readonly config: ConfigService,
  ) {}

  // Called by the receiver after an event is committed: schedules ONE tick shortly (bursts coalesce). Never awaited, never throws.
  kick(): void {
    if (!this.config.env.POSTER_SYNC_ENABLED || this.kickTimer) return;
    this.kickTimer = setTimeout(() => {
      this.kickTimer = null;
      void this.tick();
    }, 750);
    this.kickTimer.unref?.();
  }

  async tick(now: Date = new Date()): Promise<TickSummary> {
    if (!this.config.env.POSTER_SYNC_ENABLED) return { status: 'DISABLED' };
    if (this.running) return { status: 'BUSY' };
    this.running = true;
    try {
      return await this.process(now);
    } catch (err) {
      this.logger.error(`Poster sync tick failed: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`);
      return { status: 'RAN', reclaimed: 0, claimed: 0, transactions: 0, imported: 0, deferred: 0, failed: 0, dead: 0, outcomes: {} };
    } finally {
      this.running = false;
    }
  }

  private async process(now: Date): Promise<TickSummary> {
    const reclaimed = await this.repository.reclaimStale(now, LEASE_MS);
    const claimed = await this.repository.claimDue(now, BATCH);
    const summary = { status: 'RAN' as const, reclaimed, claimed: claimed.length, transactions: 0, imported: 0, deferred: 0, failed: 0, dead: 0, outcomes: {} as Record<string, number> };
    if (claimed.length === 0) return summary;

    // Coalesce: every event about the same transaction is satisfied by ONE canonical read.
    const groups = new Map<string, WebhookEventRow[]>();
    for (const e of claimed) groups.set(e.objectId, [...(groups.get(e.objectId) ?? []), e]);
    summary.transactions = groups.size;

    let posterDown = false;
    for (const [transactionId, events] of groups) {
      const ids = events.map((e) => e.id);
      if (posterDown) {
        // Poster already failed in this tick: do not burn a 10 s timeout per remaining transaction. Put them back untouched (no failed attempt).
        await this.repository.release(ids, new Date(now.getTime() + 30_000), null);
        summary.deferred += ids.length;
        continue;
      }
      try {
        const raw = await this.poster.getTransactionById(transactionId);
        const result = await this.handle(transactionId, raw, events, now);
        if (result.kind === 'DONE') {
          await this.repository.complete(ids, result.outcome, now);
          summary.outcomes[result.outcome] = (summary.outcomes[result.outcome] ?? 0) + ids.length;
          if (result.outcome === 'IMPORTED') summary.imported += 1;
        } else if (result.kind === 'DEFER') {
          await this.repository.release(ids, result.until, result.outcome);
          summary.deferred += ids.length;
        } else {
          summary.failed += ids.length;
          summary.dead += await this.fail(events, result.error, now);
        }
      } catch (err) {
        // Poster unreachable / errored, or a write failed: a counted attempt with backoff.
        const message = err instanceof Error ? err.message.split('\n')[0] : 'error';
        if (!(err instanceof WriteFailure)) posterDown = true;
        summary.failed += ids.length;
        summary.dead += await this.fail(events, message, now);
      }
    }
    if (summary.imported + summary.failed + summary.dead > 0) {
      this.logger.log(`Poster sync tick: claimed=${summary.claimed} transactions=${summary.transactions} imported=${summary.imported} deferred=${summary.deferred} failed=${summary.failed} dead=${summary.dead}`);
    }
    return summary;
  }

  // Decides what a canonical read means for the events that pointed at it.
  private async handle(
    transactionId: string,
    raw: PosterTransaction | null,
    events: WebhookEventRow[],
    now: Date,
  ): Promise<{ kind: 'DONE'; outcome: string } | { kind: 'DEFER'; until: Date; outcome: string } | { kind: 'FAIL'; error: string }> {
    const removedHint = events.some((e) => e.action === 'removed');

    // Poster no longer returns it (or reports it deleted): CUP never reverses anything automatically (refund semantics are unverified — Phase 19), but if the
    // receipt had been imported the operator must know, so it is flagged for review.
    if (raw === null || raw.status === '3') {
      const imported = (await this.repository.importedStatuses([transactionId])).get(transactionId);
      if (imported === 'IMPORTED') {
        this.logger.warn(`Poster transaction #${transactionId} is removed in Poster but IMPORTED in CUP — flagged for review, not reversed.`);
        return { kind: 'DONE', outcome: 'REMOVED_IMPORTED' };
      }
      if (raw !== null || removedHint) return { kind: 'DONE', outcome: 'REMOVED' };
      // Unknown to Poster and not a removal: allow for read-after-write lag a few times, then settle.
      const attempts = Math.max(...events.map((e) => e.attempts));
      return attempts + 1 >= NOT_FOUND_RETRIES ? { kind: 'DONE', outcome: 'NOT_FOUND' } : { kind: 'FAIL', error: 'Transaction not found in Poster (yet).' };
    }

    const summary = await this.importer.importTransactions([raw], { linkLookups: LINK_LOOKUPS });
    const detail = summary.details.find((d) => d.posterTransactionId === transactionId) ?? summary.details[0];
    if (!detail) return { kind: 'DONE', outcome: 'SKIPPED:UNREADABLE' };
    if (detail.outcome === 'FAILED') throw new WriteFailure('The import write failed and was rolled back.');
    // A receipt that closed moments ago is held back by the settling delay: come back exactly when it has settled (a deliberate deferral, not a failure).
    if (detail.category === 'TOO_RECENT' && detail.occurredAt) {
      const settledAt = new Date(new Date(detail.occurredAt).getTime() + this.config.env.POSTER_IMPORT_SETTLE_SECONDS * 1000 + 2000);
      return { kind: 'DEFER', until: settledAt > now ? settledAt : new Date(now.getTime() + 5000), outcome: 'TOO_RECENT' };
    }
    // An open receipt is not a sale yet; the `changed` event at close (or the reconciliation) will bring it back.
    if (detail.reason === 'NOT_CLOSED') return { kind: 'DONE', outcome: 'NOT_CLOSED' };
    const outcome = detail.outcome === 'SKIPPED' || detail.outcome === 'UNRESOLVED' ? `${detail.outcome}:${detail.reason ?? detail.category}` : detail.outcome;
    return { kind: 'DONE', outcome };
  }

  // Counts one failed attempt for every event of the group; returns how many became DEAD.
  private async fail(events: WebhookEventRow[], error: string, now: Date): Promise<number> {
    const max = this.config.env.POSTER_WEBHOOK_MAX_ATTEMPTS;
    let dead = 0;
    const retry: WebhookEventRow[] = [];
    for (const e of events) {
      if (e.attempts + 1 >= max) {
        await this.repository.fail([e.id], error, null);
        dead += 1;
      } else retry.push(e);
    }
    if (retry.length > 0) {
      const attempts = Math.max(...retry.map((e) => e.attempts)) + 1;
      await this.repository.fail(retry.map((e) => e.id), error, new Date(now.getTime() + backoffMs(attempts)));
    }
    return dead;
  }
}

class WriteFailure extends Error {}
