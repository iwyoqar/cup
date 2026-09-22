// Mirrors the CUP backend's actual response shapes exactly (see docs/PHASE-1-DESIGN.md and
// the corresponding controllers/services under src/modules/*). Never invents fields the
// backend doesn't send; price/total fields are always display-only, never sent back as
// authoritative values.

export interface Customer {
  id: string;
  displayName: string | null;
  phone: string | null;
  telegramUserId: string;
}

export interface AuthenticatedSession {
  sessionToken: string;
  customer: Customer;
}

export interface Branch {
  id: string;
  name: string;
  address: string | null;
  isActive: boolean;
}

export interface Category {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
}

export interface Product {
  id: string;
  name: string;
  priceMinor: number;
  categoryId: string;
  isActive: boolean;
}

export interface CartItemView {
  id: string;
  product: { id: string; name: string; priceMinor: number };
  quantity: number;
  lineTotalMinor: number;
}

// Phase 8 — mirrors CartRewardView (src/modules/cart/cart.service.ts) exactly. Shown as its
// own line, never merged into an existing CartItemView — see that file's comment.
export interface CartRewardView {
  programId: string;
  programName: string;
  productId: string;
  productName: string;
  discountMinor: number;
}

export interface CartView {
  id: string;
  branch: { id: string; name: string; address: string | null } | null;
  items: CartItemView[];
  reward: CartRewardView | null;
  totalMinor: number;
}

// Mirrors src/common/enums/order-status.ts exactly. Only 'pending' and 'accepted' are backed
// by a verified Poster status mapping (poster-status-map.ts) — the rest are CUP-internal/
// provisional values the backend enum declares but no current code path sets yet. See
// lib/orderStatusLabels.ts for why every value still gets a neutral (never invented) label.
export const ORDER_STATUSES = [
  'pending',
  'sent_to_poster',
  'uncertain',
  'accepted',
  'preparing',
  'ready',
  'completed',
  'cancelled',
  'failed',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

// Shape returned inside POST /cart/checkout's response (CartService.serializeOrderForCheckout)
// — distinct from the raw Order returned by GET /orders/:id (see below).
export interface CheckoutOrderView {
  id: string;
  status: OrderStatus;
  branch: { id: string; name: string; address: string | null } | null;
  items: { product: { id: string; name: string; priceMinor: number }; quantity: number; lineTotalMinor: number }[];
  totalMinor: number;
}

export interface CheckoutResponse {
  order: CheckoutOrderView;
}

// Shape returned by GET /orders/:id (Phase 2's orders.controller.ts toOrderDetailView) — a
// customer-safe, flattened view. Never posterIncomingOrderId/posterSpotId/idempotencyKey/
// customerId. unitPriceMinor/totalPriceMinor are the ORDER's own stored historical values,
// never recomputed from the current catalog price.
export interface Order {
  id: string;
  status: OrderStatus;
  totalMinor: number;
  branch: { id: string; name: string; address: string | null } | null;
  items: {
    productName: string;
    quantity: number;
    unitPriceMinor: number;
    totalPriceMinor: number;
  }[];
  createdAt: string;
}

// Phase 2: GET /customers/me — deliberately minimal, no internal id/posterClientId/Telegram
// numeric id.
export interface CustomerProfile {
  displayName: string | null;
  phone: string | null;
  username: string | null;
}

// Phase 2: GET /orders (order history) — a lighter view than Order above; no items, see
// orders.repository.ts's findManyByCustomer for why (avoids an N+1-shaped cost on every list
// row for a screen that only needs to show a summary card).
export interface OrderSummary {
  id: string;
  status: OrderStatus;
  totalMinor: number;
  branch: { id: string; name: string } | null;
  createdAt: string;
}

export interface OrderListPage {
  items: OrderSummary[];
  nextCursor: string | null;
}

// Phase 3.1: GET /loyalty — mirrors LoyaltyAccountView exactly
// (src/modules/loyalty/loyalty.service.ts). When `enabled` is false, balance/lifetime fields
// are always 0 — loyalty isn't just "off", there may be no account at all yet. earnRate/
// earnUnitAmount are the smallest necessary config exposure so the Mini App can build its
// explanatory copy from THIS response rather than hardcoding the business rule — see
// lib/loyaltyCopy.ts.
export interface LoyaltyAccount {
  enabled: boolean;
  balance: number;
  lifetimeEarned: number;
  lifetimeSpent: number;
  earnRate: number;
  earnUnitAmount: number;
}

// Mirrors LOYALTY_TRANSACTION_TYPES (src/common/enums/loyalty-transaction-type.ts). Only
// WELCOME_BONUS is reachable by any current backend code path — EARN/SPEND/ADJUSTMENT/
// EXPIRATION are declared for the ledger's own extensibility, same provisional-value pattern
// as OrderStatus.
export type LoyaltyTransactionType = 'EARN' | 'SPEND' | 'WELCOME_BONUS' | 'ADJUSTMENT' | 'EXPIRATION';

// GET /loyalty/transactions — mirrors LoyaltyTransactionView exactly.
export interface LoyaltyTransaction {
  id: string;
  type: LoyaltyTransactionType;
  points: number;
  balanceAfter: number;
  description: string | null;
  createdAt: string;
}

export interface LoyaltyTransactionPage {
  items: LoyaltyTransaction[];
  nextCursor: string | null;
}

// Phase 7 — mirrors GET /promotions's response shape exactly
// (src/modules/promotions/promotion.types.ts's CustomerPromotionView). Deliberately minimal:
// no internal ids beyond the promotion's own, no admin-only configuration fields.
export type PromotionBenefitType = 'PERCENT_DISCOUNT' | 'FIXED_DISCOUNT' | 'FREE_PRODUCT' | 'LOYALTY_POINTS';

export interface PromotionBenefit {
  type: PromotionBenefitType;
  value: number | null;
  product: { id: string; name: string } | null;
  quantity: number | null;
}

export interface CustomerPromotion {
  id: string;
  name: string;
  description: string | null;
  benefit: PromotionBenefit;
  startsAt: string;
  endsAt: string | null;
  remainingUses: number | null;
}

// Phase 8 — mirrors GET /loyalty/rewards's response shape exactly
// (src/modules/rewards/reward-program.types.ts's CustomerRewardProgramView).
export interface CustomerRewardProgram {
  programId: string;
  program: { name: string };
  threshold: number;
  qualifyingCount: number;
  availableRewards: number;
  isActive: boolean;
  // Phase 8.1: false while the server-side production gate is off — never offer to redeem then.
  redeemable: boolean;
  qualifyingCategoryId: string;
}

// Phase 11 — GET /customers/me/identity. `publicCode` is the random public identity code (e.g.
// CUP-7K4M9X2P); `qrPayload` is exactly what the QR encodes (currently the same string). Nothing else —
// no customer id, phone, Poster id or token — is ever part of it.
export interface CustomerIdentity {
  publicCode: string;
  qrPayload: string;
}

// Phase 12 — Loyalty 2.0 (GET /loyalty/overview). Every figure is calculated by the server; the Mini App only displays it.
export interface LoyaltyLevelInfo {
  code: string;
  name: string;
  color: string;
  icon: string;
  minLifetimeSpend: number;
  cashbackRateBps: number;
  pointMultiplierPercent: number;
  prioritySupport: boolean;
}

export interface LoyaltyOverviewEnabled {
  enabled: true;
  level: LoyaltyLevelInfo | null;
  nextLevel: (LoyaltyLevelInfo & { spendToNext: number }) | null;
  lifetimeSpend: number;
  purchaseCount: number;
  xp: { lifetimeXP: number; levelStartXP: number; levelXP: number; nextLevelXP: number | null; xpToNextLevel: number | null };
  points: { balance: number; lifetimeEarned: number; lifetimeSpent: number };
  cashback: { enabled: boolean; balance: number; lifetimeEarned: number; lifetimeSpent: number; currentRateBps: number };
  streak: { enabled: boolean; current: number; best: number; lastVisitDate: string | null };
  achievements: { code: string; name: string; description: string; icon: string; rewardPoints: number; unlocked: boolean; unlockedAt: string | null; progress: { current: number; target: number } }[];
  birthday: { enabled: boolean; birthdaySet: boolean; eligible: boolean; rewardPoints: number; windowEndsOn: string | null };
}
export type LoyaltyOverview = LoyaltyOverviewEnabled | { enabled: false };

export interface LoyaltyHistoryItem {
  type: 'POINT_EARN' | 'POINT_SPEND' | 'CASHBACK_EARN' | 'LEVEL_UP' | 'ACHIEVEMENT' | 'REWARD_REDEEM';
  at: string;
  title: string;
  detail: string | null;
  points: number | null;
  cashbackMinor: number | null;
}

export interface LoyaltyHistoryPage {
  items: LoyaltyHistoryItem[];
  nextCursor: string | null;
}

// Phase 14 — Referrals (GET /referrals). Every figure is decided by the server; the Mini App only displays it. The server never returns the invited
// friends' names, ids or contact data.
export type ReferralOverview =
  | { enabled: false }
  | { enabled: true; eligible: false }
  | {
      enabled: true;
      eligible: true;
      referralCode: string;
      referralLink: string | null;
      successfulReferrals: number;
      pendingReferrals: number;
      totalRewardsEarned: number;
      reward: { referrerPoints: number; friendPoints: number };
      limitReached: boolean;
      myReferral: { status: string; welcomePoints: number | null } | null;
    };
