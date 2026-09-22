import { Injectable, Logger } from '@nestjs/common';
import { PrismaTransactionClient } from '../../common/prisma/prisma.service';
import { CatalogRepository } from '../catalog/catalog.repository';
import { RewardEligibilityService } from './reward-eligibility.service';
import { RewardProgressRepository } from './reward-progress.repository';
import { RewardRedemptionsRepository } from './reward-redemptions.repository';
import { RewardProgramNotFoundError, RewardNotEligibleError } from './reward-programs.errors';
import { RewardProgramsRepository } from './reward-programs.repository';

export interface ResolvedCheckoutReward {
  programId: string;
  programName: string;
  productId: string;
  posterProductId: string;
  quantity: number;
  buyQuantitySnapshot: number;
  qualifyingCategoryId: string;
  qualifyingCategoryName: string;
  productName: string;
}

// CRITICAL EXTERNAL SIDE EFFECT ORDER (spec's own heading): there is deliberately NO standalone
// "redeem" entry point here that a controller could call directly — the only two entry points
// are resolveForCheckout() (read-only, called BEFORE the Poster call) and
// createRedemptionRecord() (a write, called by OrdersService AFTER Poster has confirmed
// success). This split is the actual safety mechanism:
//
//   - Poster call fails (definite or ambiguous) -> createRedemptionRecord is NEVER called ->
//     the reward was never consumed -> still available on the next attempt. No compensating
//     "undo" logic is needed because nothing was ever written.
//   - Poster call succeeds -> createRedemptionRecord runs in the SAME database transaction as
//     OrdersRepository.updateAfterPosterSuccess + IdempotencyRepository.markCompleted (see
//     orders.service.ts's sendToPoster). Either all three commit or none do.
//   - A crash between "Poster confirmed success" and that transaction committing leaves the
//     IdempotencyKey 'in_progress', which the EXISTING staleness machinery downgrades to
//     'uncertain' on the next attempt (orders.service.ts's markStaleInProgressAsUncertain) —
//     requiring manual reconciliation before any further checkout on that cart. In this exact
//     narrow window the reward remains available even though a real Poster order was created.
//     This is a genuine, accepted, DOCUMENTED failure window (spec explicitly anticipates and
//     permits this exact case) — not a fabricated guarantee. It is the same class of gap this
//     project already accepts for OrderStatusNotification's "a pending row is never
//     auto-retried" tradeoff.
//   - A retried checkout with the SAME Idempotency-Key after a 'completed' outcome never
//     re-enters this code at all — OrdersService.createOrder's existing replay path returns the
//     stored response directly, so a duplicate redemption is structurally impossible for that
//     case, with no new code required to prevent it.
//
// No public HTTP endpoint calls createRedemptionRecord directly — matching the same
// "internal-only redemption, no standalone redeem endpoint" decision Phase 7 made for
// PromotionRedemptionService, for the same reason (spec: "Never expose a generic public
// redemption endpoint... tie it to an actual order/checkout transaction").
@Injectable()
export class RewardRedemptionService {
  private readonly logger = new Logger(RewardRedemptionService.name);

  constructor(
    private readonly programsRepository: RewardProgramsRepository,
    private readonly eligibilityService: RewardEligibilityService,
    private readonly catalogRepository: CatalogRepository,
    private readonly redemptionsRepository: RewardRedemptionsRepository,
    private readonly progressRepository: RewardProgressRepository,
  ) {}

  // Called from the explicit cart-selection endpoint (POST /cart/reward) — throws a specific,
  // actionable error so the customer gets clear feedback about why their selection was rejected.
  async validateSelection(programId: string, customerId: string, productId: string): Promise<void> {
    const program = await this.programsRepository.findById(programId);
    if (!program) {
      throw new RewardProgramNotFoundError();
    }
    const result = await this.eligibilityService.checkEligibility(program, customerId, productId);
    if (!result.eligible) {
      throw new RewardNotEligibleError(result.reason!);
    }
  }

  // Called from CartService.checkout(), inside the checkout lock — re-validates everything
  // fresh, never trusting the earlier cart-selection validation (state can change in between).
  // Returns null (never throws) when no longer eligible: an earned reward disappearing between
  // selection and submission must not block an otherwise-valid checkout — it simply proceeds
  // without the reward, exactly like spec's Case A ("reward selected, checkout validation
  // fails... reward remains available" — generalized to "reward silently not applied" here
  // since the CART itself is still valid, only the reward isn't).
  async resolveForCheckout(customerId: string, programId: string | null, productId: string | null): Promise<ResolvedCheckoutReward | null> {
    if (!programId || !productId) {
      return null;
    }
    const program = await this.programsRepository.findById(programId);
    if (!program) {
      return null;
    }
    const result = await this.eligibilityService.checkEligibility(program, customerId, productId);
    if (!result.eligible) {
      return null;
    }
    const product = await this.catalogRepository.findProductById(productId);
    if (!product) {
      return null; // defensive; checkEligibility already confirmed this product exists and is active
    }
    return {
      programId: program.id,
      programName: program.name,
      productId: product.id,
      posterProductId: product.posterProductId,
      quantity: program.rewardQuantity,
      buyQuantitySnapshot: program.buyQuantity,
      qualifyingCategoryId: program.qualifyingCategoryId,
      qualifyingCategoryName: program.qualifyingCategory.name,
      productName: product.name,
    };
  }

  // The one write in this service — see the module comment above for exactly when/why this is
  // called.
  //
  // CORRECTED after live verification (a 5-way concurrent-call test against this method alone,
  // bypassing the checkout lock, produced 5 successful redemptions with only 1 actually earned):
  // the (rewardProgramId, customerId, redemptionIndex) unique constraint by itself does NOT
  // enforce availableRewards as an upper bound — it only prevents two callers from claiming the
  // SAME index. Because Prisma's interactive transactions automatically retry their callback on
  // a write conflict, each retry re-reads a FRESH (now-higher) count and simply claims the next
  // index, so naively computing `redemptionIndex = currentCount + 1` with no other check lets
  // concurrent callers walk straight past the real limit. Fixed by re-deriving
  // totalQualifying/totalEarned THROUGH THIS SAME TRANSACTION and refusing to exceed it — this
  // is what actually makes the DB the final word, not merely index-uniqueness. In the real
  // checkout call path this is still normally redundant with the checkout lock (which prevents
  // concurrent calls for one customer in the first place) — this fix is what makes that
  // redundancy real defense-in-depth instead of a false claim.
  // Phase 22: `orderId` widened to `string | null` (the repository already allowed null — see reward-redemptions.repository.ts's CreateRewardRedemptionData
  // — only this method's signature was narrower than necessary) and the method now returns the created row's id, so a POS-originated redemption (no CUP
  // Order at all) can pass `null` and still record which RewardRedemption it produced. Existing callers (orders.service.ts) are unaffected: they still pass
  // a real CUP order id and simply do not use the now-available return value.
  async createRedemptionRecord(tx: PrismaTransactionClient, reward: ResolvedCheckoutReward, customerId: string, orderId: string | null): Promise<string> {
    const [totalQualifying, currentCount] = await Promise.all([
      this.progressRepository.sumQualifyingQuantityTx(tx, customerId, reward.qualifyingCategoryId),
      this.redemptionsRepository.countForCustomerTx(tx, reward.programId, customerId),
    ]);
    const totalEarned = Math.floor(totalQualifying / reward.buyQuantitySnapshot);
    if (currentCount >= totalEarned) {
      // Expected to be unreachable via the real checkout call path (see the comment above) —
      // logged loudly rather than silently swallowed, since reaching this means something
      // upstream let a redemption attempt through without a currently-available reward.
      this.logger.error(
        `Refused to create reward redemption for customer=${customerId} program=${reward.programId}: ` +
          `currentCount=${currentCount} >= totalEarned=${totalEarned}.`,
      );
      throw new RewardNotEligibleError('NO_REWARD_AVAILABLE');
    }

    const created = await this.redemptionsRepository.create(tx, {
      rewardProgramId: reward.programId,
      customerId,
      orderId,
      redemptionIndex: currentCount + 1,
      rewardProductId: reward.productId,
      rewardProductName: reward.productName,
      rewardQuantity: reward.quantity,
      buyQuantitySnapshot: reward.buyQuantitySnapshot,
      qualifyingCategoryName: reward.qualifyingCategoryName,
    });
    return created.id;
  }
}
