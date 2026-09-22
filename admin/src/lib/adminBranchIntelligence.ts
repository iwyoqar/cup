import { apiRequest } from './api';
import { LifecycleState, OpportunityType, Priority, Recommendation, SignalType } from './adminGrowth';
import { AnalyticsPeriodKey } from './types';

// Phase 18 — Branch Intelligence admin API. Everything is computed by the server from the canonical purchases (CUP orders + imported POS purchases);
// the Admin only formats it. There is no ranking, score or prediction in the payload, and no customer id / phone / Telegram id / Poster id.
export interface BranchIntelligenceFilters {
  period: AnalyticsPeriodKey;
  startDate?: string;
  endDate?: string;
  branchId?: string;
}

export interface SourceSlice {
  orders: number;
  revenueMinor: number;
  customers: number;
  revenueSharePercent: number;
  ordersSharePercent: number;
  customersSharePercent?: number;
}

export interface BranchCard {
  branchId: string;
  branchName: string;
  isActive: boolean;
  revenueMinor: number;
  orders: number;
  customers: number;
  averageOrderMinor: number;
  newCustomers: number;
  returningCustomers: number;
  returningRatePercent: number;
  revenueSharePercent: number;
  orderSharePercent: number;
  activeDays: number;
  lastPurchaseAt: string | null;
  sources: { cup: SourceSlice; pos: SourceSlice };
  repeatCustomerRatePercent: number;
  topProduct: { name: string; quantity: number; revenueMinor: number } | null;
}

export interface ProductLine {
  name: string;
  category: string;
  quantity: number;
  revenueMinor: number;
}

export interface DayValue {
  date: string;
  value: number;
}

export interface BranchDetail {
  revenue: { revenueMinor: number; revenueSharePercent: number; byDay: DayValue[] };
  orders: { orders: number; averageOrderMinor: number; orderSharePercent: number; byDay: DayValue[] };
  customers: {
    unique: number;
    new: number;
    returning: number;
    byDay: DayValue[];
    analyticsV1: { customers: number; newCustomers: number; returningCustomers: number; revenueMinor: number; orders: number };
  };
  activity: { activeDays: number; periodDays: number; lastPurchaseAt: string | null };
  retention: { returningRatePercent: number; repeatPurchases: number; customersWith2PlusPurchases: number; customersWith3PlusPurchases: number; repeatCustomerRatePercent: number };
  crossBranch: { purchasedOnlyHere: number; purchasedAtTwoOrMoreBranches: number; latestPurchaseWasHere: number; purchaseDirectlyFollowedAnotherBranch: number };
  sources: { cup: SourceSlice; pos: SourceSlice };
  products: {
    topByQuantity: ProductLine[];
    topByRevenue: ProductLine[];
    bySource: { cup: { topByQuantity: ProductLine[] }; pos: { topByQuantity: ProductLine[] } };
    categories: { name: string; quantity: number; revenueMinor: number; revenueSharePercent: number }[];
  };
  loyalty: {
    customersWithLoyaltyAccount: number;
    loyalty2: { purchasesAccrued: number; members: number; pointsAwarded: number; cashbackEarnedMinor: number };
    pointsLedger: { attributed: { earned: number; spent: number; rows: number }; unattributed: { earned: number; spent: number; rows: number } };
  };
  rewards: {
    customersWithRewardAvailable: number;
    rewardsAvailable: number;
    redemptionsAtBranch: number;
    redemptionsByProgram: { name: string; count: number }[];
    unattributedRedemptions: number;
  };
  promotions: { redemptionsAtBranch: number; redemptionsByPromotion: { name: string; count: number }[]; unattributedRedemptions: number };
  referrals: { qualifiedAtBranch: number; rewardedAtBranch: number; qualifiedElsewhereOrUnattributed: number };
  growth: {
    asOf: string;
    lookbackDays: number;
    lifecycle: { total: number; counts: Record<LifecycleState, number> };
    rfm: { histograms: { recency: number[]; frequency: number[]; monetary: number[] }; matrix: number[][]; topScores: { score: string; customers: number }[] };
    signals: Record<SignalType, number>;
    opportunities: {
      counts: Record<OpportunityType, { total: number; HIGH: number; MEDIUM: number; LOW: number }>;
      top: { type: OpportunityType; priority: Priority; reason: string; recommended: Recommendation; customer: { displayName: string | null } }[];
    };
  };
  overview: {
    revenueMinor: number;
    orders: number;
    customers: number;
    averageOrderMinor: number;
    returningRatePercent: number;
    cupRevenueSharePercent: number;
    posRevenueSharePercent: number;
    topCategory: { name: string; revenueMinor: number } | null;
    topProduct: { name: string; quantity: number } | null;
    lifecycle: Record<LifecycleState, number>;
    opportunityCount: number;
  };
}

export interface BranchIntelligenceOverview {
  period: { key: AnalyticsPeriodKey; startDate: string; endDate: string; days: number; timezoneOffsetMinutes: number };
  filters: { branches: { id: string; name: string; isActive: boolean }[] };
  summary: {
    revenueMinor: number;
    orders: number;
    customers: number;
    averageOrderMinor: number;
    newCustomers: number;
    returningCustomers: number;
    mapped: { revenueMinor: number; orders: number; branchesWithActivity: number };
    unmapped: { revenueMinor: number; orders: number };
    sources: { cup: SourceSlice; pos: SourceSlice };
  };
  branches: BranchCard[];
  branch: { id: string; name: string; isActive: boolean } | null;
  detail: BranchDetail | null;
  definitions: Record<string, string>;
}

export function fetchBranchIntelligence(filters: BranchIntelligenceFilters): Promise<BranchIntelligenceOverview> {
  const params = new URLSearchParams({ period: filters.period });
  if (filters.period === 'custom') {
    if (filters.startDate) params.set('startDate', filters.startDate);
    if (filters.endDate) params.set('endDate', filters.endDate);
  }
  if (filters.branchId) params.set('branchId', filters.branchId);
  return apiRequest<BranchIntelligenceOverview>(`/admin/branch-intelligence/overview?${params.toString()}`);
}
