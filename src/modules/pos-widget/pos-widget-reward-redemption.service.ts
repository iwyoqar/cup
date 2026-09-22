import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CatalogRepository } from '../catalog/catalog.repository';
import { CustomersRepository } from '../customers/customers.repository';
import { RewardEligibilityService } from '../rewards/reward-eligibility.service';
import { RewardRedemptionService } from '../rewards/reward-redemption.service';
import { RewardProgramsRepository } from '../rewards/reward-programs.repository';
import { toRecord } from '../rewards/reward-programs.service';
import { PosWidgetAuditService, REWARD_REDEMPTION_ACTIONS } from './pos-widget-audit.service';
import { PosterRewardMutationService } from './poster-reward-mutation.service';
import { CreateAttemptData, PosWidgetRewardRedemptionRepository } from './pos-widget-reward-redemption.repository';
import { RedeemRewardRequest, RedeemRewardResponse, RedemptionFailureReason } from './pos-widget-reward-redemption.types';
import { PosContext } from './pos-widget-signature';

// A pure input problem (nothing to reference — no attempt row is created; matches the overview endpoint's own "not found" treatment). Distinct from a
// FAILED attempt, which requires a real customer + program + product to exist.
export class RedeemRewardInputError extends Error {
  constructor(readonly reason: RedemptionFailureReason) {
    super(reason);
  }
}

interface AttemptRowLike {
  attemptId: string;
  status: string;
  failureReason: string | null;
  rewardProductName: string | null;
}

// Phase 22 — orchestrates ONE redemption attempt end to end: resolve -> re-validate everything server-side -> idempotency/concurrency guard -> mutate the
// real Poster order (verified-safe mechanism, see poster-reward-mutation.service.ts) -> verify -> record the outcome. The reward is NEVER consumed (no
// RewardRedemption row, no attempt marked REDEEMED) unless a real Poster mutation was POSITIVELY confirmed by re-reading the order afterward.
//
// IMPORTANT — three phases, only two of which are transactions, and NEITHER transaction ever calls Poster:
//   A. A SHORT transaction: create the attempt row (idempotent), re-check eligibility, check for a concurrent unresolved attempt, and — if both pass —
//      mark the row POSTER_MUTATING. This "claims" the row: its own existence at an unresolved status is what blocks a second concurrent attempt.
//   B. OUTSIDE any transaction: the actual Poster mutation (PosterRewardMutationService.applyToOrder — up to three real HTTP calls to joinposter.com:
//      list open transactions, add the product, re-read to verify). This is the slow, network-bound part, and it must never run inside a DB transaction.
//   C. A SECOND SHORT transaction: commit the terminal outcome (FAILED / UNKNOWN / REDEEMED) based on B's result. On REDEEMED, the RewardRedemption row
//      is created here too (RewardRedemptionService.createRedemptionRecord, itself fully tx-safe — pure DB work, no external calls).
// This split exists because of a REAL bug hit earlier in this phase: an early version called the (non-tx) audit service from inside a single
// all-in-one transaction, and SQLite's 5 s interactive-transaction timeout turned every attempt into a 500 under the resulting outer-connection
// contention. Adding real Poster network calls into that same mistake would be far worse — a slow Poster response could blow the timeout on every
// single redemption. Customer/program/product resolution, the eligibility check, and both audit events all still happen outside any transaction, exactly
// as before.
@Injectable()
export class PosWidgetRewardRedemptionService {
  private readonly logger = new Logger(PosWidgetRewardRedemptionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly customers: CustomersRepository,
    private readonly programs: RewardProgramsRepository,
    private readonly eligibility: RewardEligibilityService,
    private readonly catalog: CatalogRepository,
    private readonly mutation: PosterRewardMutationService,
    private readonly redemptions: PosWidgetRewardRedemptionRepository,
    private readonly rewardRedemptionService: RewardRedemptionService,
    private readonly audit: PosWidgetAuditService,
  ) {}

  async redeem(ctx: PosContext, req: RedeemRewardRequest): Promise<RedeemRewardResponse> {
    // ---- 1. Resolve everything the attempt row's required (NOT NULL) foreign keys need. A request that cannot even be attributed to a real customer,
    // program or product is a stale/malformed widget state, not a redemption attempt — no row is written for it (nothing to record against).
    const customer = await this.customers.findByPosterClientId(req.posterClientId);
    if (!customer) {
      await this.audit.recordRewardEvent(ctx, null, REWARD_REDEMPTION_ACTIONS.FAILED, 'CUSTOMER_NOT_FOUND');
      throw new RedeemRewardInputError('CUSTOMER_NOT_FOUND');
    }
    const programRow = await this.programs.findById(req.rewardProgramId);
    if (!programRow) {
      await this.audit.recordRewardEvent(ctx, customer.id, REWARD_REDEMPTION_ACTIONS.FAILED, 'PROGRAM_NOT_FOUND');
      throw new RedeemRewardInputError('PROGRAM_NOT_FOUND');
    }
    const product = await this.catalog.findProductByPosterProductId(req.posterProductId);
    if (!product) {
      await this.audit.recordRewardEvent(ctx, customer.id, REWARD_REDEMPTION_ACTIONS.FAILED, 'PRODUCT_NOT_FOUND');
      throw new RedeemRewardInputError('PRODUCT_NOT_FOUND');
    }
    const program = toRecord(programRow);

    // ---- 2. Idempotent replay, checked BEFORE opening any transaction: the SAME attemptId returns its already-decided state, untouched — no
    // re-validation, no new row, no repeated audit event.
    const existing = await this.redemptions.findByAttemptId(req.attemptId);
    if (existing) return toResponse(existing);

    // ---- 3. Re-validate eligibility SERVER-SIDE (never trust the widget's claim that this product/program is redeemable) — the exact same logic
    // checkout already uses, so there is no second "is this eligible" implementation anywhere in the codebase. Read-only; deliberately outside the
    // transaction below (see the class comment). The AUTHORITATIVE, race-safe re-check for the currently-unreachable confirmed path still happens
    // inside RewardRedemptionService.createRedemptionRecord's own transaction, exactly as Phase 8 already established — this call only decides which
    // failure reason to report today.
    const check = await this.eligibility.checkEligibility(program, customer.id, product.id);

    const attemptData: CreateAttemptData = {
      attemptId: req.attemptId,
      customerId: customer.id,
      rewardProgramId: program.id,
      rewardProductId: product.id,
      rewardProductName: product.name,
      posterAccount: ctx.account,
      posterSpotId: ctx.spotId,
      posterTabletId: ctx.tabletId,
      posterOrderId: req.posterOrderId,
      employeeIdentifier: req.employeeIdentifier ?? null,
    };

    // ---- 4a. Phase A — SHORT transaction: create/claim the attempt row. No Poster call happens in here.
    const claim = await this.prisma.runTransaction(async (tx) => {
      const { created, row } = await this.redemptions.createRequestedTx(tx, attemptData);
      if (!created) return { kind: 'replay' as const, row };

      if (!check.eligible) {
        const failed = await this.redemptions.markFailedTx(tx, row.id, mapEligibilityReason(check.reason));
        return { kind: 'terminal' as const, row: failed };
      }

      // ---- Phase 22.2 — ONE POSTER ORDER = MAXIMUM ONE REWARD REDEMPTION. Checked before the existing customer+program concurrency guard, scoped only
      // by posterOrderId (not customer/program), so a second reward PROGRAM cannot redeem onto the same order either. A customer's OTHER banked rewards
      // are completely unaffected — this only ever blocks a SECOND redemption on THIS SPECIFIC order.
      const alreadyRedeemed = await this.redemptions.findRedeemedForPosterOrderTx(tx, attemptData.posterOrderId);
      if (alreadyRedeemed) {
        const failed = await this.redemptions.markFailedTx(tx, row.id, 'REWARD_ALREADY_REDEEMED_FOR_ORDER');
        return { kind: 'terminal' as const, row: failed };
      }
      const orderConcurrent = await this.redemptions.findUnresolvedForPosterOrderTx(tx, attemptData.posterOrderId, row.id);
      if (orderConcurrent) {
        // Another attempt (any program) for this SAME order is still in flight right now — reuse the existing concurrency reason rather than invent a
        // second one; the effect for the caller is identical (safe conflict, no mutation attempted here).
        const failed = await this.redemptions.markFailedTx(tx, row.id, 'CONCURRENT_ATTEMPT_IN_PROGRESS');
        return { kind: 'terminal' as const, row: failed };
      }

      const concurrent = await this.redemptions.findUnresolvedForCustomerProgramTx(tx, customer.id, program.id);
      if (concurrent && concurrent.id !== row.id) {
        const failed = await this.redemptions.markFailedTx(tx, row.id, 'CONCURRENT_ATTEMPT_IN_PROGRESS');
        return { kind: 'terminal' as const, row: failed };
      }

      const claimed = await this.redemptions.markMutatingTx(tx, row.id);
      return { kind: 'claimed' as const, row: claimed };
    });

    // A true race with another request bearing the SAME attemptId landed here via the unique-constraint fallback inside createRequestedTx — return its
    // (already-decided, or still in-flight) state as-is, same as the earlier findByAttemptId check.
    if (claim.kind === 'replay') return toResponse(claim.row);

    let outcome: { row: AttemptRowLike; isNewAttempt: boolean };
    if (claim.kind === 'terminal') {
      outcome = { row: claim.row, isNewAttempt: true };
    } else {
      // ---- 4b. Phase B — OUTSIDE any transaction: the real Poster mutation. Up to three HTTP calls (list open transactions, add the product, re-read to
      // verify); this MUST NOT run inside a DB transaction (see the class comment).
      const support = this.mutation.isSupported();
      const result = support.supported
        ? await this.mutation.applyToOrder({ posterAccount: ctx.account, posterSpotId: ctx.spotId, posterTabletId: ctx.tabletId, posterOrderId: req.posterOrderId, posterProductId: req.posterProductId })
        : ({ kind: 'blocked', reason: support.reason } as const);

      // ---- 4c. Phase C — a SECOND short transaction: commit the terminal outcome based on B's result.
      outcome = await this.prisma.runTransaction(async (tx) => {
        if (result.kind === 'rejected') {
          const failed = await this.redemptions.markFailedTx(tx, claim.row.id, 'POSTER_REJECTED');
          return { row: failed, isNewAttempt: true as const };
        }
        if (result.kind !== 'confirmed') {
          // 'blocked' (defensive fallback — should be unreachable, isSupported() is hardcoded true) or 'ambiguous' (network/timeout/malformed/verification
          // mismatch) — the outcome is UNKNOWN, never treated as success, never auto-retried.
          const failureReason = result.kind === 'blocked' ? 'BLOCKED_NO_VERIFIED_POSTER_MUTATION' : null;
          const unknown = await this.redemptions.markUnknownTx(tx, claim.row.id, failureReason);
          return { row: unknown, isNewAttempt: true as const };
        }
        const resolvedReward = { programId: program.id, programName: program.name, productId: product.id, posterProductId: product.posterProductId, quantity: program.rewardQuantity, buyQuantitySnapshot: program.buyQuantity, qualifyingCategoryId: program.qualifyingCategoryId, qualifyingCategoryName: program.qualifyingCategory.name, productName: product.name };
        const redemptionId = await this.rewardRedemptionService.createRedemptionRecord(tx, resolvedReward, customer.id, null);
        const redeemed = await this.redemptions.markRedeemedTx(tx, claim.row.id, redemptionId, attemptData.posterOrderId);
        return { row: redeemed, isNewAttempt: true as const };
      });
    }

    // ---- 5. Audit AFTER the transaction has closed (see the class comment for why this must never move back inside it).
    if (outcome.isNewAttempt) {
      await this.audit.recordRewardEvent(ctx, customer.id, REWARD_REDEMPTION_ACTIONS.REQUESTED, 'REQUESTED');
      const terminalAction = outcome.row.status === 'REDEEMED' ? REWARD_REDEMPTION_ACTIONS.CONFIRMED : outcome.row.status === 'UNKNOWN' ? REWARD_REDEMPTION_ACTIONS.UNKNOWN : REWARD_REDEMPTION_ACTIONS.FAILED;
      await this.audit.recordRewardEvent(ctx, customer.id, terminalAction, outcome.row.failureReason ?? outcome.row.status);
    }

    return toResponse(outcome.row);
  }
}

function toResponse(row: AttemptRowLike): RedeemRewardResponse {
  return {
    attemptId: row.attemptId,
    status: row.status as RedeemRewardResponse['status'],
    failureReason: (row.failureReason as RedemptionFailureReason | null) ?? null,
    productName: row.rewardProductName,
  };
}

function mapEligibilityReason(reason: string | null): RedemptionFailureReason {
  switch (reason) {
    case 'INACTIVE':
      return 'PROGRAM_INACTIVE';
    case 'NOT_STARTED':
      return 'PROGRAM_NOT_STARTED';
    case 'EXPIRED':
      return 'PROGRAM_EXPIRED';
    case 'PRODUCT_INACTIVE':
      return 'PRODUCT_INACTIVE';
    case 'PRODUCT_NOT_QUALIFYING':
      return 'PRODUCT_NOT_QUALIFYING';
    case 'NO_REWARD_AVAILABLE':
    default:
      return 'NO_REWARD_AVAILABLE';
  }
}
