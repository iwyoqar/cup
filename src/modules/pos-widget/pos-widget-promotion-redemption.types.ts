// Phase 23 — types shared by the promotion redemption service/repository/controller. Mirrors pos-widget-reward-redemption.types.ts exactly; see
// docs/PHASE-23-PROMOTIONS.md for the Poster mutation mechanism (verified for FREE_PRODUCT / LOYALTY_POINTS only — PERCENT_DISCOUNT / FIXED_DISCOUNT
// have no known Poster mechanism to apply a discount to an order and always resolve BLOCKED_NO_VERIFIED_POSTER_MUTATION).

export type PromotionRedemptionAttemptStatus = 'REQUESTED' | 'POSTER_MUTATING' | 'REDEEMED' | 'FAILED' | 'UNKNOWN';

export type PromotionRedemptionFailureReason =
  | 'BLOCKED_NO_VERIFIED_POSTER_MUTATION' // PERCENT_DISCOUNT / FIXED_DISCOUNT today; a defensive fallback for FREE_PRODUCT/LOYALTY_POINTS otherwise
  | 'CUSTOMER_NOT_FOUND'
  | 'PROMOTION_NOT_FOUND'
  | 'PROMOTION_INACTIVE'
  | 'PROMOTION_NOT_STARTED'
  | 'PROMOTION_EXPIRED'
  | 'SEGMENT_MISMATCH'
  | 'USAGE_LIMIT_REACHED'
  | 'INVALID_BENEFIT'
  | 'NOT_ELIGIBLE'
  | 'CONCURRENT_ATTEMPT_IN_PROGRESS'
  | 'PROMOTION_ALREADY_REDEEMED_FOR_ORDER' // Phase 23 — mirrors Phase 22.3's REWARD_ALREADY_REDEEMED_FOR_ORDER; a SEPARATE invariant from it
  | 'POSTER_REJECTED';

export interface RedeemPromotionRequest {
  attemptId: string; // widget-generated idempotency key, one per confirm press
  posterClientId: string;
  posterOrderId: string; // widget's orders.getActive().order.id claim — independently re-resolved server-side, never trusted directly
  promotionId: string;
  employeeIdentifier?: string | null;
}

export interface RedeemPromotionResponse {
  attemptId: string;
  status: PromotionRedemptionAttemptStatus;
  failureReason: PromotionRedemptionFailureReason | null;
  promotionName: string | null;
}
