// Phase 7: the explicit allowlist a promotion's benefit must satisfy before it is ever
// persisted — same "never arbitrary input, always an explicit allowlist" philosophy as
// src/modules/segments/segment-condition-allowlist.ts. Exactly which of benefitValue/
// benefitProductId/benefitQuantity are required (and how benefitValue is bounded) is fully
// determined by benefitType; see promotions.service.ts's validateBenefit for the DB-dependent
// parts (product existence/active state) this file alone can't express.

export const PROMOTION_BENEFIT_TYPES = ['PERCENT_DISCOUNT', 'FIXED_DISCOUNT', 'FREE_PRODUCT', 'LOYALTY_POINTS'] as const;
export type PromotionBenefitType = (typeof PROMOTION_BENEFIT_TYPES)[number];

export function isPromotionBenefitType(value: string): value is PromotionBenefitType {
  return (PROMOTION_BENEFIT_TYPES as readonly string[]).includes(value);
}

export const PROMOTION_ELIGIBILITY_REASONS = [
  'INACTIVE',
  'NOT_STARTED',
  'EXPIRED',
  'SEGMENT_MISMATCH',
  'USAGE_LIMIT_REACHED',
  'INVALID_BENEFIT',
  'NOT_ELIGIBLE',
] as const;
export type PromotionEligibilityReason = (typeof PROMOTION_ELIGIBILITY_REASONS)[number];
