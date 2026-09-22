import { Injectable } from '@nestjs/common';
import { SegmentsService } from '../segments/segments.service';
import { PromotionEligibilityReason } from './promotion-benefit-allowlist';
import { PromotionRedemptionsRepository } from './promotion-redemptions.repository';
import { EligibilityResult, PromotionRecord } from './promotion.types';

// The single source of truth for "is this promotion usable by this customer right now" — reused
// by audience preview, the customer-facing promotions list, and (internally) redemption. Takes
// an already-loaded PromotionRecord rather than a promotionId: keeps this service's own
// dependencies minimal (no PromotionsRepository) and makes the caller (PromotionsService,
// PromotionRedemptionService, PromotionAudienceService) responsible for loading it once, not
// this service re-fetching it on every check.
@Injectable()
export class PromotionEligibilityService {
  constructor(
    private readonly segmentsService: SegmentsService,
    private readonly redemptionsRepository: PromotionRedemptionsRepository,
  ) {}

  // Single-customer check — independently re-verifies segment membership (via the same
  // canonical segment evaluator SegmentsService already owns, never a second implementation),
  // since the caller has not pre-filtered by segment the way audience preview does.
  async checkEligibility(promotion: PromotionRecord, customerId: string): Promise<EligibilityResult> {
    const staticReason = this.checkPromotionLevel(promotion);
    if (staticReason) {
      return { eligible: false, promotionId: promotion.id, reason: staticReason };
    }

    if (promotion.segmentId) {
      // Phase 16: the SAME evaluator, but only for THIS customer (a fixed number of bulk lookups for one id) instead of evaluating the segment over
      // every customer just to test one — identical result, and what keeps a Staff scan fast on a large customer base.
      const matching = await this.segmentsService.filterCustomersInSegment(promotion.segmentId, [customerId]);
      if (!matching || !matching.has(customerId)) {
        return { eligible: false, promotionId: promotion.id, reason: 'SEGMENT_MISMATCH' };
      }
    }

    const usageReason = await this.checkUsageLimit(promotion, customerId);
    if (usageReason) {
      return { eligible: false, promotionId: promotion.id, reason: usageReason };
    }

    return { eligible: true, promotionId: promotion.id, reason: null };
  }

  // Bulk variant for audience preview — ASSUMES the caller (PromotionAudienceService) has
  // already restricted customerIds to the promotion's audience (segment members, or every
  // customer for a globally-targeted promotion); segment membership itself is not re-checked
  // here; only the promotion-level state and the per-customer usage limit are evaluated, both
  // via bounded queries (one groupBy for usage counts, never a per-customer query).
  async evaluateBulk(promotion: PromotionRecord, customerIds: string[]): Promise<Map<string, EligibilityResult>> {
    const result = new Map<string, EligibilityResult>();
    const staticReason = this.checkPromotionLevel(promotion);
    if (staticReason) {
      for (const id of customerIds) {
        result.set(id, { eligible: false, promotionId: promotion.id, reason: staticReason });
      }
      return result;
    }

    if (promotion.usageLimitPerCustomer === null) {
      for (const id of customerIds) {
        result.set(id, { eligible: true, promotionId: promotion.id, reason: null });
      }
      return result;
    }

    const counts = await this.redemptionsRepository.countByCustomerIds(promotion.id, customerIds);
    for (const id of customerIds) {
      const count = counts.get(id) ?? 0;
      if (count >= promotion.usageLimitPerCustomer) {
        result.set(id, { eligible: false, promotionId: promotion.id, reason: 'USAGE_LIMIT_REACHED' });
      } else {
        result.set(id, { eligible: true, promotionId: promotion.id, reason: null });
      }
    }
    return result;
  }

  // active? -> within validity? -> benefit still valid? — the three checks that depend only on
  // the promotion's own current state, never on which customer is asking.
  private checkPromotionLevel(promotion: PromotionRecord): PromotionEligibilityReason | null {
    if (!promotion.isActive) {
      return 'INACTIVE';
    }
    const now = new Date();
    if (now < promotion.startsAt) {
      return 'NOT_STARTED';
    }
    if (promotion.endsAt && now > promotion.endsAt) {
      return 'EXPIRED';
    }
    if (!this.isBenefitCurrentlyValid(promotion)) {
      return 'INVALID_BENEFIT';
    }
    return null;
  }

  // Only FREE_PRODUCT depends on external mutable state (the referenced Product's current
  // active flag) — a product deactivated after the promotion was created/activated must not
  // remain silently redeemable (spec: "future redemption should fail safely if the promotion
  // requires an unavailable product"). Other benefit types have no such dependency.
  private isBenefitCurrentlyValid(promotion: PromotionRecord): boolean {
    if (promotion.benefitType === 'FREE_PRODUCT') {
      return promotion.benefitProduct !== null && promotion.benefitProduct.isActive;
    }
    return true;
  }

  private async checkUsageLimit(promotion: PromotionRecord, customerId: string): Promise<PromotionEligibilityReason | null> {
    if (promotion.usageLimitPerCustomer === null) {
      return null;
    }
    const count = await this.redemptionsRepository.countForCustomer(promotion.id, customerId);
    return count >= promotion.usageLimitPerCustomer ? 'USAGE_LIMIT_REACHED' : null;
  }
}
