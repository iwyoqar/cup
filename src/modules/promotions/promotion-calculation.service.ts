import { Injectable } from '@nestjs/common';
import { PromotionRecord } from './promotion.types';

export type BenefitCalculationResult =
  | { type: 'PERCENT_DISCOUNT'; discountMinor: number }
  | { type: 'FIXED_DISCOUNT'; discountMinor: number }
  | { type: 'FREE_PRODUCT'; productId: string; productName: string; quantity: number }
  | { type: 'LOYALTY_POINTS'; points: number };

// Deterministic, pure benefit-calculation logic — the clean application boundary Phase 7 asks
// for, NOT wired into real checkout yet (see promotion-redemption.service.ts's module comment
// on why). Takes an already server-computed orderTotalMinor; never reads or trusts a
// client-supplied price. Kept to whole-order discount scope only (spec: "entire eligible
// order" — no product-specific selection, no category combinations, no stacking), matching
// this phase's explicit "correctness over feature count" instruction.
@Injectable()
export class PromotionCalculationService {
  calculateForOrderTotal(promotion: PromotionRecord, orderTotalMinor: number): BenefitCalculationResult {
    switch (promotion.benefitType) {
      case 'PERCENT_DISCOUNT': {
        const raw = Math.floor((orderTotalMinor * (promotion.benefitValue ?? 0)) / 100);
        return { type: 'PERCENT_DISCOUNT', discountMinor: clamp(raw, orderTotalMinor) };
      }
      case 'FIXED_DISCOUNT': {
        return { type: 'FIXED_DISCOUNT', discountMinor: clamp(promotion.benefitValue ?? 0, orderTotalMinor) };
      }
      case 'FREE_PRODUCT': {
        return {
          type: 'FREE_PRODUCT',
          productId: promotion.benefitProductId ?? '',
          productName: promotion.benefitProduct?.name ?? '',
          quantity: promotion.benefitQuantity ?? 1,
        };
      }
      case 'LOYALTY_POINTS': {
        return { type: 'LOYALTY_POINTS', points: promotion.benefitValue ?? 0 };
      }
      default:
        throw new Error(`Unknown promotion benefit type: ${promotion.benefitType}`);
    }
  }
}

// Never negative, never more than the order itself — a discount can reduce a total to zero but
// never below it.
function clamp(discountMinor: number, orderTotalMinor: number): number {
  return Math.max(0, Math.min(discountMinor, orderTotalMinor));
}
