import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../../common/config/config.service';
import { Loyalty2SettingsService } from '../loyalty2/loyalty2-settings.service';
import { xpForSpend } from '../loyalty2/loyalty2-math';
import { RewardProgressRepository } from '../rewards/reward-progress.repository';
import { SegmentsService } from '../segments/segments.service';
import { AutomationEventsService, StreamEvent } from './automation-events.service';
import { AnyTriggerConfig, parseStoredConfig, TriggerConfigs } from './automation-config';
import { birthdayTarget, latestScheduleOccurrence, localDate } from './automation-time';
import { TriggerCandidate, TriggerType } from './automation.types';
import { AutomationWithRefs, AutomationsRepository } from './automations.repository';

export interface DetectionContext {
  now: Date;
  offsetMinutes: number;
  watermarkMs: number; // nothing before this instant may fire (activation / global switch / max event age)
  batchSize: number;
  cartExpiryMs: number;
}

export interface Detection {
  candidates: TriggerCandidate[];
  // The consumer position AFTER this batch (null = nothing to persist). The runner persists it only after the rows are enqueued.
  nextCursor: string | null;
  // Scheduled / once-a-day work: the run key to mark done once the batch is enqueued.
  doneRunKey: string | null;
  // true when the batch was full (more work is waiting) — the runner keeps going next tick.
  more: boolean;
  invalid?: boolean;
  notes: string[];
}

const EMPTY: Detection = { candidates: [], nextCursor: null, doneRunKey: null, more: false, notes: [] };
const SETTLE_MS = 30_000; // ignore events younger than this so a slow commit can never be skipped by the cursor

const parseCursor = <T,>(raw: string | null): T | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

// One evaluator per allowlisted trigger. Every evaluator is READ-ONLY, BOUNDED (LIMIT batchSize) and resumable from the automation's persisted
// cursor, and produces deterministic trigger keys so a candidate can only ever become ONE execution. No arbitrary code, no expressions.
@Injectable()
export class AutomationTriggerService {
  private readonly logger = new Logger(AutomationTriggerService.name);

  constructor(
    private readonly events: AutomationEventsService,
    private readonly repository: AutomationsRepository,
    private readonly rewardProgress: RewardProgressRepository,
    private readonly loyalty2Settings: Loyalty2SettingsService,
    private readonly segments: SegmentsService,
    private readonly config: ConfigService,
  ) {}

  async detect(automation: AutomationWithRefs, ctx: DetectionContext, cursorOverride?: string | null): Promise<Detection> {
    const type = automation.triggerType as TriggerType;
    const parsed = parseStoredConfig(type, automation.triggerConfig);
    if (!parsed) return { ...EMPTY, invalid: true, notes: ['INVALID_TRIGGER'] };
    const cursor = cursorOverride !== undefined ? cursorOverride : automation.eventCursor;
    switch (type) {
      case 'FIRST_PURCHASE':
        return this.firstPurchase(parsed as TriggerConfigs['FIRST_PURCHASE'], cursor, ctx);
      case 'REWARD_UNLOCKED':
        return this.rewardUnlocked(parsed as TriggerConfigs['REWARD_UNLOCKED'], cursor, ctx);
      case 'LOYALTY_MILESTONE':
        return this.milestone(parsed as TriggerConfigs['LOYALTY_MILESTONE'], cursor, ctx);
      case 'INACTIVE_CUSTOMER':
        return this.inactive(parsed as TriggerConfigs['INACTIVE_CUSTOMER'], cursor, ctx);
      case 'ABANDONED_CART':
        return this.abandonedCart(parsed as TriggerConfigs['ABANDONED_CART'], cursor, ctx);
      case 'BIRTHDAY':
        return this.birthday(automation, parsed as TriggerConfigs['BIRTHDAY'], cursor, ctx);
      case 'SCHEDULED_SEGMENT':
        return this.scheduledSegment(automation, parsed as TriggerConfigs['SCHEDULED_SEGMENT'], ctx);
    }
  }

  // ------------------------------------------------------------------------------------------ purchase-stream triggers

  private async streamBatch(cursorRaw: string | null, ctx: DetectionContext): Promise<{ events: StreamEvent[]; sinceMs: number; prevT: number; lastT: number }> {
    const cursor = parseCursor<{ t: number; src: string; id: string }>(cursorRaw);
    const sinceMs = Math.max(ctx.watermarkMs, 0);
    const untilMs = ctx.now.getTime() - SETTLE_MS;
    const events = await this.events.purchaseCompleted(cursor, sinceMs, untilMs, ctx.batchSize);
    // The state "before" this batch: at the consumer position (or the watermark), one ms earlier so a same-millisecond event is never lost.
    const prevT = Math.max(cursor?.t ?? 0, sinceMs) - 1;
    const lastT = events.length ? events[events.length - 1].cursor.t : prevT + 1;
    return { events, sinceMs, prevT, lastT };
  }

  private advance(events: StreamEvent[], candidates: TriggerCandidate[], batch: number): Detection {
    const last = events[events.length - 1];
    return { candidates, nextCursor: last ? JSON.stringify(last.cursor) : null, doneRunKey: null, more: events.length >= batch, notes: [] };
  }

  private async firstPurchase(cfg: TriggerConfigs['FIRST_PURCHASE'], cursor: string | null, ctx: DetectionContext): Promise<Detection> {
    const { events } = await this.streamBatch(cursor, ctx);
    if (events.length === 0) return EMPTY;
    const ids = [...new Set(events.map((e) => e.customerId))];
    const first = await this.repository.firstPurchaseTimes(ids);
    const seen = new Set<string>();
    const out: TriggerCandidate[] = [];
    for (const e of events) {
      // This event IS the customer's first qualifying purchase (no earlier one across CUP + POS). Registration / QR / catalog views never count.
      if (first.get(e.customerId) !== e.at.getTime() || seen.has(e.customerId)) continue;
      seen.add(e.customerId);
      out.push({ customerId: e.customerId, triggerKey: `first-purchase:${e.customerId}`, notBeforeAt: cfg.delayMinutes > 0 ? new Date(e.at.getTime() + cfg.delayMinutes * 60_000) : null });
    }
    return this.advance(events, out, ctx.batchSize);
  }

  private async rewardUnlocked(cfg: TriggerConfigs['REWARD_UNLOCKED'], cursor: string | null, ctx: DetectionContext): Promise<Detection> {
    const program = await this.repository.findRewardProgram(cfg.rewardProgramId);
    if (!program) return { ...EMPTY, invalid: true, notes: ['REWARD_PROGRAM_MISSING'] };
    const { events, prevT, lastT } = await this.streamBatch(cursor, ctx);
    if (events.length === 0) return EMPTY;
    const ids = [...new Set(events.map((e) => e.customerId))];
    // Credits EARNED (floor(visits / buyQuantity)) by the end of this batch minus those already earned before it — redemptions never reduce earned
    // credits, so redeeming does not create or hide an unlock. Must use the SAME qualifying-VISIT definition as RewardProgressService.getProgress
    // (countQualifyingOccasions — owner decision 2026-09-24: distinct qualifying orders/transactions, never summed item quantity), or this trigger
    // could fire "reward unlocked" at a different threshold than the reward engine itself actually grants at.
    const [before, upTo] = await Promise.all([
      this.rewardProgress.countQualifyingOccasionsForCustomers(ids, program.qualifyingCategoryId, new Date(prevT)),
      this.rewardProgress.countQualifyingOccasionsForCustomers(ids, program.qualifyingCategoryId, new Date(lastT)),
    ]);
    const out: TriggerCandidate[] = [];
    for (const id of ids) {
      const earnedBefore = Math.floor((before.get(id) ?? 0) / program.buyQuantity);
      const earnedNow = Math.floor((upTo.get(id) ?? 0) / program.buyQuantity);
      for (let k = earnedBefore + 1; k <= Math.min(earnedNow, earnedBefore + 10); k += 1) out.push({ customerId: id, triggerKey: `reward:${id}:${program.id}:${k}`, notBeforeAt: null });
    }
    return this.advance(events, out, ctx.batchSize);
  }

  private async milestone(cfg: TriggerConfigs['LOYALTY_MILESTONE'], cursor: string | null, ctx: DetectionContext): Promise<Detection> {
    const { events, prevT, lastT } = await this.streamBatch(cursor, ctx);
    if (events.length === 0) return EMPTY;
    const ids = [...new Set(events.map((e) => e.customerId))];
    const value = async (upTo: Date): Promise<Map<string, number>> => {
      switch (cfg.metric) {
        case 'lifetimeSpend':
          return this.repository.spendUpTo(ids, upTo);
        case 'lifetimeXP': {
          const xp = await this.loyalty2Settings.get();
          const spend = await this.repository.spendUpTo(ids, upTo);
          return new Map([...spend].map(([id, s]) => [id, xpForSpend(s, xp.xpRate, xp.xpUnitAmount)]));
        }
        case 'lifetimeCoffeeQuantity':
          return this.rewardProgress.sumQualifyingQuantityForCustomers(ids, cfg.categoryId as string, upTo);
        case 'rewardCount':
          return this.repository.redemptionCountsUpTo(ids, upTo);
      }
    };
    const [before, after] = await Promise.all([value(new Date(prevT)), value(new Date(lastT))]);
    // A CROSSING, not a level: previous value below the threshold and the value at the end of the batch at/above it. The trigger key carries the
    // threshold, so it can only ever fire once per customer per configured milestone (101 000 after 100 000 never re-fires).
    const out = ids
      .filter((id) => (before.get(id) ?? 0) < cfg.threshold && (after.get(id) ?? 0) >= cfg.threshold)
      .map((id): TriggerCandidate => ({ customerId: id, triggerKey: `milestone:${id}:${cfg.metric}:${cfg.threshold}`, notBeforeAt: null }));
    return this.advance(events, out, ctx.batchSize);
  }

  // -------------------------------------------------------------------------------------------- time-window triggers

  private async inactive(cfg: TriggerConfigs['INACTIVE_CUSTOMER'], cursorRaw: string | null, ctx: DetectionContext): Promise<Detection> {
    const inactiveMs = cfg.inactiveDays * 86_400_000;
    const cursor = parseCursor<{ t: number; id: string }>(cursorRaw);
    // Customers who CROSS the inactivity threshold (last purchase + N days) — oldest first. Unless includeExisting, only those who crossed after
    // the watermark (activation) — so switching a win-back on never mass-messages everyone who was already lapsed.
    const floor = cfg.includeExisting ? 0 : Math.max(0, ctx.watermarkMs - inactiveMs);
    const rows = await this.repository.lastPurchaseBetween(Math.max(floor, ctx.now.getTime() - 3 * 365 * 86_400_000), ctx.now.getTime() - inactiveMs, cursor, ctx.batchSize);
    if (rows.length === 0) return EMPTY;
    const out = rows.map((r): TriggerCandidate => ({
      customerId: r.customerId,
      // Period key = the last purchase's business day: one win-back per lapse, and a new one only after the customer buys again and lapses again.
      triggerKey: `inactive:${r.customerId}:${localDate(new Date(r.lastAt), ctx.offsetMinutes)}`,
      notBeforeAt: null,
    }));
    const last = rows[rows.length - 1];
    return { candidates: out, nextCursor: JSON.stringify({ t: last.lastAt, id: last.customerId }), doneRunKey: null, more: rows.length >= ctx.batchSize, notes: [] };
  }

  private async abandonedCart(cfg: TriggerConfigs['ABANDONED_CART'], cursorRaw: string | null, ctx: DetectionContext): Promise<Detection> {
    const cursor = parseCursor<{ t: number; id: string }>(cursorRaw);
    // Lower bound: nothing before the watermark and nothing already EXPIRED (an expired cart is never messaged). The cursor tuple is an independent,
    // additional condition. Upper bound: last activity older than the delay. Items present and no checkout in flight are enforced in the query.
    const lower = Math.max(ctx.watermarkMs, ctx.now.getTime() - ctx.cartExpiryMs);
    const rows = await this.repository.cartsInactiveBetween(lower, ctx.now.getTime() - cfg.delayMinutes * 60_000, cursor, ctx.batchSize);
    if (rows.length === 0) return EMPTY;
    const out = rows.map((r): TriggerCandidate => ({
      customerId: r.customerId,
      // Cart STATE identity: which cart, plus its version (last activity + item count). A changed cart is a new state; an unchanged one never repeats.
      triggerKey: `cart:${r.customerId}:${r.cartId}:${r.activityMs}.${r.itemCount}`,
      notBeforeAt: null,
    }));
    const last = rows[rows.length - 1];
    return { candidates: out, nextCursor: JSON.stringify({ t: last.activityMs, id: last.cartId }), doneRunKey: null, more: rows.length >= ctx.batchSize, notes: [] };
  }

  private async birthday(automation: AutomationWithRefs, cfg: TriggerConfigs['BIRTHDAY'], cursorRaw: string | null, ctx: DetectionContext): Promise<Detection> {
    const today = localDate(ctx.now, ctx.offsetMinutes);
    if (automation.lastRunKey === `bd:${today}:done`) return EMPTY; // today's scan already finished
    const { monthDays, year } = birthdayTarget(today, cfg.daysBefore);
    const cursor = parseCursor<{ day: string; id: string }>(cursorRaw);
    const rows = await this.repository.birthdayCustomers(monthDays, cursor && cursor.day === today ? cursor.id : null, ctx.batchSize);
    const out = rows.map((r): TriggerCandidate => ({ customerId: r.id, triggerKey: `birthday:${r.id}:${year}`, notBeforeAt: null }));
    const more = rows.length >= ctx.batchSize;
    return {
      candidates: out,
      nextCursor: more ? JSON.stringify({ day: today, id: rows[rows.length - 1].id }) : null,
      doneRunKey: more ? null : `bd:${today}:done`,
      more,
      notes: [],
    };
  }

  private async scheduledSegment(automation: AutomationWithRefs, cfg: TriggerConfigs['SCHEDULED_SEGMENT'], ctx: DetectionContext): Promise<Detection> {
    if (!automation.segmentId) return { ...EMPTY, invalid: true, notes: ['SEGMENT_REQUIRED'] };
    const occ = latestScheduleOccurrence(ctx.now, ctx.offsetMinutes, cfg);
    // Never run an occurrence that predates the watermark or is too old to still be relevant (no flood after a long pause).
    if (occ.at.getTime() < ctx.watermarkMs || automation.lastRunKey === `sched:${occ.runKey}`) return EMPTY;
    const ids = await this.segments.getAllMatchingCustomerIds(automation.segmentId);
    if (ids === null) return { ...EMPTY, invalid: true, notes: ['SEGMENT_MISSING'] };
    // Resolved at execution time from the CURRENT segment definition (never a stored snapshot).
    const out = ids.map((id): TriggerCandidate => ({ customerId: id, triggerKey: `scheduled:${automation.id}:${occ.runKey}:${id}`, notBeforeAt: null }));
    return { candidates: out, nextCursor: null, doneRunKey: `sched:${occ.runKey}`, more: false, notes: [] };
  }
}

export type { AnyTriggerConfig };
