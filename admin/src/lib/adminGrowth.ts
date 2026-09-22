import { apiRequest } from './api';

// Phase 15 — Growth Intelligence admin API. Everything is calculated by the server (deterministic rules over the canonical purchases and the configured
// thresholds); the Admin only displays it. No customer ids, Telegram ids or phone numbers are ever returned — customers appear by display name.
export const LIFECYCLE_STATES = ['NEW', 'ACTIVE', 'LOYAL', 'AT_RISK', 'DORMANT', 'CHURNED'] as const;
export type LifecycleState = (typeof LIFECYCLE_STATES)[number];
export type Severity = 'INFO' | 'OPPORTUNITY' | 'ATTENTION';
export type Priority = 'HIGH' | 'MEDIUM' | 'LOW';

export const SIGNAL_TYPES = ['FIRST_PURCHASE', 'SECOND_PURCHASE', 'HIGH_VALUE_CUSTOMER', 'RISING_CUSTOMER', 'AT_RISK', 'DORMANT', 'CHURNED', 'REWARD_AVAILABLE', 'REFERRAL_SUCCESS', 'LOYALTY_LEVEL_UP', 'BIRTHDAY_UPCOMING'] as const;
export type SignalType = (typeof SIGNAL_TYPES)[number];
export const OPPORTUNITY_TYPES = ['WIN_BACK', 'SECOND_PURCHASE', 'REWARD_REDEMPTION', 'VIP_RETENTION', 'REFERRAL', 'BIRTHDAY', 'LOYALTY_UPGRADE'] as const;
export type OpportunityType = (typeof OPPORTUNITY_TYPES)[number];

export interface GrowthSettings {
  lookbackDays: number;
  recencyDaysBoundaries: number[];
  frequencyBoundaries: number[];
  monetaryBoundaries: number[];
  newDays: number;
  activeDays: number;
  dormantDays: number;
  churnDays: number;
  loyalMinPurchases: number;
  loyalMinRevenue: number;
  highValueRevenue: number;
  risingDays: number;
  secondPurchaseDueDays: number;
  signalWindowDays: number;
  birthdayLookaheadDays: number;
  upgradeProximityPercent: number;
}

export interface Recommendation {
  segment: string;
  automationTrigger: string | null;
}

export interface CustomerRow {
  customer: { displayName: string | null };
  lifecycleState: LifecycleState | null;
  rfmScore: string | null;
  daysSinceLastPurchase: number | null;
  lastPurchaseAt: string | null;
  lifetimePurchases: number;
  lifetimeRevenue: number;
}

export interface GrowthOverview {
  asOf: string;
  range: { mode: 'days' | 'custom'; days: number; startDate: string; endDate: string };
  branch: { id: string; name: string } | null;
  thresholds: GrowthSettings;
  kpis: {
    totalCustomers: number | null;
    customersWithPurchases: number;
    neverPurchased: number | null;
    activeCustomers: number;
    newCustomers: number;
    loyalCustomers: number;
    atRiskCustomers: number;
    dormantCustomers: number;
    churnedCustomers: number;
    highValueCustomers: number;
    customersWithRewards: number;
    successfulReferrals: number;
  };
  lifecycle: { total: number; counts: Record<LifecycleState, number> };
  rfm: { histograms: { recency: number[]; frequency: number[]; monetary: number[] }; matrix: number[][]; topScores: { score: string; customers: number }[] };
  signals: { counts: Record<SignalType, number>; latest: { type: SignalType; severity: Severity; detectedAt: string | null; reason: string; customer: { displayName: string | null } }[] };
  opportunities: {
    counts: Record<OpportunityType, { total: number; HIGH: number; MEDIUM: number; LOW: number }>;
    recommendations: Record<OpportunityType, Recommendation>;
    top: { type: OpportunityType; priority: Priority; reason: string; recommended: Recommendation; customer: { displayName: string | null } }[];
  };
  lists: { highValue: CustomerRow[]; atRisk: CustomerRow[]; newCustomers: CustomerRow[]; rising: CustomerRow[] };
}

export interface GrowthFilters {
  period: '' | '7' | '30' | '90' | '365' | 'custom';
  branchId: string;
  from: string;
  to: string;
}

// The compact block shown in Customer 360 (GET /admin/customers/:id -> growth).
export interface CustomerGrowthBlock {
  lifecycleState: LifecycleState | null;
  rfm: { score: string; recency: number | null; frequency: number | null; monetary: number | null; total: number | null } | null;
  recencyDays: number | null;
  frequency: number;
  monetary: number;
  lookbackDays: number;
  lifetimePurchases: number;
  lifetimeRevenue: number;
  firstPurchaseAt: string | null;
  lastPurchaseAt: string | null;
  signals: { type: SignalType; severity: Severity; detectedAt: string | null; reason: string }[];
  opportunities: { type: OpportunityType; priority: Priority; reason: string; recommended: Recommendation }[];
}

export const LIFECYCLE_LABELS: Record<LifecycleState, string> = { NEW: 'New', ACTIVE: 'Active', LOYAL: 'Loyal', AT_RISK: 'At risk', DORMANT: 'Dormant', CHURNED: 'Churned' };
export const SIGNAL_LABELS: Record<SignalType, string> = {
  FIRST_PURCHASE: 'First purchase',
  SECOND_PURCHASE: 'Second purchase',
  HIGH_VALUE_CUSTOMER: 'High-value customer',
  RISING_CUSTOMER: 'Rising customer',
  AT_RISK: 'At risk',
  DORMANT: 'Dormant',
  CHURNED: 'Churned',
  REWARD_AVAILABLE: 'Reward available',
  REFERRAL_SUCCESS: 'Referral success',
  LOYALTY_LEVEL_UP: 'Loyalty level-up',
  BIRTHDAY_UPCOMING: 'Birthday upcoming',
};
export const OPPORTUNITY_LABELS: Record<OpportunityType, string> = {
  WIN_BACK: 'Win back',
  SECOND_PURCHASE: 'Second purchase',
  REWARD_REDEMPTION: 'Reward redemption',
  VIP_RETENTION: 'VIP retention',
  REFERRAL: 'Referral',
  BIRTHDAY: 'Birthday',
  LOYALTY_UPGRADE: 'Loyalty upgrade',
};

export function fetchGrowthOverview(filters: GrowthFilters): Promise<GrowthOverview> {
  const q = new URLSearchParams();
  if (filters.period) q.set('period', filters.period);
  if (filters.period === 'custom') {
    q.set('from', filters.from);
    q.set('to', filters.to);
  }
  if (filters.branchId) q.set('branchId', filters.branchId);
  return apiRequest<GrowthOverview>(`/admin/growth/overview${q.toString() ? `?${q.toString()}` : ''}`);
}

export function fetchGrowthBranches(): Promise<{ id: string; name: string }[]> {
  return apiRequest<{ id: string; name: string }[]>('/admin/growth/branches');
}

export function fetchGrowthSettings(): Promise<GrowthSettings> {
  return apiRequest<GrowthSettings>('/admin/growth/settings');
}

export function updateGrowthSettings(patch: Partial<GrowthSettings>): Promise<GrowthSettings> {
  return apiRequest<GrowthSettings>('/admin/growth/settings', { method: 'PATCH', body: patch });
}
