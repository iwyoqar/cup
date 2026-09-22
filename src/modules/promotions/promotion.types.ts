import { PromotionBenefitType, PromotionEligibilityReason } from './promotion-benefit-allowlist';

// Structural shape of a Promotion row with its benefit product joined — used by
// PromotionEligibilityService/PromotionCalculationService/PromotionRedemptionService instead of
// importing Prisma's generated type directly, same pattern as SegmentRow/CampaignRow in the
// Phase 5/6 services.
export interface PromotionRecord {
  id: string;
  name: string;
  segmentId: string | null;
  benefitType: string;
  benefitValue: number | null;
  benefitProductId: string | null;
  benefitProduct: { id: string; name: string; isActive: boolean } | null;
  benefitQuantity: number | null;
  startsAt: Date;
  endsAt: Date | null;
  isActive: boolean;
  usageLimitPerCustomer: number | null;
}

export interface EligibilityResult {
  eligible: boolean;
  promotionId: string;
  reason: PromotionEligibilityReason | null;
}

// Response shapes — never the raw Prisma model.

export interface PromotionBenefitView {
  type: PromotionBenefitType;
  value: number | null;
  product: { id: string; name: string } | null;
  quantity: number | null;
}

export interface PromotionListItem {
  id: string;
  name: string;
  segment: { id: string; name: string } | null;
  benefit: PromotionBenefitView;
  isActive: boolean;
  startsAt: string;
  endsAt: string | null;
  usageLimitPerCustomer: number | null;
  updatedAt: string;
}

export interface PromotionListPage {
  items: PromotionListItem[];
  nextCursor: string | null;
}

export interface PromotionView {
  id: string;
  name: string;
  description: string | null;
  segment: { id: string; name: string } | null;
  benefit: PromotionBenefitView;
  startsAt: string;
  endsAt: string | null;
  isActive: boolean;
  usageLimitPerCustomer: number | null;
  redemptionCount: number;
  hasRedemptions: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AudienceCandidateView {
  customerId: string;
  displayName: string | null;
  phone: string | null;
  eligible: boolean;
  reason: PromotionEligibilityReason | null;
}

export interface PromotionAudiencePreviewPage {
  segmentMatchCount: number;
  eligibleCount: number;
  ineligibleCount: number;
  items: AudienceCandidateView[];
  nextCursor: string | null;
}

export interface PromotionRedemptionItem {
  customerId: string;
  displayName: string | null;
  phone: string | null;
  usageIndex: number;
  benefit: PromotionBenefitView;
  orderId: string | null;
  redeemedAt: string;
}

export interface PromotionRedemptionsPage {
  items: PromotionRedemptionItem[];
  nextCursor: string | null;
}

// GET /promotions — customer-facing, deliberately minimal (spec's example response shape).
export interface CustomerPromotionView {
  id: string;
  name: string;
  description: string | null;
  benefit: PromotionBenefitView;
  startsAt: string;
  endsAt: string | null;
  remainingUses: number | null;
}
