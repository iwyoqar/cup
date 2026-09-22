import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CustomersRepository } from '../customers/customers.repository';
import { PromotionRedemptionService } from '../promotions/promotion-redemption.service';
import { PromotionEligibilityService } from '../promotions/promotion-eligibility.service';
import { PromotionsRepository } from '../promotions/promotions.repository';
import { toRecord as toPromotionRecord } from '../promotions/promotions.service';
import { PromotionNotEligibleError, PromotionRedemptionRaceError } from '../promotions/promotions.errors';
import { PosWidgetAuditService, PROMOTION_REDEMPTION_ACTIONS } from './pos-widget-audit.service';
import { PosterPromotionMutationService } from './poster-promotion-mutation.service';
import { CreatePromotionAttemptData, PosWidgetPromotionRedemptionRepository } from './pos-widget-promotion-redemption.repository';
import { RedeemPromotionRequest, RedeemPromotionResponse, PromotionRedemptionFailureReason } from './pos-widget-promotion-redemption.types';
import { PosContext } from './pos-widget-signature';

// A pure input problem — nothing to reference, no attempt row is created. Matches RedeemRewardInputError exactly.
export class RedeemPromotionInputError extends Error {
  constructor(readonly reason: PromotionRedemptionFailureReason) {
    super(reason);
  }
}

interface PromotionAttemptRowLike {
  id: string;
  attemptId: string;
  status: string;
  failureReason: string | null;
  promotionId: string;
  promotionName: string | null;
}

// Phase 23 — orchestrates ONE promotion redemption attempt end to end. Mirrors pos-widget-reward-redemption.service.ts's THREE-PHASE structure exactly,
// for the identical reason: the Poster mutation (PosterPromotionMutationService.applyToOrder — up to three real HTTP calls) must NEVER run inside a DB
// transaction (SQLite's 5s interactive-transaction timeout; a real bug was hit and fixed for exactly this class of mistake in Phase 22).
//   A. SHORT transaction: create/claim the attempt row — eligibility, the "already redeemed on this order" check (Phase 23's own per-order rule, a
//      SEPARATE invariant from Phase 22.3's reward one), the customer+promotion concurrency guard, then mark POSTER_MUTATING.
//   B. OUTSIDE any transaction: the Poster mutation.
//   C. Commit the terminal outcome. Unlike rewards, the actual redemption WRITE reuses the EXISTING, non-tx-aware PromotionRedemptionService.redeem()
//      (its own retry-on-unique-constraint loop is what protects usageLimitPerCustomer across ANY caller, not just this one) — so it is called OUTSIDE
//      any transaction too, exactly where Phase B already is; only marking THIS service's own attempt row REDEEMED afterward needs a (separate, short)
//      transaction. In the vanishingly rare case Poster confirms but redeem() then refuses (e.g. a concurrent non-POS redemption exhausted the usage
//      limit in that exact gap), the order was genuinely mutated but CUP could not finalize a redemption record — never silently dropped, never marked
//      FAILED (which would wrongly imply nothing happened): the attempt goes to UNKNOWN for reconciliation, same as any other unconfirmable outcome.
@Injectable()
export class PosWidgetPromotionRedemptionService {
  private readonly logger = new Logger(PosWidgetPromotionRedemptionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly customers: CustomersRepository,
    private readonly promotions: PromotionsRepository,
    private readonly eligibility: PromotionEligibilityService,
    private readonly mutation: PosterPromotionMutationService,
    private readonly attempts: PosWidgetPromotionRedemptionRepository,
    private readonly promotionRedemptionService: PromotionRedemptionService,
    private readonly audit: PosWidgetAuditService,
  ) {}

  async redeem(ctx: PosContext, req: RedeemPromotionRequest): Promise<RedeemPromotionResponse> {
    // ---- 1. Resolve customer/promotion server-side. Never trust the widget's claim of eligibility or identity.
    const customer = await this.customers.findByPosterClientId(req.posterClientId);
    if (!customer) {
      await this.audit.recordPromotionEvent(ctx, null, PROMOTION_REDEMPTION_ACTIONS.FAILED, 'CUSTOMER_NOT_FOUND');
      throw new RedeemPromotionInputError('CUSTOMER_NOT_FOUND');
    }
    const promotionRow = await this.promotions.findById(req.promotionId);
    if (!promotionRow) {
      await this.audit.recordPromotionEvent(ctx, customer.id, PROMOTION_REDEMPTION_ACTIONS.FAILED, 'PROMOTION_NOT_FOUND');
      throw new RedeemPromotionInputError('PROMOTION_NOT_FOUND');
    }
    const promotion = toPromotionRecord(promotionRow);

    // ---- 2. Idempotent replay, before any transaction.
    const existing = await this.attempts.findByAttemptId(req.attemptId);
    if (existing) return toResponse(existing);

    // ---- 3. Re-validate eligibility server-side (read-only; the AUTHORITATIVE, race-safe re-check for usage limits still happens inside
    // PromotionRedemptionService.redeem()'s own retry loop — this call only decides which failure reason to report up front).
    const check = await this.eligibility.checkEligibility(promotion, customer.id);

    const attemptData: CreatePromotionAttemptData = {
      attemptId: req.attemptId,
      customerId: customer.id,
      promotionId: promotion.id,
      promotionName: promotion.name,
      benefitType: promotion.benefitType,
      posterAccount: ctx.account,
      posterSpotId: ctx.spotId,
      posterTabletId: ctx.tabletId,
      posterOrderId: req.posterOrderId,
      employeeIdentifier: req.employeeIdentifier ?? null,
    };

    // ---- 4a. Phase A — SHORT transaction: create/claim the attempt row. No Poster call happens in here.
    const claim = await this.prisma.runTransaction(async (tx) => {
      const { created, row } = await this.attempts.createRequestedTx(tx, attemptData);
      if (!created) return { kind: 'replay' as const, row };

      if (!check.eligible) {
        const failed = await this.attempts.markFailedTx(tx, row.id, mapEligibilityReason(check.reason));
        return { kind: 'terminal' as const, row: failed };
      }

      // Phase 23's own rule: one promotion redemption per Poster order, scoped by posterOrderId alone.
      const alreadyRedeemed = await this.attempts.findRedeemedForPosterOrderTx(tx, attemptData.posterOrderId);
      if (alreadyRedeemed) {
        const failed = await this.attempts.markFailedTx(tx, row.id, 'PROMOTION_ALREADY_REDEEMED_FOR_ORDER');
        return { kind: 'terminal' as const, row: failed };
      }
      const orderConcurrent = await this.attempts.findUnresolvedForPosterOrderTx(tx, attemptData.posterOrderId, row.id);
      if (orderConcurrent) {
        const failed = await this.attempts.markFailedTx(tx, row.id, 'CONCURRENT_ATTEMPT_IN_PROGRESS');
        return { kind: 'terminal' as const, row: failed };
      }

      const concurrent = await this.attempts.findUnresolvedForCustomerPromotionTx(tx, customer.id, promotion.id);
      if (concurrent && concurrent.id !== row.id) {
        const failed = await this.attempts.markFailedTx(tx, row.id, 'CONCURRENT_ATTEMPT_IN_PROGRESS');
        return { kind: 'terminal' as const, row: failed };
      }

      const claimed = await this.attempts.markMutatingTx(tx, row.id);
      return { kind: 'claimed' as const, row: claimed };
    });

    if (claim.kind === 'replay') return toResponse(claim.row);

    let outcome: { row: PromotionAttemptRowLike; isNewAttempt: boolean };
    if (claim.kind === 'terminal') {
      outcome = { row: claim.row, isNewAttempt: true };
    } else {
      // ---- 4b. Phase B — OUTSIDE any transaction: the Poster mutation (or, for LOYALTY_POINTS, just proving the order is real and open).
      const support = this.mutation.isSupported(promotion.benefitType);
      const result = support.supported
        ? await this.mutation.applyToOrder({ posterSpotId: ctx.spotId, posterTabletId: ctx.tabletId, posterOrderId: req.posterOrderId, benefitType: promotion.benefitType, benefitProductId: promotionRow.benefitProductId ? String(promotionRow.benefitProductId) : null })
        : ({ kind: 'blocked', reason: support.reason } as const);

      if (result.kind === 'rejected') {
        const row = await this.prisma.runTransaction((tx) => this.attempts.markFailedTx(tx, claim.row.id, 'POSTER_REJECTED'));
        outcome = { row, isNewAttempt: true };
      } else if (result.kind !== 'confirmed') {
        const failureReason = result.kind === 'blocked' ? 'BLOCKED_NO_VERIFIED_POSTER_MUTATION' : null;
        const row = await this.prisma.runTransaction((tx) => this.attempts.markUnknownTx(tx, claim.row.id, failureReason));
        outcome = { row, isNewAttempt: true };
      } else {
        // ---- 4c. Poster confirmed. Now, and only now, commit the actual redemption — reusing PromotionRedemptionService.redeem() UNCHANGED, outside
        // any transaction (see the class comment for why). FREE_PRODUCT needs no extra Poster-side action here: the order was already mutated in Phase
        // B; this call only records CUP's own bookkeeping (usage count, and LOYALTY_POINTS' points credit).
        outcome = await this.commitRedemption(claim.row, customer.id, promotion, attemptData.posterOrderId);
      }
    }

    // ---- 5. Audit AFTER everything closes.
    if (outcome.isNewAttempt) {
      await this.audit.recordPromotionEvent(ctx, customer.id, PROMOTION_REDEMPTION_ACTIONS.REQUESTED, 'REQUESTED');
      const terminalAction = outcome.row.status === 'REDEEMED' ? PROMOTION_REDEMPTION_ACTIONS.CONFIRMED : outcome.row.status === 'UNKNOWN' ? PROMOTION_REDEMPTION_ACTIONS.UNKNOWN : PROMOTION_REDEMPTION_ACTIONS.FAILED;
      await this.audit.recordPromotionEvent(ctx, customer.id, terminalAction, outcome.row.failureReason ?? outcome.row.status);
    }

    return toResponse(outcome.row);
  }

  private async commitRedemption(claimRow: { id: string }, customerId: string, promotion: ReturnType<typeof toPromotionRecord>, posterOrderId: string): Promise<{ row: PromotionAttemptRowLike; isNewAttempt: true }> {
    try {
      const result = await this.promotionRedemptionService.redeem(promotion, customerId, { orderId: null });
      const row = await this.prisma.runTransaction((tx) => this.attempts.markRedeemedTx(tx, claimRow.id, result.redemptionId, posterOrderId));
      return { row, isNewAttempt: true };
    } catch (err) {
      if (err instanceof PromotionNotEligibleError || err instanceof PromotionRedemptionRaceError) {
        // Poster's order WAS genuinely mutated (we only reach commitRedemption after a 'confirmed' result) but CUP's own bookkeeping could not commit a
        // redemption record. Never mark this FAILED (that would wrongly imply the order is unchanged) and never fabricate a redemption — UNKNOWN,
        // exactly like any other outcome this service cannot fully confirm, for manual reconciliation.
        this.logger.error(`Promotion redemption for attempt ${claimRow.id}: Poster confirmed but PromotionRedemptionService.redeem() could not commit (${err.message}). Marking UNKNOWN for reconciliation — the Poster order was NOT rolled back.`);
        const row = await this.prisma.runTransaction(async (tx) => this.attempts.markUnknownTx(tx, claimRow.id, null));
        return { row, isNewAttempt: true };
      }
      throw err;
    }
  }
}

function toResponse(row: PromotionAttemptRowLike): RedeemPromotionResponse {
  return {
    attemptId: (row as { attemptId: string }).attemptId,
    status: row.status as RedeemPromotionResponse['status'],
    failureReason: (row.failureReason as PromotionRedemptionFailureReason | null) ?? null,
    promotionName: row.promotionName,
  };
}

function mapEligibilityReason(reason: string | null): PromotionRedemptionFailureReason {
  switch (reason) {
    case 'INACTIVE':
      return 'PROMOTION_INACTIVE';
    case 'NOT_STARTED':
      return 'PROMOTION_NOT_STARTED';
    case 'EXPIRED':
      return 'PROMOTION_EXPIRED';
    case 'SEGMENT_MISMATCH':
      return 'SEGMENT_MISMATCH';
    case 'USAGE_LIMIT_REACHED':
      return 'USAGE_LIMIT_REACHED';
    case 'INVALID_BENEFIT':
      return 'INVALID_BENEFIT';
    case 'NOT_ELIGIBLE':
    default:
      return 'NOT_ELIGIBLE';
  }
}
