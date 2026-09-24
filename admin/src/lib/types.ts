export interface AdminProfile {
  id: string;
  email: string;
  role: string;
}

export interface AdminAuthenticatedSession {
  sessionToken: string;
  admin: AdminProfile;
}

// Mirrors the backend's LoyaltySettingsView exactly (src/modules/loyalty/loyalty-settings.service.ts).
export interface LoyaltySettings {
  enabled: boolean;
  earnRate: number;
  earnUnitAmount: number;
  minimumOrderAmount: number;
  welcomeBonus: number;
  pointsExpireAfterDays: number;
  spendEnabled: boolean;
  pointValue: number;
}

// Phase 4 — mirrors AdminCustomerListItem/AdminCustomerListPage exactly
// (src/modules/admin-customers/admin-customers.service.ts).
export interface AdminCustomerListItem {
  id: string;
  displayName: string | null;
  phone: string | null;
  username: string | null;
  orderCount: number;
  totalSpentMinor: number;
  lastOrderAt: string | null;
  // Phase 15 (additive, compact): unified lifecycle / RFM indicator.
  growth: { lifecycleState: string | null; rfmScore: string | null; lastPurchaseAt: string | null; daysSinceLastPurchase: number | null; lifetimeRevenue: number; lifetimePurchases: number };
}

export interface AdminCustomerListPage {
  items: AdminCustomerListItem[];
  nextCursor: string | null;
}

// Mirrors src/common/enums/order-status.ts.
export type OrderStatus =
  | 'pending'
  | 'sent_to_poster'
  | 'uncertain'
  | 'accepted'
  | 'preparing'
  | 'ready'
  | 'completed'
  | 'cancelled'
  | 'failed';

export interface AdminCustomerRecentOrder {
  id: string;
  status: OrderStatus;
  totalMinor: number;
  branch: { id: string; name: string } | null;
  createdAt: string;
}

// Mirrors AdminCustomer360 exactly.
export interface AdminCustomer360 {
  profile: { displayName: string | null; phone: string | null; username: string | null };
  metrics: {
    orderCount: number;
    totalSpentMinor: number;
    averageOrderMinor: number;
    firstOrderAt: string | null;
    lastOrderAt: string | null;
  };
  loyalty: {
    balance: number;
    lifetimeEarned: number;
    lifetimeSpent: number;
    // Phase 11.4 (additive): newest few ledger rows.
    recent: { type: string; points: number; balanceAfter: number; description: string | null; at: string }[];
  };
  favoriteBranch: { id: string; name: string } | null; // CUP orders only (legacy)
  recentOrders: AdminCustomerRecentOrder[];
  // Phase 11: the public identity code (what the customer's QR/barcode encodes) and Poster link state.
  identity: { loyaltyCode: string | null; posterLinked: boolean };
  // Phase 11.2 (additive): imported Poster POS purchases are a separate source; `metrics` above are CUP orders only.
  activity: {
    cupOrderCount: number;
    cupOrderTotalMinor: number;
    importedPosOrderCount: number;
    importedPosOrderTotalMinor: number;
    combinedOrderCount: number;
    combinedSpendMinor: number;
  };
  recentPosPurchases: { occurredAt: string; branchName: string; totalMinor: number; lines: { productName: string | null; quantity: number }[] }[];
  // Phase 11.3 (additive): reward progress per active program (CUP + imported POS qualifying purchases combined).
  rewards: { programName: string; threshold: number; qualifyingCount: number; availableRewards: number }[];
  // Phase 11.4 (additive): everything below is calculated by the server; the page only displays it.
  summary: {
    totalPurchases: number;
    totalRevenueMinor: number;
    averageCheckMinor: number;
    firstPurchaseAt: string | null;
    lastPurchaseAt: string | null;
    cupOrderCount: number;
    cupRevenueMinor: number;
    posPurchaseCount: number;
    posRevenueMinor: number;
    favoriteBranch: { name: string } | null;
    activeRewardCount: number;
    loyaltyBalance: number;
    promotionCount: number;
  };
  rewardHistory: { programName: string; productName: string | null; quantity: number; redeemedAt: string }[];
  promotions: {
    name: string;
    description: string | null;
    benefit: { type: string; value: number | null; productName: string | null; quantity: number | null };
    endsAt: string | null;
    remainingUses: number | null;
  }[];
  segments: { name: string; description: string | null }[];
  recentActivity: CustomerActivityItem[];
  // Phase 12 (additive): Loyalty 2.0 membership — read-only; `{ enabled: false }` while the program is off.
  membership: MembershipView;
  // Phase 13 (additive): recent CRM automation activity for this customer.
  crmActivity: { automationName: string; triggerType: string; status: string; reason: string | null; at: string }[];
  // Phase 14 (additive): referral footprint. Invited friends appear only as counts.
  // Phase 15 (additive): descriptive Growth Intelligence block (never a prediction).
  growth: import('./adminGrowth').CustomerGrowthBlock;
  referral: {
    referralCode: string | null;
    successfulReferrals: number;
    pendingReferrals: number;
    rewardPointsEarned: { asReferrer: number; asReferred: number; total: number };
    referredBy: { status: string; referrerName: string | null; at: string | null; closeReason: string | null } | null;
  };
}

export type MembershipView =
  | { enabled: false }
  | {
      enabled: true;
      level: { code: string; name: string; color: string; icon: string; cashbackRateBps: number; pointMultiplierPercent: number; prioritySupport: boolean; minLifetimeSpend: number } | null;
      nextLevel: { name: string; spendToNext: number } | null;
      lifetimeSpend: number;
      purchaseCount: number;
      xp: { lifetimeXP: number; levelStartXP: number; levelXP: number; nextLevelXP: number | null; xpToNextLevel: number | null };
      points: { balance: number; lifetimeEarned: number; lifetimeSpent: number };
      cashback: { enabled: boolean; balance: number; lifetimeEarned: number; lifetimeSpent: number; currentRateBps: number };
      streak: { enabled: boolean; current: number; best: number; lastVisitDate: string | null };
      achievements: { code: string; name: string; icon: string; unlocked: boolean; unlockedAt: string | null; progress: { current: number; target: number } }[];
      birthday: { enabled: boolean; birthdaySet: boolean; eligible: boolean; rewardPoints: number; windowEndsOn: string | null };
    };

// One unified activity row (GET /admin/customers/:id/activity and the 360 timeline). Carries no internal ids.
export interface CustomerActivityItem {
  type: 'CUP_ORDER' | 'POS_PURCHASE' | 'LOYALTY' | 'REWARD_REDEEMED';
  at: string;
  source: 'CUP' | 'POS' | null;
  branchName: string | null;
  amountMinor: number | null;
  status: string | null;
  lines: { productName: string | null; quantity: number; isReward: boolean }[];
  points: number | null;
  label: string | null;
}

export interface CustomerActivityPage {
  items: CustomerActivityItem[];
  nextCursor: string | null;
}

// Phase 11.2 / 19 — POST /admin/poster/import-transactions response (preview and import share ONE shape).
export type PosterImportCategory =
  | 'IMPORTABLE'
  | 'ALREADY_IMPORTED'
  | 'CUP_ORIGINATED'
  | 'POSSIBLE_CUP_ORIGIN'
  | 'UNRESOLVED'
  | 'UNSUPPORTED_LINE'
  | 'UNMAPPED_BRANCH'
  | 'UNPAID'
  | 'TOO_RECENT'
  | 'REFUND_UNVERIFIED'
  | 'OTHER';

export interface PosterImportDetail {
  posterTransactionId: string;
  outcome: string;
  reason?: string;
  category: PosterImportCategory;
  decision: 'IMPORT' | 'SKIP' | 'ALREADY_IMPORTED' | 'CUP_ORIGINATED' | 'UNRESOLVED';
  occurredAt?: string;
  posterSpotId?: number;
  branchName?: string | null;
  customerName?: string | null;
  hasPosterClient?: boolean;
  totalMinor?: number;
  paidMinor?: number;
  posterStatus?: string;
  lines?: { posterProductId: string; productName: string | null; quantity: number; paidMinor: number }[];
}

export interface PosterImportSummary {
  mode: 'preview' | 'import';
  window: { since: string; until: string };
  limit: number;
  truncated: boolean;
  scanned: number;
  importable: number;
  imported: number;
  alreadyImported: number;
  cupOriginated: number;
  unresolved: number;
  skipped: number;
  failed: number;
  reasons: Record<string, number>;
  cupOrderLinksChecked: number;
  categories: Record<PosterImportCategory, number>;
  revenueByCategoryMinor: Record<PosterImportCategory, number>;
  partiallyPaid: number;
  importedTransactionIds: string[];
  refundPolicy: { status: 'REFUND_UNVERIFIED'; note: string; excludedReceipts: number; deletedInPosterWindow: number | null; importedButDeletedInPoster: string[] };
  posterReads: { transactions: number; deletedTransactions: number; incomingOrderLinks: number };
  details: PosterImportDetail[];
}

// Phase 11 — mirrors AdminStaffController's view. The password hash never reaches the client.
export interface StaffMember {
  id: string;
  username: string;
  displayName: string;
  isActive: boolean;
  branch: { id: string; name: string } | null;
  createdAt: string;
  // Optional, UI-ready: shown only when the API returns them (a future Poster staff sync). Not part of today's response.
  posterUserId?: number | null;
}

// Phase 5 — mirrors segment-condition-allowlist.ts exactly. The UI must never allow an
// arbitrary field/operator combination — see SEGMENT_FIELD_META below, which drives which
// operators/input type are offered once a field is selected.
export const SEGMENT_FIELDS = [
  'orderCount',
  'totalSpentMinor',
  'averageOrderMinor',
  'firstOrderAt',
  'lastOrderAt',
  'loyaltyBalance',
  'loyaltyLifetimeEarned',
  'loyaltyLifetimeSpent',
  'favoriteBranch',
  // Phase 15 — Growth Intelligence (unified CUP + POS, all branches, the configured default lookback)
  'lifecycleState',
  'rfmScore',
  'rfmTotal',
  'recencyScore',
  'frequencyScore',
  'monetaryScore',
  'recencyDays',
  'daysSinceLastPurchase',
  'daysSinceFirstPurchase',
  'frequency',
  'monetary',
  'lifetimeRevenue',
  'lifetimePurchases',
  'growthSignal',
] as const;
export type SegmentField = (typeof SEGMENT_FIELDS)[number];

export const SEGMENT_OPERATORS = [
  'equals',
  'not_equals',
  'greater_than',
  'greater_than_or_equal',
  'less_than',
  'less_than_or_equal',
  'before',
  'before_or_equal',
  'after',
  'after_or_equal',
] as const;
export type SegmentOperator = (typeof SEGMENT_OPERATORS)[number];

export type SegmentValueType = 'number' | 'date' | 'string';

interface SegmentFieldMeta {
  label: string;
  valueType: SegmentValueType;
  operators: readonly SegmentOperator[];
  options?: readonly string[]; // a fixed set of allowed values (rendered as a select)
  placeholder?: string;
}

const NUMERIC_OPERATORS: readonly SegmentOperator[] = [
  'equals',
  'not_equals',
  'greater_than',
  'greater_than_or_equal',
  'less_than',
  'less_than_or_equal',
];
const DATE_OPERATORS: readonly SegmentOperator[] = ['before', 'before_or_equal', 'after', 'after_or_equal'];
const STRING_OPERATORS: readonly SegmentOperator[] = ['equals', 'not_equals'];

// The ONLY place the UI decides which operators are valid for a field — mirrors the backend's
// own allowlist exactly, but the backend independently re-validates everything regardless (the
// UI restriction is a convenience, never the actual security boundary).
export const SEGMENT_FIELD_META: Record<SegmentField, SegmentFieldMeta> = {
  orderCount: { label: 'Order count', valueType: 'number', operators: NUMERIC_OPERATORS },
  totalSpentMinor: { label: 'Total spent (so\'m)', valueType: 'number', operators: NUMERIC_OPERATORS },
  averageOrderMinor: { label: 'Average order (so\'m)', valueType: 'number', operators: NUMERIC_OPERATORS },
  firstOrderAt: { label: 'First order date', valueType: 'date', operators: DATE_OPERATORS },
  lastOrderAt: { label: 'Last order date', valueType: 'date', operators: DATE_OPERATORS },
  loyaltyBalance: { label: 'Loyalty balance', valueType: 'number', operators: NUMERIC_OPERATORS },
  loyaltyLifetimeEarned: { label: 'Loyalty lifetime earned', valueType: 'number', operators: NUMERIC_OPERATORS },
  loyaltyLifetimeSpent: { label: 'Loyalty lifetime spent', valueType: 'number', operators: NUMERIC_OPERATORS },
  favoriteBranch: { label: 'Favorite branch', valueType: 'string', operators: STRING_OPERATORS },
  lifecycleState: { label: 'Lifecycle state', valueType: 'string', operators: STRING_OPERATORS, options: ['NEW', 'ACTIVE', 'LOYAL', 'AT_RISK', 'DORMANT', 'CHURNED'] },
  rfmScore: { label: 'RFM score (e.g. 543)', valueType: 'string', operators: STRING_OPERATORS, placeholder: '543' },
  rfmTotal: { label: 'RFM total (R+F+M, 3–15)', valueType: 'number', operators: NUMERIC_OPERATORS },
  recencyScore: { label: 'Recency score (1–5)', valueType: 'number', operators: NUMERIC_OPERATORS },
  frequencyScore: { label: 'Frequency score (1–5)', valueType: 'number', operators: NUMERIC_OPERATORS },
  monetaryScore: { label: 'Monetary score (1–5)', valueType: 'number', operators: NUMERIC_OPERATORS },
  recencyDays: { label: 'Recency: days since last purchase', valueType: 'number', operators: NUMERIC_OPERATORS },
  daysSinceLastPurchase: { label: 'Days since last purchase', valueType: 'number', operators: NUMERIC_OPERATORS },
  daysSinceFirstPurchase: { label: 'Days since first purchase', valueType: 'number', operators: NUMERIC_OPERATORS },
  frequency: { label: 'Frequency: purchases in lookback', valueType: 'number', operators: NUMERIC_OPERATORS },
  monetary: { label: 'Monetary: revenue in lookback (so\'m)', valueType: 'number', operators: NUMERIC_OPERATORS },
  lifetimeRevenue: { label: 'Lifetime revenue, CUP + POS (so\'m)', valueType: 'number', operators: NUMERIC_OPERATORS },
  lifetimePurchases: { label: 'Lifetime purchases, CUP + POS', valueType: 'number', operators: NUMERIC_OPERATORS },
  growthSignal: {
    label: 'Growth signal (has / does not have)',
    valueType: 'string',
    operators: STRING_OPERATORS,
    options: ['FIRST_PURCHASE', 'SECOND_PURCHASE', 'HIGH_VALUE_CUSTOMER', 'RISING_CUSTOMER', 'AT_RISK', 'DORMANT', 'CHURNED', 'REWARD_AVAILABLE', 'REFERRAL_SUCCESS', 'LOYALTY_LEVEL_UP', 'BIRTHDAY_UPCOMING'],
  },
};

export const SEGMENT_OPERATOR_LABELS: Record<SegmentOperator, string> = {
  equals: 'equals',
  not_equals: 'does not equal',
  greater_than: 'greater than',
  greater_than_or_equal: 'greater than or equal to',
  less_than: 'less than',
  less_than_or_equal: 'less than or equal to',
  before: 'before',
  before_or_equal: 'before or on',
  after: 'after',
  after_or_equal: 'after or on',
};

export interface SegmentCondition {
  field: SegmentField;
  operator: SegmentOperator;
  value: string;
}

export interface Segment {
  id: string;
  name: string;
  description: string | null;
  logic: 'AND' | 'OR';
  conditions: SegmentCondition[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SegmentListPage {
  items: Segment[];
  nextCursor: string | null;
}

export interface SegmentMatchingCustomer {
  id: string;
  displayName: string | null;
  phone: string | null;
  username: string | null;
  orderCount: number;
  totalSpentMinor: number;
  averageOrderMinor: number;
  lastOrderAt: string | null;
  favoriteBranch: string | null;
  loyaltyBalance: number;
}

export interface SegmentMatchingCustomersPage {
  items: SegmentMatchingCustomer[];
  nextCursor: string | null;
}

// Phase 6 — mirrors src/modules/campaigns/campaign.types.ts exactly. Telegram is the only
// channel Phase 6 supports (src/common/enums/campaign-channel.ts) — a one-member union kept
// for future extensibility, not because the UI offers a real choice today.
export type CampaignChannel = 'telegram';

// Mirrors src/common/enums/campaign-status.ts. 'failed' is reserved for a genuine
// campaign-execution failure, never merely "some recipients failed" — see CampaignDetailView.
export type CampaignStatus = 'draft' | 'sending' | 'completed' | 'failed';

// Mirrors src/common/enums/campaign-recipient-status.ts. 'pending' covers both "not yet
// attempted" and "attempted with an uncertain outcome" — see CampaignDetailView's recipient
// status labels.
export type CampaignRecipientStatus = 'pending' | 'sent' | 'failed' | 'skipped';

export interface CampaignRecipientStats {
  pending: number;
  sent: number;
  failed: number;
  skipped: number;
}

export interface CampaignListItem {
  id: string;
  name: string;
  segment: { id: string; name: string };
  channel: CampaignChannel;
  status: CampaignStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignListPage {
  items: CampaignListItem[];
  nextCursor: string | null;
}

export interface Campaign {
  id: string;
  name: string;
  description: string | null;
  segment: { id: string; name: string };
  channel: CampaignChannel;
  status: CampaignStatus;
  messageText: string;
  stats: CampaignRecipientStats;
  createdAt: string;
  updatedAt: string;
}

export interface AudienceCandidate {
  customerId: string;
  displayName: string | null;
  phone: string | null;
  eligible: boolean;
  skipReason: 'no_telegram_account' | null;
}

export interface AudiencePreviewPage {
  segmentMatchCount: number;
  telegramEligibleCount: number;
  skippedCount: number;
  items: AudienceCandidate[];
  nextCursor: string | null;
}

export interface CampaignRecipientItem {
  customerId: string;
  displayName: string | null;
  phone: string | null;
  status: CampaignRecipientStatus;
  sentAt: string | null;
  failedAt: string | null;
  errorCode: string | null;
}

export interface CampaignRecipientsPage {
  items: CampaignRecipientItem[];
  nextCursor: string | null;
}

// Phase 7 — mirrors src/modules/promotions/promotion-benefit-allowlist.ts and
// promotion.types.ts exactly.
export const PROMOTION_BENEFIT_TYPES = ['PERCENT_DISCOUNT', 'FIXED_DISCOUNT', 'FREE_PRODUCT', 'LOYALTY_POINTS'] as const;
export type PromotionBenefitType = (typeof PROMOTION_BENEFIT_TYPES)[number];

export const PROMOTION_BENEFIT_TYPE_LABELS: Record<PromotionBenefitType, string> = {
  PERCENT_DISCOUNT: 'Percent discount',
  FIXED_DISCOUNT: 'Fixed discount',
  FREE_PRODUCT: 'Free product',
  LOYALTY_POINTS: 'Loyalty points',
};

export type PromotionEligibilityReason =
  | 'INACTIVE'
  | 'NOT_STARTED'
  | 'EXPIRED'
  | 'SEGMENT_MISMATCH'
  | 'USAGE_LIMIT_REACHED'
  | 'INVALID_BENEFIT'
  | 'NOT_ELIGIBLE';

export const PROMOTION_ELIGIBILITY_REASON_LABELS: Record<PromotionEligibilityReason, string> = {
  INACTIVE: 'Promotion is inactive',
  NOT_STARTED: 'Not started yet',
  EXPIRED: 'Expired',
  SEGMENT_MISMATCH: 'Not in target segment',
  USAGE_LIMIT_REACHED: 'Usage limit reached',
  INVALID_BENEFIT: 'Benefit currently unavailable',
  NOT_ELIGIBLE: 'Not eligible',
};

export interface PromotionBenefitView {
  type: PromotionBenefitType;
  value: number | null;
  product: { id: string; name: string } | null;
  quantity: number | null;
}

export interface PromotionListItem {
  id: string;
  name: string;
  segment: { id: string; name: string } | null;
  benefit: PromotionBenefitView;
  isActive: boolean;
  startsAt: string;
  endsAt: string | null;
  usageLimitPerCustomer: number | null;
  updatedAt: string;
}

export interface PromotionListPage {
  items: PromotionListItem[];
  nextCursor: string | null;
}

export interface Promotion {
  id: string;
  name: string;
  description: string | null;
  segment: { id: string; name: string } | null;
  benefit: PromotionBenefitView;
  startsAt: string;
  endsAt: string | null;
  isActive: boolean;
  usageLimitPerCustomer: number | null;
  redemptionCount: number;
  hasRedemptions: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PromotionAudienceCandidate {
  customerId: string;
  displayName: string | null;
  phone: string | null;
  eligible: boolean;
  reason: PromotionEligibilityReason | null;
}

export interface PromotionAudiencePreviewPage {
  segmentMatchCount: number;
  eligibleCount: number;
  ineligibleCount: number;
  items: PromotionAudienceCandidate[];
  nextCursor: string | null;
}

export interface PromotionRedemptionItem {
  customerId: string;
  displayName: string | null;
  phone: string | null;
  usageIndex: number;
  benefit: PromotionBenefitView;
  orderId: string | null;
  redeemedAt: string;
}

export interface PromotionRedemptionsPage {
  items: PromotionRedemptionItem[];
  nextCursor: string | null;
}

// Phase 8 — mirrors src/modules/rewards/reward-program.types.ts exactly.
export type RewardProgramType = 'BUY_X_GET_Y';

export interface RewardProgram {
  id: string;
  name: string;
  description: string | null;
  type: RewardProgramType;
  qualifyingCategory: { id: string; name: string };
  buyQuantity: number;
  rewardQuantity: number;
  isActive: boolean;
  startsAt: string;
  endsAt: string | null;
  redemptionCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface RewardProgramListItem {
  id: string;
  name: string;
  description: string | null;
  type: RewardProgramType;
  qualifyingCategory: { id: string; name: string };
  buyQuantity: number;
  rewardQuantity: number;
  isActive: boolean;
  startsAt: string;
  endsAt: string | null;
  updatedAt: string;
}

export interface RewardProgramListPage {
  items: RewardProgramListItem[];
  nextCursor: string | null;
}

export interface RewardRedemptionItem {
  customerId: string;
  displayName: string | null;
  phone: string | null;
  redemptionIndex: number;
  rewardProduct: { id: string; name: string } | null;
  rewardQuantity: number;
  orderId: string | null;
  redeemedAt: string;
}

export interface RewardRedemptionsPage {
  items: RewardRedemptionItem[];
  nextCursor: string | null;
}

// Phase 17 — GET /admin/analytics/overview. Every number is computed by the backend (whole UZS); the UI only formats.
export type AnalyticsPeriodKey = 'today' | 'yesterday' | 'last7' | 'last30' | 'custom';

export interface AnalyticsOverview {
  period: { key: AnalyticsPeriodKey; startDate: string; endDate: string; timezoneOffsetMinutes: number };
  branch: { id: string; name: string } | null;
  filters: { branches: { id: string; name: string }[] };
  revenue: number;
  orders: number;
  customers: number;
  averageOrder: number;
  newCustomers: number;
  returningCustomers: number;
  revenueByDay: { date: string; revenue: number }[];
  sourceBreakdown: {
    cup: { orders: number; revenue: number };
    pos: { purchases: number; revenue: number; importedDataExists: boolean };
  };
  topProducts: { name: string; quantity: number; revenue: number }[];
}

// Finance-1 — GET /admin/finance/*. Every number is computed by the backend (whole UZS minor units); the UI only
// formats. Revenue reuses Analytics' own already-deduped CUP+POS source; COGS is read live from Poster's own
// recipe data (never invented) and is explicitly flagged incomplete rather than guessed.
export type FinancePeriodKey = 'today' | 'yesterday' | 'thisWeek' | 'thisMonth' | 'lastMonth' | 'custom';

export interface FinanceExpenseLine {
  categoryId: string;
  categoryName: string;
  amountMinor: number;
}

export interface FinanceTaxLine {
  ruleId: string;
  name: string;
  ratePct: number;
  calculationBase: string;
  baseAmountMinor: number;
  amountMinor: number;
}

export interface FinancePnlOverview {
  period: { key: FinancePeriodKey; startDate: string; endDate: string };
  branch: { id: string; name: string } | null;
  filters: { branches: { id: string; name: string }[] };
  revenue: number;
  cogs: { amountMinor: number; complete: boolean; missingRecipeProducts: { name: string; quantity: number }[] };
  grossProfit: number;
  grossMarginPct: number | null;
  operatingExpenses: { total: number; byCategory: FinanceExpenseLine[] };
  operatingProfit: number;
  operatingMarginPct: number | null;
  taxes: { total: number; lines: FinanceTaxLine[] };
  interest: number;
  otherFinancialCosts: { total: number; byCategory: FinanceExpenseLine[] };
  netProfit: number;
  netMarginPct: number | null;
  topGrossProfitProducts: { name: string; quantity: number; revenueMinor: number; costMinor: number; grossProfitMinor: number }[];
}

export interface FinanceCashFlowOverview {
  period: { key: FinancePeriodKey; startDate: string; endDate: string };
  branch: { id: string; name: string } | null;
  openingBalance: number;
  cashIn: { revenue: number; manualAdjustments: number; total: number };
  cashOut: {
    operatingExpensesPaid: number;
    financialExpensesPaid: number;
    loanPrincipal: number;
    loanInterest: number;
    investments: number;
    manualAdjustments: number;
    total: number;
  };
  netCashFlow: number;
  closingBalance: number;
  limitations: string[];
}

export interface FinanceExpenseCategory {
  id: string;
  name: string;
  type: 'OPERATING' | 'FINANCIAL';
  sortOrder: number;
  isActive: boolean;
}

export interface FinanceExpense {
  id: string;
  categoryId: string;
  category: FinanceExpenseCategory;
  description: string;
  amountMinor: number;
  date: string;
  branchId: string | null;
  branch: { id: string; name: string } | null;
  isRecurring: boolean;
  recurrenceInterval: string | null;
  paymentStatus: 'PAID' | 'UNPAID';
  notes: string | null;
}

export interface FinanceExpensesPage {
  rows: FinanceExpense[];
  nextCursor: string | null;
}

export interface FinanceLoan {
  id: string;
  lender: string;
  principalMinor: number;
  annualInterestRatePct: number;
  termMonths: number;
  startDate: string;
  status: 'ACTIVE' | 'PAID_OFF' | 'DEFAULTED';
  notes: string | null;
  estimatedMonthlyPaymentMinor: number;
  outstandingPrincipalMinor: number;
  totalPrincipalPaidMinor: number;
  totalInterestPaidMinor: number;
  paymentsMade: number;
  nextEstimatedPaymentDate: string | null;
}

export interface FinanceTaxRule {
  id: string;
  name: string;
  ratePct: number;
  calculationBase: 'REVENUE' | 'GROSS_PROFIT' | 'OPERATING_PROFIT';
  isActive: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  notes: string | null;
}

export interface FinanceInvestment {
  id: string;
  category: string;
  description: string;
  amountMinor: number;
  date: string;
  branchId: string | null;
  branch: { id: string; name: string } | null;
  paymentSource: string | null;
  notes: string | null;
}

export interface FinancePayback {
  totalInvestmentMinor: number;
  cumulativeCashFlowMinor: number;
  remainingInvestmentMinor: number;
  paybackProgressPct: number | null;
  estimatedPaybackMonths: number | null;
  estimatedPaybackDate: string | null;
  status: 'NO_INVESTMENT_RECORDED' | 'INSUFFICIENT_HISTORY' | 'NEGATIVE_CASH_FLOW' | 'OK';
  note: string;
}

export interface FinanceRoi {
  period: { key: FinancePeriodKey; startDate: string; endDate: string };
  netProfitMinor: number;
  totalInvestmentMinor: number;
  roiPct: number | null;
}
