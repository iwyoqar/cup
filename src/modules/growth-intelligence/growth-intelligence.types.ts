// Phase 15 — Growth Intelligence vocabulary. Everything here is DETERMINISTIC and observable: nothing is predicted, scored by a model or inferred
// about a customer's state of mind. A customer's lifecycle, RFM scores, signals and opportunities are pure functions of their qualifying purchases
// (CUP orders + imported POS rows — the one canonical definition), the configured thresholds (`growth.*` settings) and the current time.

// Lifecycle precedence (first match wins; see growth-intelligence.rules.ts classifyLifecycle):
//   CHURNED  recencyDays >  churnDays
//   DORMANT  recencyDays >  dormantDays
//   AT_RISK  recencyDays >  activeDays
//   NEW      first purchase within newDays        (recencyDays <= activeDays)
//   LOYAL    lifetime purchases >= loyalMinPurchases AND lifetime revenue >= loyalMinRevenue
//   ACTIVE   everything else with recencyDays <= activeDays
// A customer with no qualifying purchase has NO lifecycle state (null) — it is reported separately as "no purchase yet".
export const LIFECYCLE_STATES = ['NEW', 'ACTIVE', 'LOYAL', 'AT_RISK', 'DORMANT', 'CHURNED'] as const;
export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

export const SIGNAL_TYPES = [
  'FIRST_PURCHASE',
  'SECOND_PURCHASE',
  'HIGH_VALUE_CUSTOMER',
  'RISING_CUSTOMER',
  'AT_RISK',
  'DORMANT',
  'CHURNED',
  'REWARD_AVAILABLE',
  'REFERRAL_SUCCESS',
  'LOYALTY_LEVEL_UP',
  'BIRTHDAY_UPCOMING',
] as const;
export type SignalType = (typeof SIGNAL_TYPES)[number];

export const SEVERITIES = ['INFO', 'OPPORTUNITY', 'ATTENTION'] as const;
export type Severity = (typeof SEVERITIES)[number];

// Severity is a fixed property of the signal TYPE (not a judgement about a customer).
export const SIGNAL_SEVERITY: Record<SignalType, Severity> = {
  FIRST_PURCHASE: 'INFO',
  SECOND_PURCHASE: 'INFO',
  LOYALTY_LEVEL_UP: 'INFO',
  REFERRAL_SUCCESS: 'INFO',
  HIGH_VALUE_CUSTOMER: 'OPPORTUNITY',
  RISING_CUSTOMER: 'OPPORTUNITY',
  REWARD_AVAILABLE: 'OPPORTUNITY',
  BIRTHDAY_UPCOMING: 'OPPORTUNITY',
  AT_RISK: 'ATTENTION',
  DORMANT: 'ATTENTION',
  CHURNED: 'ATTENTION',
};

export const OPPORTUNITY_TYPES = ['WIN_BACK', 'SECOND_PURCHASE', 'REWARD_REDEMPTION', 'VIP_RETENTION', 'REFERRAL', 'BIRTHDAY', 'LOYALTY_UPGRADE'] as const;
export type OpportunityType = (typeof OPPORTUNITY_TYPES)[number];

export const PRIORITIES = ['HIGH', 'MEDIUM', 'LOW'] as const;
export type Priority = (typeof PRIORITIES)[number];

// Read-only candidate feeds for a FUTURE Phase 13 trigger. Nothing consumes them yet and nothing is sent from Growth Intelligence.
export const CANDIDATE_TYPES = ['CUSTOMER_AT_RISK', 'CUSTOMER_DORMANT', 'CUSTOMER_HIGH_VALUE', 'CUSTOMER_SECOND_PURCHASE_DUE', 'CUSTOMER_BIRTHDAY_UPCOMING'] as const;
export type CandidateType = (typeof CANDIDATE_TYPES)[number];

// The fields a Segment condition may use (see segment-condition-allowlist.ts). All numeric except lifecycleState / rfmScore / growthSignal.
export const GROWTH_NUMERIC_FIELDS = [
  'recencyDays',
  'daysSinceLastPurchase',
  'daysSinceFirstPurchase',
  'frequency',
  'monetary',
  'recencyScore',
  'frequencyScore',
  'monetaryScore',
  'rfmTotal',
  'lifetimeRevenue',
  'lifetimePurchases',
] as const;
export const GROWTH_STRING_FIELDS = ['lifecycleState', 'rfmScore', 'growthSignal'] as const;
export const GROWTH_FIELDS = [...GROWTH_NUMERIC_FIELDS, ...GROWTH_STRING_FIELDS] as const;
export type GrowthField = (typeof GROWTH_FIELDS)[number];
export const isGrowthField = (value: string): value is GrowthField => (GROWTH_FIELDS as readonly string[]).includes(value);

// Configuration (Admin › Growth Intelligence, `growth.*` settings). Every threshold is configurable; the defaults are STARTING values.
export interface GrowthSettings {
  lookbackDays: number; // default RFM lookback for frequency / monetary (Admin period filter overrides it per view)
  recencyDaysBoundaries: number[]; // 4 ascending values: max days since last purchase for recency scores 5, 4, 3, 2 (anything longer scores 1)
  frequencyBoundaries: number[]; // 4 ascending values: minimum purchases in the lookback for frequency scores 2, 3, 4, 5 (fewer scores 1)
  monetaryBoundaries: number[]; // 4 ascending values (so'm): minimum lookback revenue for monetary scores 2, 3, 4, 5
  newDays: number;
  activeDays: number;
  dormantDays: number;
  churnDays: number;
  loyalMinPurchases: number;
  loyalMinRevenue: number; // 0 = no revenue condition
  highValueRevenue: number; // lifetime revenue (so'm) that makes a customer "high value"
  risingDays: number; // a customer is "rising" when they crossed the high-value threshold within this many days
  secondPurchaseDueDays: number;
  signalWindowDays: number; // how recent an event-type signal (second purchase, referral, level-up) must be to be listed
  birthdayLookaheadDays: number;
  upgradeProximityPercent: number; // a level upgrade is an opportunity when spend is within this percent of the next level's threshold
}

export interface GrowthMetrics {
  lifetimePurchases: number;
  lifetimeRevenue: number;
  firstPurchaseAt: Date | null;
  lastPurchaseAt: Date | null;
  secondPurchaseAt: Date | null;
  highValueAt: Date | null;
  daysSinceFirstPurchase: number | null;
  daysSinceLastPurchase: number | null; // == recencyDays
  frequency: number; // qualifying purchases inside the lookback
  monetary: number; // qualifying revenue inside the lookback
  recencyScore: number | null;
  frequencyScore: number | null;
  monetaryScore: number | null;
  rfmScore: string | null; // e.g. "543"
  rfmTotal: number | null; // R + F + M, 3..15
  lifecycleState: LifecycleState | null;
  highValue: boolean;
}

export interface GrowthSignal {
  type: SignalType;
  key: string; // deterministic identity of THIS occurrence
  severity: Severity;
  detectedAt: Date | null; // when the condition became true, if the canonical data records it; null when it is a state without a recorded moment
  reason: string;
}

export interface Recommendation {
  segment: string; // an existing Segment definition that captures this group
  automationTrigger: string | null; // an existing Phase 13 trigger type that could act on it (the owner must create and activate it)
}

export interface GrowthOpportunity {
  type: OpportunityType;
  priority: Priority;
  reason: string;
  recommended: Recommendation;
}
