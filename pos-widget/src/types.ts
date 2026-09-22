// The overview the CUP backend returns (GET /pos-widget/overview). Nothing here is an internal id: customers are shown by name, a masked phone and their public code.
export type OverviewState = 'FOUND' | 'NOT_FOUND' | 'NOT_LINKED' | 'AMBIGUOUS';

export interface PromotionView {
  promotionId: string; // not personal data — required to reference this promotion in a redemption request (Phase 23)
  name: string;
  description: string | null;
  benefit: { type: string; value: number | null; product: { name: string } | null; quantity: number | null };
  endsAt: string | null;
  remainingUses: number | null;
}

export interface EligibleRewardProduct {
  posterProductId: string; // Poster's OWN catalog id — never a CUP internal id (see the backend's catalog.repository.ts)
  name: string;
  // Deliberately NO price field: a live catalog check during this phase's own verification found current synced prices for several coffee products
  // wildly inconsistent with earlier verified figures (see the Phase 22 report) — an unrelated, pre-existing data-quality issue, not something this
  // phase touches, but reason enough not to display any Poster-derived money figure here (same caution Phase 21 already applies to order totals).
}

export interface RewardProgramView {
  programId: string; // not personal data — required to reference this program in a redemption request
  name: string;
  threshold: number;
  progress: number;
  remaining: number;
  available: number;
  eligibleProducts: EligibleRewardProduct[];
}

// Phase 22 — the redemption attempt lifecycle, mirrored exactly from the backend's pos-widget-reward-redemption.types.ts. UNKNOWN is a real terminal-ish
// state the widget must show plainly and never paper over with a retry.
export type RedemptionAttemptStatus = 'REQUESTED' | 'VALIDATING' | 'POSTER_MUTATING' | 'POSTER_CONFIRMED' | 'REDEEMED' | 'FAILED' | 'UNKNOWN';

export type RedemptionFailureReason =
  | 'BLOCKED_NO_VERIFIED_POSTER_MUTATION'
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
  | 'REWARD_ALREADY_REDEEMED_FOR_ORDER' // Phase 22.2 — this Poster order already used its one reward; the customer's other banked rewards are untouched
  | 'POSTER_REJECTED';

export interface RedeemRewardResult {
  attemptId: string;
  status: RedemptionAttemptStatus;
  failureReason: RedemptionFailureReason | null;
  productName: string | null;
}

// Phase 23 — the promotion redemption attempt lifecycle, mirrored exactly from the backend's pos-widget-promotion-redemption.types.ts. A SEPARATE
// concept from reward redemption throughout — its own status/reason unions, its own result type, never conflated with RedemptionAttemptStatus above.
export type PromotionRedemptionAttemptStatus = 'REQUESTED' | 'POSTER_MUTATING' | 'REDEEMED' | 'FAILED' | 'UNKNOWN';

export type PromotionRedemptionFailureReason =
  | 'BLOCKED_NO_VERIFIED_POSTER_MUTATION'
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
  | 'PROMOTION_ALREADY_REDEEMED_FOR_ORDER'
  | 'POSTER_REJECTED';

export interface RedeemPromotionResult {
  attemptId: string;
  status: PromotionRedemptionAttemptStatus;
  failureReason: PromotionRedemptionFailureReason | null;
  promotionName: string | null;
}

export interface Overview {
  state: OverviewState;
  ref: string | null;
  generatedAt: string;
  customer: { displayName: string | null; phoneMasked: string | null; code: string | null } | null;
  linkedToPoster: boolean;
  loyalty: {
    legacyProgramEnabled: boolean;
    points: number | null;
    program2:
      | { enabled: false }
      | {
          enabled: true;
          level: { name: string; icon: string; color: string } | null;
          nextLevel: { name: string; spendToNext: number } | null;
          xp: { total: number; toNextLevel: number | null };
          streak: { enabled: boolean; current: number };
          cashbackMinor: number | null;
        };
  } | null;
  rewards: { availableTotal: number; redemption: { enabled: boolean }; programs: RewardProgramView[] } | null;
  promotions: { redemption: { enabled: boolean }; items: PromotionView[] };
  activity: { visits: number; lastVisitAt: string | null } | null;
}

// Why the CUP request produced no overview. Every kind is shown to the barista in plain words and NONE of them blocks Poster.
export type ErrorKind = 'TIMEOUT' | 'UNAVAILABLE' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'DISABLED' | 'BAD_REQUEST' | 'INVALID' | 'NOT_CONFIGURED';

export type Identifier = { posterClientId: string } | { code: string } | { phone: string };

export interface PosterClientInfo {
  id: number;
  name: string;
  phone: string | null;
}
