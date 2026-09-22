import { Injectable } from '@nestjs/common';
import { isUniqueConstraintViolation } from '../../common/util/prisma-errors';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { PromotionEligibilityService } from './promotion-eligibility.service';
import { CreateRedemptionData, PromotionRedemptionsRepository } from './promotion-redemptions.repository';
import { PromotionNotEligibleError, PromotionRedemptionRaceError } from './promotions.errors';
import { PromotionRecord } from './promotion.types';

const MAX_CLAIM_ATTEMPTS = 5;

export interface RedemptionResult {
  redemptionId: string;
  usageIndex: number;
}

// INTERNAL service only — deliberately no public HTTP endpoint (spec: "Do NOT expose a generic
// public redemption endpoint unless there is a clear checkout use case... create only the
// internal PromotionRedemptionService and defer public redemption"). This is the future
// checkout integration point: a later phase's checkout flow would call redeem() after its own
// order/idempotency guarantees are already established (see the CRITICAL ORDER INTEGRATION
// BOUNDARY note below) — nothing in Phase 7 calls this from an HTTP-reachable path.
//
// CRITICAL ORDER INTEGRATION BOUNDARY: this method's own race-safety (the usageIndex claim loop
// below) guarantees two concurrent redeem() calls for the SAME customer+promotion cannot both
// succeed past usageLimitPerCustomer. It does NOT by itself make a RETRIED checkout request
// idempotent (e.g. "the same idempotency-keyed checkout call must never redeem twice") — that
// guarantee has to come from whichever future caller invokes this exactly once per logical
// checkout attempt, the same way OrdersService's own idempotency machinery already decides
// whether to call Poster at all before anything downstream (like this) would ever run. Do not
// call this from a path that could itself be retried without that protection already in place.
@Injectable()
export class PromotionRedemptionService {
  constructor(
    private readonly eligibilityService: PromotionEligibilityService,
    private readonly redemptionsRepository: PromotionRedemptionsRepository,
    private readonly loyaltyService: LoyaltyService,
  ) {}

  // Caller is responsible for loading the PromotionRecord (see PromotionEligibilityService's
  // own comment on why it takes an already-loaded record rather than a promotionId).
  async redeem(promotion: PromotionRecord, customerId: string, options: { orderId?: string | null } = {}): Promise<RedemptionResult> {
    // Checked once up front: active/validity/benefit-valid/segment-match do not change across
    // the retry loop below, so there is no reason to re-derive them on every claim attempt.
    const staticEligibility = await this.eligibilityService.checkEligibility(promotion, customerId);
    if (!staticEligibility.eligible) {
      throw new PromotionNotEligibleError(staticEligibility.reason!);
    }

    for (let attempt = 0; attempt < MAX_CLAIM_ATTEMPTS; attempt++) {
      const currentCount = await this.redemptionsRepository.countForCustomer(promotion.id, customerId);
      if (promotion.usageLimitPerCustomer !== null && currentCount >= promotion.usageLimitPerCustomer) {
        throw new PromotionNotEligibleError('USAGE_LIMIT_REACHED');
      }
      const usageIndex = currentCount + 1;

      try {
        const created = await this.redemptionsRepository.create(buildRedemptionData(promotion, customerId, usageIndex, options.orderId ?? null));

        if (promotion.benefitType === 'LOYALTY_POINTS' && promotion.benefitValue) {
          await this.loyaltyService.creditPoints(customerId, promotion.benefitValue, {
            description: `Promotion: ${promotion.name}`,
            orderId: options.orderId ?? null,
          });
        }

        return { redemptionId: created.id, usageIndex };
      } catch (err) {
        if (isUniqueConstraintViolation(err)) {
          // Lost the race for this exact usageIndex slot — another concurrent call for the same
          // customer+promotion claimed it first. Re-read the now-current count and retry; this
          // is what makes the usage-limit check itself race-safe (see schema.prisma's comment on
          // PromotionRedemption.usageIndex), not a generic blind retry.
          continue;
        }
        throw err;
      }
    }

    // Effectively unreachable in practice — would require MAX_CLAIM_ATTEMPTS consecutive races
    // for the exact same customer+promotion.
    throw new PromotionRedemptionRaceError();
  }
}

function buildRedemptionData(promotion: PromotionRecord, customerId: string, usageIndex: number, orderId: string | null): CreateRedemptionData {
  return {
    promotionId: promotion.id,
    customerId,
    orderId,
    usageIndex,
    benefitType: promotion.benefitType,
    benefitValue: promotion.benefitValue,
    benefitProductId: promotion.benefitProductId,
    benefitProductName: promotion.benefitProduct?.name ?? null,
    benefitQuantity: promotion.benefitQuantity,
  };
}
