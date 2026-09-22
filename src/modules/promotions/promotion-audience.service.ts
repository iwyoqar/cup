import { Injectable } from '@nestjs/common';
import { CustomerMetricsService } from '../customer-metrics/customer-metrics.service';
import { SegmentsService } from '../segments/segments.service';
import { PromotionAudienceRepository } from './promotion-audience.repository';
import { PromotionEligibilityService } from './promotion-eligibility.service';
import { PromotionAudiencePreviewPage, PromotionRecord } from './promotion.types';

// Mirrors CampaignAudienceService's role exactly: resolves WHO a promotion's audience is
// (segment membership, or every customer for a globally-targeted promotion) crossed with
// eligibility (via the one canonical PromotionEligibilityService), for the read-only admin
// preview endpoint. Never creates a redemption, never mutates loyalty/orders/segments/customers.
@Injectable()
export class PromotionAudienceService {
  constructor(
    private readonly segmentsService: SegmentsService,
    private readonly customerMetricsService: CustomerMetricsService,
    private readonly eligibilityService: PromotionEligibilityService,
    private readonly repository: PromotionAudienceRepository,
  ) {}

  async previewAudience(promotion: PromotionRecord, options: { cursor?: string; limit: number }): Promise<PromotionAudiencePreviewPage> {
    const candidateIds = promotion.segmentId
      ? ((await this.segmentsService.getAllMatchingCustomerIds(promotion.segmentId)) ?? [])
      : (await this.customerMetricsService.findAllCustomerIds()).map((c) => c.id);

    const results = await this.eligibilityService.evaluateBulk(promotion, candidateIds);
    const eligibleCount = candidateIds.filter((id) => results.get(id)?.eligible).length;

    const sorted = [...candidateIds].sort();
    const cursorIndex = options.cursor ? sorted.indexOf(options.cursor) : -1;
    const startIndex = cursorIndex >= 0 ? cursorIndex + 1 : 0;
    const page = sorted.slice(startIndex, startIndex + options.limit + 1);
    const hasMore = page.length > options.limit;
    const pageTrimmed = hasMore ? page.slice(0, options.limit) : page;

    const profiles = await this.repository.findCustomerProfilesByIds(pageTrimmed);
    const profileById = new Map(profiles.map((p) => [p.id, p]));

    return {
      segmentMatchCount: candidateIds.length,
      eligibleCount,
      ineligibleCount: candidateIds.length - eligibleCount,
      items: pageTrimmed.map((id) => {
        const profile = profileById.get(id);
        const result = results.get(id);
        return {
          customerId: id,
          displayName: profile?.displayName ?? null,
          phone: profile?.phone ?? null,
          eligible: result?.eligible ?? false,
          reason: result?.reason ?? null,
        };
      }),
      nextCursor: hasMore ? pageTrimmed[pageTrimmed.length - 1] : null,
    };
  }
}
