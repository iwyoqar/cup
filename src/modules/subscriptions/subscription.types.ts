// Coffee Subscription — shared types. Statuses are plain strings validated against these unions (the schema's portability rule:
// no Prisma enum), same convention as src/common/enums/.

export type SubscriptionStatus = 'PENDING_PAYMENT' | 'ACTIVE' | 'PAUSED' | 'EXPIRED' | 'CANCELLED';
export const SUBSCRIPTION_STATUSES: SubscriptionStatus[] = ['PENDING_PAYMENT', 'ACTIVE', 'PAUSED', 'EXPIRED', 'CANCELLED'];

// What a subscription IS right now, derived from status + dates + the clock (never stored). SCHEDULED = paid and ACTIVE, but its
// period has not started yet (a renewal queued behind the current subscription). An ACTIVE row whose endsAt has passed reads as
// EXPIRED here even before the expiry job has flipped its stored status.
export type SubscriptionEffectiveStatus = SubscriptionStatus | 'SCHEDULED';

export type PurchaseStatus = 'CREATED' | 'PAYMENT_PENDING' | 'PAID' | 'FAILED' | 'CANCELLED';
export type PurchaseKind = 'NEW' | 'RENEWAL';
export type ActivationSource = 'PAYMENT' | 'ADMIN_MANUAL';

export type RedemptionStatus = 'REQUESTED' | 'POSTER_MUTATING' | 'CONFIRMED' | 'FAILED' | 'UNKNOWN';
// Held = blocks the balance, the daily limit and the cooldown (in flight or ambiguous). CONFIRMED = consumed. FAILED = released.
export const HELD_REDEMPTION_STATUSES: RedemptionStatus[] = ['REQUESTED', 'POSTER_MUTATING', 'UNKNOWN'];
export const COUNTED_REDEMPTION_STATUSES: RedemptionStatus[] = ['REQUESTED', 'POSTER_MUTATING', 'UNKNOWN', 'CONFIRMED'];

export type ReconciliationStatus = 'MATCHED' | 'LINE_MISSING';

// Machine-readable domain reasons (the widget / Mini App / Admin each map them to their own copy). The spec's error names map as:
// NoActiveSubscription, SubscriptionExpired/Paused/Cancelled, NoRemainingPortions, DailyLimitReached, CooldownActive, ProductNotAllowed,
// SubscriptionNotStarted, PosterTransactionUnavailable, PosterMutationFailed, RedemptionAlreadyProcessed, RedemptionConflict.
export type SubscriptionIneligibleReason =
  | 'NO_ACTIVE_SUBSCRIPTION'
  | 'SUBSCRIPTION_PENDING_PAYMENT'
  | 'SUBSCRIPTION_NOT_STARTED'
  | 'SUBSCRIPTION_EXPIRED'
  | 'SUBSCRIPTION_PAUSED'
  | 'SUBSCRIPTION_CANCELLED'
  | 'NO_REMAINING_PORTIONS'
  | 'DAILY_LIMIT_REACHED'
  | 'COOLDOWN_ACTIVE'
  | 'CUSTOMER_INACTIVE'
  | 'PRODUCT_NOT_ALLOWED'
  | 'PRODUCT_INACTIVE';

export type SubscriptionRedemptionFailureReason =
  | SubscriptionIneligibleReason
  | 'CUSTOMER_NOT_FOUND'
  | 'CUSTOMER_MISMATCH'
  | 'PRODUCT_NOT_FOUND'
  | 'REDEMPTION_CONFLICT' // another redemption for this customer / order is still in flight
  | 'ALREADY_REDEEMED_FOR_ORDER'
  | 'POSTER_TRANSACTION_UNAVAILABLE' // the open order could not be confirmed BEFORE any mutation — nothing was changed in Poster
  | 'POSTER_MUTATION_FAILED' // Poster explicitly rejected the mutation — nothing was added
  | 'RESOLVED_BY_ADMIN';

export interface PlanTerms {
  planName: string;
  priceMinor: number;
  durationDays: number;
  totalPortions: number;
  dailyPortionLimit: number;
  cooldownMinutes: number;
}

// Every figure a customer / barista / admin sees about one subscription's usage. All derived.
export interface SubscriptionUsage {
  totalPortions: number;
  consumedPortions: number; // CONFIRMED
  heldPortions: number; // in flight or UNKNOWN — not yet consumed, but not available either
  remainingPortions: number; // total - consumed - held, never below 0
  dailyPortionLimit: number;
  todayUsedPortions: number; // consumed + held today (business day)
  todayRemainingPortions: number;
  lastRedemptionAt: string | null;
  nextAvailableAt: string | null; // null = available now (cooldown-wise)
  cooldownMinutes: number;
}

export interface SubscriptionView {
  id: string;
  planId: string;
  planName: string;
  status: SubscriptionStatus;
  effectiveStatus: SubscriptionEffectiveStatus;
  priceMinor: number;
  durationDays: number;
  startBusinessDate: string | null;
  endBusinessDate: string | null; // last usable day, inclusive
  startsAt: string | null;
  endsAt: string | null;
  activatedAt: string | null;
  usage: SubscriptionUsage;
}
