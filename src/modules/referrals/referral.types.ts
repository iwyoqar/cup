// Phase 14 — the referral domain vocabulary. Every status / reason is a plain validated string (SQLite convention, no Prisma enums).

// ATTRIBUTED  — a valid /start ref_<code> was recorded; the friend has not shared a phone yet.
// REGISTERED  — the friend is a registered customer (phone on file); waiting for a first qualifying purchase.
// QUALIFIED   — the friend made the qualifying purchase; rewards are being / have been decided.
// REWARDED    — at least one reward was actually GRANTED (the ReferralReward rows are the proof).
// EXPIRED     — no qualifying purchase inside the attribution window (terminal, kept for audit).
// REJECTED    — closed by a business rule (closeReason): PRIOR_PURCHASE, FIRST_PURCHASE_BELOW_MINIMUM.
// INVALID     — an integrity rule was violated (closeReason: SELF_REFERRAL).
export const REFERRAL_STATUSES = ['ATTRIBUTED', 'REGISTERED', 'QUALIFIED', 'REWARDED', 'EXPIRED', 'REJECTED', 'INVALID'] as const;
export type ReferralStatus = (typeof REFERRAL_STATUSES)[number];

export const PENDING_STATUSES: readonly ReferralStatus[] = ['ATTRIBUTED', 'REGISTERED'];
export const SUCCESS_STATUSES: readonly ReferralStatus[] = ['QUALIFIED', 'REWARDED'];

export const REWARD_BENEFICIARIES = ['REFERRER', 'REFERRED'] as const;
export type RewardBeneficiary = (typeof REWARD_BENEFICIARIES)[number];

// CASHBACK is a reserved configuration value: it is not integrated yet, so the server refuses to save it (see ReferralSettingsService).
export const REWARD_TYPES = ['POINTS', 'CASHBACK'] as const;
export type RewardType = (typeof REWARD_TYPES)[number];
export const SUPPORTED_REWARD_TYPES: readonly RewardType[] = ['POINTS'];

export const REWARD_STATUSES = ['GRANTED', 'SKIPPED'] as const;
export type RewardStatus = (typeof REWARD_STATUSES)[number];

export const SKIP_REASONS = ['ZERO_REWARD', 'MAX_REFERRALS_REACHED', 'REWARD_TYPE_UNSUPPORTED'] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

export const CLOSE_REASONS = ['ATTRIBUTION_EXPIRED', 'PRIOR_PURCHASE', 'FIRST_PURCHASE_BELOW_MINIMUM', 'SELF_REFERRAL'] as const;
export type CloseReason = (typeof CLOSE_REASONS)[number];

// What happened to a /start payload. Only ATTRIBUTED writes anything; every other outcome is a silent no-op for the friend.
export type AttributionOutcome = 'NONE' | 'ATTRIBUTED' | 'DISABLED' | 'INVALID_CODE' | 'SELF_REFERRAL' | 'ALREADY_ATTRIBUTED' | 'ALREADY_PURCHASED' | 'CIRCULAR';

// Referral events for Phase 13 CRM Automation to consume LATER (same "derived stream + per-consumer cursor" model as automation events: the
// referral timestamps ARE the log; nothing is queued and nothing is sent from here).
export const REFERRAL_EVENT_TYPES = ['REFERRAL_ATTRIBUTED', 'REFERRAL_REGISTERED', 'REFERRAL_QUALIFIED', 'REFERRAL_REWARDED'] as const;
export type ReferralEventType = (typeof REFERRAL_EVENT_TYPES)[number];

export interface ReferralEvent {
  type: ReferralEventType;
  referralId: string;
  referrerCustomerId: string;
  referredCustomerId: string;
  // Deterministic identity of THIS occurrence: `referral:{referralId}:{TYPE}` — one per referral per event type, ever.
  eventKey: string;
  at: Date;
}
