import { Injectable, Logger } from '@nestjs/common';
import { BranchRepository } from '../branches/branch.repository';
import { StaffRepository } from '../staff/staff.repository';
import { PosContext } from './pos-widget-signature';

export const POS_WIDGET_VIEW_ACTION = 'POS_WIDGET_CUSTOMER_VIEW';
// The same customer viewed again from the same register within this window is ONE event (a popup re-render or a refresh is not a new view).
const DEDUPE_MS = 60_000;

// Phase 22 — reward redemption lifecycle events, same table, same actor convention. NOT deduplicated: unlike a passive view, every redemption event is a
// deliberate, distinct action worth its own row (the brief's §17 explicitly lists REQUESTED/CONFIRMED/FAILED/UNKNOWN as separate events to record).
export const REWARD_REDEMPTION_ACTIONS = {
  REQUESTED: 'REWARD_REDEMPTION_REQUESTED',
  CONFIRMED: 'REWARD_REDEMPTION_CONFIRMED',
  FAILED: 'REWARD_REDEMPTION_FAILED',
  UNKNOWN: 'REWARD_REDEMPTION_UNKNOWN',
} as const;

// Phase 23 — the same lifecycle-event shape, for promotions. A separate action set (not reused values) so REWARD_* and PROMOTION_* audit rows are never
// ambiguous about which redemption concept they describe — rewards and promotions remain separate concepts end to end, per the brief.
export const PROMOTION_REDEMPTION_ACTIONS = {
  REQUESTED: 'PROMOTION_REDEMPTION_REQUESTED',
  CONFIRMED: 'PROMOTION_REDEMPTION_CONFIRMED',
  FAILED: 'PROMOTION_REDEMPTION_FAILED',
  UNKNOWN: 'PROMOTION_REDEMPTION_UNKNOWN',
} as const;

// Phase 21 — operational audit in the EXISTING staff_scan_events table (no new table). The actor is the verified Poster context, not a person:
//   actorType 'POS_WIDGET', actorId 'poster:<account>:<spot>:<tablet>'. Stored: the action, FOUND / NOT_FOUND, the customer's internal id and the branch mapped from
// the verified spot. NEVER stored: the phone, the CUP code, the Poster client id, the request body, any Poster payload, any secret.
@Injectable()
export class PosWidgetAuditService {
  private readonly logger = new Logger(PosWidgetAuditService.name);

  constructor(
    private readonly staffRepository: StaffRepository,
    private readonly branches: BranchRepository,
  ) {}

  // An audit failure must never break the barista's screen (the widget is an enhancement, not a dependency).
  async record(ctx: PosContext, customerId: string | null, result: 'FOUND' | 'NOT_FOUND'): Promise<void> {
    try {
      const actorId = `poster:${ctx.account}:${ctx.spotId ?? '-'}:${ctx.tabletId ?? '-'}`;
      if (customerId && (await this.staffRepository.hasRecentEvent(actorId, customerId, POS_WIDGET_VIEW_ACTION, new Date(Date.now() - DEDUPE_MS)))) return;
      const branch = ctx.spotId ? await this.branches.findByPosterSpotId(Number(ctx.spotId)) : null;
      await this.staffRepository.recordEvent({ actorType: 'POS_WIDGET', actorId, action: POS_WIDGET_VIEW_ACTION, result, customerId, branchId: branch?.id ?? null });
    } catch (err) {
      this.logger.error(`POS widget audit failed: ${err instanceof Error ? err.message.split(String.fromCharCode(10))[0] : 'error'}`);
    }
  }

  // Phase 22: one row per redemption lifecycle event. `result` carries the machine-readable outcome (e.g. a RedemptionAttemptStatus, or a failure reason
  // code) — never a phone, a CUP code, a Poster order id, or any Poster payload, matching the class's existing rule. An audit failure must never break the
  // redemption response the cashier sees.
  async recordRewardEvent(ctx: PosContext, customerId: string | null, action: (typeof REWARD_REDEMPTION_ACTIONS)[keyof typeof REWARD_REDEMPTION_ACTIONS], result: string): Promise<void> {
    try {
      const actorId = `poster:${ctx.account}:${ctx.spotId ?? '-'}:${ctx.tabletId ?? '-'}`;
      const branch = ctx.spotId ? await this.branches.findByPosterSpotId(Number(ctx.spotId)) : null;
      await this.staffRepository.recordEvent({ actorType: 'POS_WIDGET', actorId, action, result, customerId, branchId: branch?.id ?? null });
    } catch (err) {
      this.logger.error(`POS widget reward audit failed: ${err instanceof Error ? err.message.split(String.fromCharCode(10))[0] : 'error'}`);
    }
  }

  // Phase 23 — identical shape/discipline to recordRewardEvent, for promotions. `result` is machine-readable only (a status or failure reason code) —
  // never a phone, CUP code, Poster order id, or Poster payload, matching the class's existing rule.
  async recordPromotionEvent(ctx: PosContext, customerId: string | null, action: (typeof PROMOTION_REDEMPTION_ACTIONS)[keyof typeof PROMOTION_REDEMPTION_ACTIONS], result: string): Promise<void> {
    try {
      const actorId = `poster:${ctx.account}:${ctx.spotId ?? '-'}:${ctx.tabletId ?? '-'}`;
      const branch = ctx.spotId ? await this.branches.findByPosterSpotId(Number(ctx.spotId)) : null;
      await this.staffRepository.recordEvent({ actorType: 'POS_WIDGET', actorId, action, result, customerId, branchId: branch?.id ?? null });
    } catch (err) {
      this.logger.error(`POS widget promotion audit failed: ${err instanceof Error ? err.message.split(String.fromCharCode(10))[0] : 'error'}`);
    }
  }
}
