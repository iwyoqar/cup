import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../../common/config/config.service';
import { PosterImportRepository } from '../poster-import/poster-import.repository';
import { PosterTransactionImportService } from '../poster-import/poster-transaction-import.service';
import { PosterService } from '../poster/poster.service';
import { PosterTransaction } from '../poster/poster.types';
import { SettingsService } from '../settings/settings.service';
import { PosterSyncRepository } from './poster-sync.repository';

// Durable reconciliation state (Setting table — no schema change). Only the CHECKPOINT decides where the next pass starts; the others are visibility.
export const CHECKPOINT_KEY = 'poster.sync.reconcileCheckpoint'; // ISO: every closed receipt with date_close BEFORE it has been decided
export const RECONCILE_STATE_KEY = 'poster.sync.lastReconcile'; // the last pass (JSON), successful or not
export const LAST_SUCCESS_KEY = 'poster.sync.lastReconcileSuccess'; // ISO: start time of the last pass that finished without an error
export const LAST_ERROR_KEY = 'poster.sync.lastReconcileError'; // JSON {at, message}: the last failed pass (kept after a later success, marked resolved by Admin)

const DAY = 24 * 3600 * 1000;
const CHUNK_MS = 2 * DAY; // how much close-time one chunk covers (bounds the Poster response and the work per step)
const MAX_CHUNKS_PER_RUN = 12; // 24 days of catch-up per run; a longer outage simply continues on the next pass, from the checkpoint the previous run persisted
const MAX_PER_CHUNK = 200; // receipts imported per chunk; the rest of the chunk continues from where this one stopped
const MAX_PAGES = 100; // cursor pages per chunk (a bound on a misbehaving cursor, not an expected size)
const DATE_MARGIN_BEFORE_DAYS = 1; // Poster files a receipt under its ACCOUNT business day (verified: account timezone UTC+3, and a night receipt sits under the previous day), so the
const DATE_MARGIN_AFTER_DAYS = 1; // documented Ymd window is widened by a day each side; the exact close-time filter below is done here on the receipt's own date_close
const LINK_LOOKUPS = { lookbackDays: 3, max: 20 };

export interface ReconcileState {
  at: string;
  ok: boolean;
  checkpointBefore: string | null; // null = no checkpoint existed yet (first run: the initial lookback applied)
  checkpointAfter: string | null;
  initialized: boolean;
  caughtUp: boolean; // the pass reached "now" (false = it stopped early: a blocker, the chunk budget or an error)
  blockedBy: string | null; // why the checkpoint could not pass a point (a settling receipt / a failed write / the per-chunk cap)
  chunks: number;
  pages: number;
  window: { since: string; until: string };
  scanned: number; // receipts inside the pass's close-time windows
  alreadyImported: number;
  candidates: number; // receipts handed to the import engine
  imported: number;
  unresolved: number;
  failed: number;
  deferred: number; // still settling (TOO_RECENT)
  missedWebhooks: number; // receipts imported here that no webhook had ever announced
  error?: string;
}

export type ReconcileResult = { status: 'DISABLED' | 'BUSY' } | { status: 'RAN'; state: ReconcileState };

const ymd = (ms: number): string => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');
const closeMs = (t: PosterTransaction): number => {
  const v = Number(t.date_close);
  return Number.isFinite(v) && v > 0 ? v : 0;
};

// Phase 20 — the SECONDARY recovery mechanism (webhooks are the primary one), now CHECKPOINT-based.
//
// The checkpoint is a moment in time: "every closed receipt with date_close before it has been decided". Each pass resumes from it (minus a small overlap), walks
// forward in bounded close-time chunks up to "now", imports what CUP does not have through the SAME Phase 19 engine, and advances the checkpoint only over ground that
// was completely processed. So it does not matter how long CUP was down: on return the next pass starts at the last checkpoint and catches up — 4 days, 7 days or more.
//
//   * A failed pass (Poster unreachable, an exception) does NOT advance the checkpoint past the failing chunk; chunks completed earlier in the same pass keep theirs.
//   * The checkpoint is HELD in front of anything not yet decidable: a receipt still settling (TOO_RECENT), a receipt whose write failed, or the receipts beyond the
//     per-chunk cap — they are simply picked up again by the next pass. It never moves backwards.
//   * Receipts CUP decided on purpose (no client, unlinked client, unpaid, refund-shaped, CUP-created ...) are final for the checkpoint; the overlap re-reads the most
//     recent ones (a customer linked a little later is still caught) and the reviewed admin import covers anything older.
//   * Idempotent by construction: already imported receipts are dropped, and the Poster transaction id is unique, so re-reading (overlap, a crash between an import
//     and the checkpoint write, two processes) can never duplicate.
// It only runs while POSTER_SYNC_ENABLED is on and writes nothing (not even the checkpoint) while it is off.
@Injectable()
export class PosterReconcileService {
  private readonly logger = new Logger(PosterReconcileService.name);
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly poster: PosterService,
    private readonly importer: PosterTransactionImportService,
    private readonly importRepository: PosterImportRepository,
    private readonly syncRepository: PosterSyncRepository,
    private readonly settings: SettingsService,
  ) {}

  async lastState(): Promise<ReconcileState | null> {
    const raw = await this.settings.getString(RECONCILE_STATE_KEY, '');
    try {
      return raw ? (JSON.parse(raw) as ReconcileState) : null;
    } catch {
      return null;
    }
  }

  // Everything Admin shows about the recovery loop.
  async snapshot(now: Date = new Date()) {
    const [checkpoint, lastSuccessAt, lastErrorRaw, last] = await Promise.all([this.checkpoint(), this.settings.getString(LAST_SUCCESS_KEY, ''), this.settings.getString(LAST_ERROR_KEY, ''), this.lastState()]);
    let lastError: { at: string; message: string; resolved: boolean } | null = null;
    try {
      const parsed = lastErrorRaw ? (JSON.parse(lastErrorRaw) as { at: string; message: string }) : null;
      if (parsed) lastError = { ...parsed, resolved: !!lastSuccessAt && new Date(lastSuccessAt).getTime() > new Date(parsed.at).getTime() };
    } catch {
      lastError = null;
    }
    return {
      checkpoint: checkpoint ? checkpoint.toISOString() : null,
      lagSeconds: checkpoint ? Math.max(0, Math.round((now.getTime() - checkpoint.getTime()) / 1000)) : null,
      lastSuccessAt: lastSuccessAt || null,
      lastError,
      last,
    };
  }

  async checkpoint(): Promise<Date | null> {
    const raw = await this.settings.getString(CHECKPOINT_KEY, '');
    const d = raw ? new Date(raw) : null;
    return d && !Number.isNaN(d.getTime()) ? d : null;
  }

  // Never throws and never leaves the "running" guard set: the scheduler calls it without awaiting, so a rejection would be unhandled.
  async run(now: Date = new Date()): Promise<ReconcileResult> {
    if (!this.config.env.POSTER_SYNC_ENABLED) return { status: 'DISABLED' };
    if (this.running) return { status: 'BUSY' };
    this.running = true;
    try {
      return await this.execute(now);
    } catch (err) {
      const message = (err instanceof Error ? err.message.split(String.fromCharCode(10))[0] : 'error').slice(0, 200);
      this.logger.error(`Poster reconciliation could not start: ${message}`);
      const at = now.toISOString();
      const state: ReconcileState = { at, ok: false, checkpointBefore: null, checkpointAfter: null, initialized: false, caughtUp: false, blockedBy: null, chunks: 0, pages: 0, window: { since: at.slice(0, 10), until: at.slice(0, 10) }, scanned: 0, alreadyImported: 0, candidates: 0, imported: 0, unresolved: 0, failed: 0, deferred: 0, missedWebhooks: 0, error: message };
      await this.persistOutcome(state, now);
      return { status: 'RAN', state };
    } finally {
      this.running = false;
    }
  }

  private async execute(now: Date): Promise<ReconcileResult> {
    const env = this.config.env;
    const overlapMs = env.POSTER_RECONCILE_OVERLAP_MINUTES * 60 * 1000;
    const runStart = now.getTime();
    const stored = await this.checkpoint();
    const initialized = stored === null;
    let checkpoint = stored ?? new Date(runStart - env.POSTER_RECONCILE_LOOKBACK_DAYS * DAY);
    const state: ReconcileState = {
      at: now.toISOString(),
      ok: true,
      checkpointBefore: stored ? stored.toISOString() : null,
      checkpointAfter: stored ? stored.toISOString() : null,
      initialized,
      caughtUp: false,
      blockedBy: null,
      chunks: 0,
      pages: 0,
      window: { since: new Date(checkpoint.getTime() - overlapMs).toISOString().slice(0, 10), until: now.toISOString().slice(0, 10) },
      scanned: 0,
      alreadyImported: 0,
      candidates: 0,
      imported: 0,
      unresolved: 0,
      failed: 0,
      deferred: 0,
      missedWebhooks: 0,
    };

    try {
      for (let chunk = 0; chunk < MAX_CHUNKS_PER_RUN; chunk += 1) {
        if (checkpoint.getTime() >= runStart) {
          state.caughtUp = true;
          break;
        }
        const from = checkpoint.getTime() - overlapMs;
        const chunkEnd = Math.min(runStart, from + CHUNK_MS);
        const result = await this.processChunk(from, chunkEnd, state);
        state.chunks += 1;

        // Advance only over fully decided ground: to the chunk end, or up to (never past) the earliest receipt that is not decided yet. Never backwards.
        const target = result.blockerAt !== null ? Math.max(checkpoint.getTime(), result.blockerAt) : chunkEnd;
        const advanced = target > checkpoint.getTime();
        if (advanced) {
          checkpoint = new Date(target);
          await this.settings.setString(CHECKPOINT_KEY, checkpoint.toISOString(), null); // persisted per chunk: a crash later in the run keeps this progress
          state.checkpointAfter = checkpoint.toISOString();
        }
        const reachedHead = chunkEnd >= runStart;
        if (result.blockerAt !== null) state.blockedBy = result.reason;
        if (reachedHead && (result.blockerAt === null || result.hard)) state.caughtUp = true; // the head of the stream was read (a settling receipt only holds the checkpoint)
        // Stop when the blocker will not clear inside this pass (settling / failed write), when nothing advanced (so the loop can never spin), or at the head.
        if (result.blockerAt !== null && (result.hard || !advanced)) break;
        if (reachedHead && result.blockerAt === null) break;
      }
      if (state.failed > 0) {
        state.ok = false;
        state.error = `${state.failed} receipt(s) failed to import (rolled back); the checkpoint is held in front of them and they are retried on the next pass.`;
      }
      if (state.imported > 0) {
        this.logger.warn(`Poster reconciliation imported ${state.imported} receipt(s) (${state.missedWebhooks} had no webhook) — the webhook path missed them.`);
      }
    } catch (err) {
      state.ok = false;
      state.error = (err instanceof Error ? err.message.split('\n')[0] : 'error').slice(0, 200);
      this.logger.error(`Poster reconciliation failed (checkpoint kept at ${state.checkpointAfter ?? 'none'}): ${state.error}`);
    }
    await this.persistOutcome(state, now);
    return { status: 'RAN', state };
  }

  // One close-time chunk [from, chunkEnd): read it from Poster (cursor-paged), drop what CUP has, import the rest with the Phase 19 engine, and say where the
  // checkpoint may go. `hard` = the blocker will not clear by itself within this pass (settling / failed write); a cap blocker only means "continue from here".
  private async processChunk(from: number, chunkEnd: number, state: ReconcileState): Promise<{ blockerAt: number | null; reason: string | null; hard: boolean }> {
    const fetched = await this.fetchAll(ymd(from - DATE_MARGIN_BEFORE_DAYS * DAY), ymd(chunkEnd + DATE_MARGIN_AFTER_DAYS * DAY), state);
    const inWindow = fetched.filter((t) => {
      const c = closeMs(t);
      return c >= from && c < chunkEnd;
    });
    state.scanned += inWindow.length;
    const existing = await this.importRepository.findExisting(inWindow.map((t) => String(t.transaction_id)));
    const candidates = inWindow.filter((t) => existing.get(String(t.transaction_id))?.status !== 'IMPORTED').sort((a, b) => closeMs(a) - closeMs(b) || Number(a.transaction_id) - Number(b.transaction_id));
    state.alreadyImported += inWindow.length - candidates.length;
    const batch = candidates.slice(0, MAX_PER_CHUNK);
    const unprocessed = candidates.slice(MAX_PER_CHUNK);
    state.candidates += batch.length;

    const closeById = new Map(batch.map((t) => [String(t.transaction_id), closeMs(t)]));
    let hardAt: number | null = null;
    let hardReason: string | null = null;
    if (batch.length > 0) {
      const summary = await this.importer.importTransactions(batch, { linkLookups: LINK_LOOKUPS });
      state.imported += summary.imported;
      state.unresolved += summary.unresolved;
      state.failed += summary.failed;
      if (summary.importedTransactionIds.length > 0) {
        const announced = await this.syncRepository.idsWithWebhook(summary.importedTransactionIds);
        state.missedWebhooks += summary.importedTransactionIds.filter((id) => !announced.has(id)).length;
      }
      for (const d of summary.details) {
        const at = closeById.get(d.posterTransactionId);
        if (at === undefined) continue;
        const reason = d.outcome === 'FAILED' ? 'a receipt failed to import' : d.category === 'TOO_RECENT' ? 'a receipt is still settling' : null;
        if (reason && (hardAt === null || at < hardAt)) {
          hardAt = at;
          hardReason = reason;
        }
        if (d.category === 'TOO_RECENT') state.deferred += 1;
      }
    }
    const capAt = unprocessed.length > 0 ? closeMs(unprocessed[0]) : null;
    const blockerAt = hardAt !== null && (capAt === null || hardAt <= capAt) ? hardAt : capAt;
    const reason = blockerAt === null ? null : blockerAt === hardAt ? hardReason : 'more receipts than one chunk imports (continues on the next step)';
    return { blockerAt, reason, hard: blockerAt !== null && blockerAt === hardAt };
  }

  // Every closed receipt of the widened Ymd window, gathered with the documented cursor (next_tr = "transactions after this id", verified to be ascending). A page
  // with nothing new ends it; a server that ignored the cursor therefore cannot loop us. Read-only.
  private async fetchAll(dateFrom: string, dateTo: string, state: ReconcileState): Promise<PosterTransaction[]> {
    const byId = new Map<string, PosterTransaction>();
    let cursor = 0;
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const batch = await this.poster.getClosedTransactions(dateFrom, dateTo, cursor);
      state.pages += 1;
      const fresh = batch.filter((t) => Number(t.transaction_id) > cursor);
      if (fresh.length === 0) return [...byId.values()];
      for (const t of fresh) byId.set(String(t.transaction_id), t);
      cursor = Math.max(...fresh.map((t) => Number(t.transaction_id)));
    }
    throw new Error('Poster paging did not terminate within the page limit.');
  }

  private async persistOutcome(state: ReconcileState, now: Date): Promise<void> {
    try {
      await this.settings.setString(RECONCILE_STATE_KEY, JSON.stringify(state), null);
      if (state.ok) await this.settings.setString(LAST_SUCCESS_KEY, now.toISOString(), null);
      else await this.settings.setString(LAST_ERROR_KEY, JSON.stringify({ at: now.toISOString(), message: state.error ?? 'error' }), null);
    } catch {
      // the visibility records are informational; failing to save them must never fail the pass (the checkpoint itself was saved chunk by chunk)
    }
  }
}
