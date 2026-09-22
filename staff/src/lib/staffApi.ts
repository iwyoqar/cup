import { apiRequest } from './api';

export interface StaffProfile {
  kind: 'STAFF' | 'ADMIN';
  id: string;
  role: 'STAFF' | 'ADMIN';
  displayName: string;
  branch: { id: string; name: string } | null;
}

export type LifecycleState = 'NEW' | 'ACTIVE' | 'LOYAL' | 'AT_RISK' | 'DORMANT' | 'CHURNED';
export type Scope = 'branch' | 'all';

// Phase 16 — the Staff Customer Profile (GET /staff/customers/by-code/:code/profile). Every figure is decided by the server from the canonical read
// models; this app only displays it. The server never sends customer ids, Telegram / Poster ids, full phone numbers or CRM internals.
export interface ActivityItem {
  type: 'CUP_ORDER' | 'POS_PURCHASE' | 'LOYALTY' | 'REWARD_REDEEMED';
  at: string;
  source: 'CUP' | 'POS' | null;
  branchName: string | null;
  amountMinor: number | null;
  status: string | null;
  lines: { productName: string | null; quantity: number; isReward: boolean }[];
}

export interface ActivityPage {
  scope: 'BRANCH' | 'ALL';
  items: ActivityItem[];
  nextCursor: string | null;
}

export interface GrowthBlock {
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
}

export interface CustomerProfile {
  scope: { kind: 'BRANCH' | 'ALL'; branch: { name: string } | null };
  identity: {
    displayName: string | null;
    publicCode: string;
    phoneMasked: string | null;
    telegramUsername: string | null;
    poster: { state: 'LINKED' | 'NOT_LINKED' };
    customerSince: string;
    firstPurchaseAt: string | null;
    birthday: { month: number; day: number } | null;
  };
  loyalty: {
    legacyProgramEnabled: boolean;
    account: { balance: number; lifetimeEarned: number; lifetimeSpent: number } | null;
    program2:
      | { enabled: false }
      | {
          enabled: true;
          level: { name: string; icon: string; color: string } | null;
          nextLevel: { name: string; spendToNext: number } | null;
          xp: { lifetimeXP: number; levelStartXP: number; levelXP: number; nextLevelXP: number | null; xpToNextLevel: number | null };
          streak: { enabled: boolean; current: number; best: number; lastVisitDate: string | null };
          cashback: { enabled: boolean; balance: number; lifetimeEarned: number; lifetimeSpent: number; currentRateBps: number };
          birthday: { eligible: boolean };
        };
  };
  rewards: {
    programs: { programName: string; threshold: number; qualifyingCount: number; remainingToNext: number; availableRewards: number }[];
    availableTotal: number;
    redemptions: { total: number; recent: { programName: string; productName: string | null; quantity: number; redeemedAt: string }[] };
  };
  promotions: { name: string; description: string | null; benefit: { type: string; value: number | null; product: { name: string } | null; quantity: number | null }; startsAt: string; endsAt: string | null; remainingUses: number | null }[];
  referral: {
    referralCode: string | null;
    invited: { successful: number; pending: number; qualified: number; rewarded: number };
    referredBy: { status: string; at: string | null } | null;
  };
  growth: {
    all: GrowthBlock & {
      signals: { type: string; severity: 'INFO' | 'OPPORTUNITY' | 'ATTENTION'; detectedAt: string | null; reason: string }[];
      opportunities: { type: string; priority: 'HIGH' | 'MEDIUM' | 'LOW'; reason: string }[];
    };
    branch: (GrowthBlock & { branchName: string }) | null;
  };
  activity: ActivityPage;
}

export interface SearchResult {
  displayName: string | null;
  publicCode: string;
  phoneLast4: string | null;
  phoneMasked: string | null;
  telegramUsername: string | null;
  level: string | null;
  lifecycleState: LifecycleState | null;
  lastPurchaseAt: string | null;
  daysSinceLastPurchase: number | null;
}

export interface RecentCustomer {
  displayName: string | null;
  publicCode: string;
  phoneMasked: string | null;
  viewedAt: string;
  lifecycleState: LifecycleState | null;
  lastPurchaseAt: string | null;
}

export interface PosterCandidates {
  state: 'LINKED' | 'NOT_LINKED';
  candidates: { displayName: string; phoneLast4: string; choice: string }[];
}

export function staffLogin(identifier: string, password: string): Promise<{ sessionToken: string; staff: StaffProfile }> {
  return apiRequest('/staff/auth', { method: 'POST', body: { identifier, password } });
}

export function fetchStaffMe(): Promise<StaffProfile> {
  return apiRequest('/staff/me');
}

// The scan: ONE request returns everything shown on the profile. `scope` is the branch view the staff member is looking at (default = their own branch).
export function fetchProfile(code: string, scope?: Scope): Promise<CustomerProfile> {
  const q = scope ? `?scope=${scope}` : '';
  return apiRequest(`/staff/customers/by-code/${encodeURIComponent(code)}/profile${q}`);
}

export function fetchActivity(code: string, cursor: string, scope?: Scope): Promise<ActivityPage> {
  const q = new URLSearchParams({ cursor, limit: '20' });
  if (scope) q.set('scope', scope);
  return apiRequest(`/staff/customers/by-code/${encodeURIComponent(code)}/activity?${q.toString()}`);
}

export function fetchRecent(): Promise<RecentCustomer[]> {
  return apiRequest('/staff/recent');
}

export function searchCustomers(query: string): Promise<SearchResult[]> {
  return apiRequest(`/staff/customers/search?query=${encodeURIComponent(query)}`);
}

export function fetchPosterCandidates(code: string): Promise<PosterCandidates> {
  return apiRequest(`/staff/customers/by-code/${encodeURIComponent(code)}/poster-candidates`);
}

export function linkPosterClient(code: string, choice: string): Promise<{ state: 'LINKED'; changed: boolean }> {
  return apiRequest(`/staff/customers/by-code/${encodeURIComponent(code)}/poster-link`, { method: 'POST', body: { choice } });
}
