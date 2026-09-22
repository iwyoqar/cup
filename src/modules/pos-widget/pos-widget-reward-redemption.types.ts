// Phase 22 — types shared by the redemption service/repository/controller. The Poster mutation mechanism (REST transactions.addTransactionProduct,
// price 0) is implemented and verified live — see docs/PHASE-22-AUDIT.md §15. Phase 22.2 adds the "one Poster order = max one reward redemption" rule.

export type RedemptionAttemptStatus = 'REQUESTED' | 'VALIDATING' | 'POSTER_MUTATING' | 'POSTER_CONFIRMED' | 'REDEEMED' | 'FAILED' | 'UNKNOWN';

// Machine-readable, never a free-text message (the widget maps each to its own Uzbek copy — see App.tsx).
export type RedemptionFailureReason =
  | 'BLOCKED_NO_VERIFIED_POSTER_MUTATION' // defensive fallback only — PosterRewardMutationService.isSupported() is hardcoded true, unreachable in practice
  | 'CUSTOMER_NOT_FOUND'
  | 'CUSTOMER_CHANGED'
  | 'ORDER_CHANGED'
  | 'PROGRAM_NOT_FOUND'
  | 'PROGRAM_INACTIVE'
  | 'PROGRAM_NOT_STARTED'
  | 'PROGRAM_EXPIRED'
  | 'PRODUCT_NOT_FOUND'
  | 'PRODUCT_INACTIVE'
  | 'PRODUCT_NOT_QUALIFYING'
  | 'NO_REWARD_AVAILABLE'
  | 'CONCURRENT_ATTEMPT_IN_PROGRESS'
  | 'REWARD_ALREADY_REDEEMED_FOR_ORDER' // Phase 22.2 — this Poster order already has a successful redemption; a customer's OTHER banked rewards are unaffected, just not usable on THIS order
  | 'POSTER_REJECTED';

export interface RedeemRewardRequest {
  attemptId: string; // widget-generated idempotency key (one per confirm press, reused only if THAT click is retried by the widget itself — see store.ts)
  posterClientId: string; // the Poster client id attached to the CURRENT order (same identifier the GET overview already uses)
  posterOrderId: string; // order id as reported by the widget's orders.getActive() — an unverified claim until independently checked (docs §8)
  rewardProgramId: string;
  posterProductId: string; // the selected reward product, by Poster's OWN catalog id (never a CUP internal id — see catalog.repository.ts)
  employeeIdentifier?: string | null; // audit-only (Poster's active user), never a security identity
}

export interface RedeemRewardResponse {
  attemptId: string;
  status: RedemptionAttemptStatus;
  failureReason: RedemptionFailureReason | null;
  productName: string | null;
}
