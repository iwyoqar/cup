import { AnalyticsPeriodKey, ReportsSource } from './types';

// Reports Phases D1-G — response shapes of GET /admin/reports/{customers,employees,taxes,loyalty,promotions,campaigns,
// referrals,abc-analysis}. Every figure is computed by the backend; `null` always means "unknown / not tracked" and must
// render as "—", never as 0.
export interface ReportPeriod {
  key: AnalyticsPeriodKey;
  startDate: string;
  endDate: string;
  timezoneOffsetMinutes: number;
}
export interface Paging {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
type IdName = { id: string; name: string };

export interface ReportsCustomersOverview {
  period: ReportPeriod;
  branch: IdName | null;
  filters: { branches: IdName[] };
  summary: {
    identifiedCustomers: number;
    identifiedPurchases: number;
    identifiedUnits: number;
    customerRevenueMinor: number;
    averageCustomerPurchaseMinor: number | null;
    newCustomers: number;
    returningCustomers: number;
    canonicalRevenueMinor: number;
    customerRevenueSharePercent: number | null;
  };
  anonymousPos: { purchases: number; units: number; revenueMinor: number; sharePercent: number | null };
  reconciliation: { canonicalRevenueMinor: number; customerRevenueMinor: number; anonymousPosRevenueMinor: number; unexplainedMinor: number; analyticsCustomers: number; reportCustomers: number };
  rows: {
    customerId: string;
    name: string | null;
    phone: string | null;
    isActive: boolean;
    purchases: number;
    units: number;
    revenueMinor: number;
    averageCheckMinor: number;
    firstPurchaseAt: string;
    lastPurchaseAt: string;
    source: { cupPurchases: number; cupRevenueMinor: number; posPurchases: number; posRevenueMinor: number };
    currentLifecycle: string | null;
    currentRfmScore: string | null;
  }[];
  pagination: Paging;
}

export interface ReportsEmployeesOverview {
  period: ReportPeriod;
  source: 'POSTER';
  branchFilterSupported: false;
  available: boolean;
  unavailableReason: 'poster_unavailable' | 'malformed_response' | null;
  employeeMetadataAvailable: boolean;
  summary: { employeesWithSales: number; totalRevenueMinor: number | null; totalReceipts: number | null; averageReceiptMinor: number | null } | null;
  employees: { employeeId: string; employeeName: string; roleName: string | null; inEmployeeList: boolean | null; revenueMinor: number; receipts: number | null; averageReceiptMinor: number | null }[];
  notes: string[];
}

export interface ReportsTaxesOverview {
  period: ReportPeriod;
  branch: IdName | null;
  filters: { branches: IdName[] };
  poster: {
    source: 'POSTER';
    available: boolean;
    unavailableReason: 'poster_unavailable' | 'malformed_response' | null;
    reportsAmounts: false;
    taxes: { taxId: string; name: string; ratePercent: number | null; typeLabel: string | null; fiscal: boolean | null; rawDeleteFlag: string | null }[];
  };
  cup: {
    source: 'CUP_FINANCE';
    calculatedLiabilityMinor: number;
    appliedRules: number;
    activeRules: number;
    rules: {
      ruleId: string;
      name: string;
      ratePct: number;
      calculationBase: string;
      effectiveFrom: string;
      effectiveTo: string | null;
      isActive: boolean;
      applied: boolean;
      baseAmountMinor: number | null;
      liabilityMinor: number | null;
      notAppliedReason: 'INACTIVE' | 'NOT_IN_EFFECT' | 'PARTIAL_PERIOD_NOT_PRORATED' | null;
    }[];
    scopeNote: string;
  };
  actualTaxPaid: { tracked: false };
  notes: string[];
}

export interface ReportsLoyaltyOverview {
  period: ReportPeriod;
  loyalty2Enabled: boolean;
  current: { loyaltyCustomers: number; pointsBalance: number; rewardsAvailable: number; customersWithAvailableReward: number; cashbackBalanceMinor: number };
  levels: { code: string; name: string; color: string; minLifetimeSpend: number; customers: number; sharePercent: number | null }[];
  customersBelowFirstLevel: number;
  points: { earned: number; spent: number; netChange: number; customers: number; byType: { type: string; earned: number; spent: number; entries: number }[]; spendFlowExists: false };
  rewards: { redeemed: number; customers: number; programs: { rewardProgramId: string; name: string; type: string; redemptions: number; customers: number }[] };
  cashback: { grantedMinor: number; usedMinor: null; customers: number; usedTracked: false };
  achievements: { unlocked: number; customers: number; byAchievement: { achievementId: string; code: string; name: string; unlocks: number }[] };
  birthdayRewards: { claimed: number; customers: number; points: number };
  customerRows: { customerId: string; name: string | null; phone: string | null; level: string | null; pointsBalance: number; rewardsAvailable: number; cashbackBalanceMinor: number; achievements: number }[];
  pagination: Paging;
  notes: string[];
}

export interface ReportsPromotionRow {
  promotionId: string;
  promotionName: string;
  benefitType: string;
  benefitValue: number | null;
  benefitProductName: string | null;
  benefitQuantity: number | null;
  status: 'ACTIVE' | 'INACTIVE' | 'SCHEDULED' | 'EXPIRED';
  startsAt: string;
  endsAt: string | null;
  redemptions: number;
  uniqueCustomers: number;
  linkedOrders: number;
  firstRedemptionAt: string | null;
  lastRedemptionAt: string | null;
}
export interface ReportsPromotionsOverview {
  period: ReportPeriod;
  branch: IdName | null;
  filters: { branches: IdName[]; promotions: IdName[] };
  summary: { activePromotions: number; promotionsUsed: number; totalRedemptions: number; uniqueCustomers: number; ordersWithPromotion: number; activeWithZeroRedemptions: number; redemptionsWithoutOrder: number };
  promotions: ReportsPromotionRow[];
  recentRedemptions: { redemptionId: string; redeemedAt: string; promotionId: string; promotionName: string; customerId: string; customerName: string | null; orderId: string | null; branchName: string | null; benefitType: string; benefitValue: number | null; benefitProductName: string | null }[];
  discountValueTracked: false;
  notes: string[];
}

export interface ReportsCampaignRow {
  campaignId: string;
  name: string;
  channel: string;
  status: string;
  createdAt: string;
  recipientsAdded: number;
  successfulSends: number;
  failedSends: number;
  sendSuccessRatePercent: number | null;
  totalRecipients: number;
  pendingOrUncertain: number;
  skipped: number;
  lastActivityAt: string | null;
  convertedCustomers: null;
  attributedRevenueMinor: null;
}
export interface ReportsCampaignsOverview {
  period: ReportPeriod;
  filters: { campaigns: IdName[] };
  summary: { totalCampaigns: number; activeCampaigns: number; campaignsWithActivity: number; recipientsAdded: number; successfulSends: number; failedSends: number; sendSuccessRatePercent: number | null; uniqueCustomersReached: number };
  campaigns: ReportsCampaignRow[];
  recentActivity: { recipientId: string; at: string; campaignId: string; campaignName: string; customerId: string; customerName: string | null; status: 'sent' | 'failed'; errorCode: string | null }[];
  conversionAttributable: false;
  branchFilterSupported: false;
  notes: string[];
}

export interface ReportsReferralsOverview {
  period: ReportPeriod;
  summary: { referralCodes: number; referralsCreated: number; qualifiedReferrals: number; rewardsGranted: number; rewardPointsGranted: number; rewardsSkipped: number; referrers: number; referredCustomers: number; qualifyingAmountMinor: number };
  funnel: { stage: 'CREATED' | 'REGISTERED' | 'QUALIFIED' | 'REWARDED' | 'CLOSED'; count: number }[];
  closedByReason: { reason: string; count: number }[];
  currentStatus: { status: string; count: number }[];
  referrers: { customerId: string; name: string | null; code: string | null; referralsCreated: number; qualified: number; rewardsGranted: number; rewardPoints: number; referredCustomers: number; qualifyingAmountMinor: number }[];
  referrersPagination: Paging;
  referred: { referralId: string; referredCustomerId: string; referredName: string | null; referrerCustomerId: string; referrerName: string | null; createdAt: string; status: string; qualifiedAt: string | null; closeReason: string | null; referredReward: { status: string; points: number } | null; qualifyingAmountMinor: number | null }[];
  referredTotal: number;
  branchFilterSupported: false;
  notes: string[];
}

export type AbcClass = 'A' | 'B' | 'C';
export interface ReportsAbcOverview {
  period: ReportPeriod;
  branch: IdName | null;
  category: IdName | null;
  source: ReportsSource;
  filters: { branches: IdName[]; categories: (IdName & { isActive: boolean })[] };
  summary: {
    productsWithSales: number;
    productRevenueMinor: number;
    classes: { classification: AbcClass; products: number; revenueMinor: number; revenueSharePercent: number }[];
    zeroSalesCatalogProducts: number;
    nonPositiveRevenueProducts: number;
    nonPositiveRevenueMinor: number;
  };
  rows: { classification: AbcClass; productId: string; posterProductId: string; productName: string; categoryId: string; categoryName: string; units: number; revenueMinor: number; revenueSharePercent: number; cumulativeRevenueSharePercent: number; theoreticalCOGSMinor: number | null; theoreticalGrossProfitMinor: number | null }[];
  unmappedPos: { products: number; revenueMinor: number };
  reconciliation: { productReportRevenueMinor: number; abcRevenueMinor: number; excludedNonPositiveMinor: number; unmappedPosRevenueMinor: number };
  notes: string[];
}
