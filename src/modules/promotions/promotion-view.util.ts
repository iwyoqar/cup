import { PromotionBenefitType } from './promotion-benefit-allowlist';
import { PromotionBenefitView } from './promotion.types';

interface BenefitSource {
  benefitType: string;
  benefitValue: number | null;
  benefitProduct: { id: string; name: string } | null;
  benefitQuantity: number | null;
}

// The one place a Promotion's LIVE benefit definition is mapped to its response shape — reused
// by the admin list/detail views and the customer-facing view, so the mapping never drifts
// between them. Deliberately distinct from a PromotionRedemption's benefit SNAPSHOT (see
// promotion-redemption.service.ts's buildRedemptionData) — this always reflects the Promotion's
// CURRENT definition, not what a past redemption actually used.
export function toBenefitView(source: BenefitSource): PromotionBenefitView {
  return {
    type: source.benefitType as PromotionBenefitType,
    value: source.benefitValue,
    product: source.benefitProduct ? { id: source.benefitProduct.id, name: source.benefitProduct.name } : null,
    quantity: source.benefitQuantity,
  };
}
