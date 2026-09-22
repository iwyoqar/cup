import { apiRequest } from './api';

// Phase 14 — Referral admin API. The backend validates everything again; nothing here decides a business rule. No response carries Telegram ids,
// phone numbers or customer ids.
export type ReferralStatus = 'ATTRIBUTED' | 'REGISTERED' | 'QUALIFIED' | 'REWARDED' | 'EXPIRED' | 'REJECTED' | 'INVALID';
export const REFERRAL_STATUSES: ReferralStatus[] = ['ATTRIBUTED', 'REGISTERED', 'QUALIFIED', 'REWARDED', 'EXPIRED', 'REJECTED', 'INVALID'];

export interface ReferralSettings {
  enabled: boolean;
  referrerRewardType: 'POINTS' | 'CASHBACK';
  referrerRewardValue: number;
  referredRewardType: 'POINTS' | 'CASHBACK';
  referredRewardValue: number;
  minimumPurchaseAmount: number;
  rewardOnFirstPurchaseOnly: boolean;
  maxSuccessfulReferrals: number;
  attributionWindowDays: number;
}

export interface ReferralSummary {
  total: number;
  byStatus: Record<ReferralStatus, number>;
  rewardsGrantedCount: number;
  rewardPointsGranted: number;
}

export interface ReferralRow {
  id: string;
  status: ReferralStatus;
  referrer: { displayName: string | null };
  referred: { displayName: string | null };
  createdAt: string;
  attributedAt: string | null;
  qualifiedAt: string | null;
  rewardedAt: string | null;
  closeReason: string | null;
  referrerRewardPoints: number;
  referredRewardPoints: number;
}

export interface ReferralPage {
  items: ReferralRow[];
  nextCursor: string | null;
}

export interface ReferralDetail {
  id: string;
  status: ReferralStatus;
  referrer: { displayName: string | null };
  referred: { displayName: string | null };
  attribution: { code: string | null; attributedAt: string; registeredAt: string | null };
  qualification: { qualifiedAt: string | null; source: string | null; amountMinor: number | null };
  closed: { at: string; reason: string | null } | null;
  rewards: { beneficiary: 'REFERRER' | 'REFERRED'; rewardType: string; status: 'GRANTED' | 'SKIPPED'; skipReason: string | null; points: number; at: string }[];
  timeline: { type: string; at: string; detail: string }[];
}

export interface ReferralFilters {
  status?: ReferralStatus | '';
  referrer?: string;
  referred?: string;
  from?: string; // yyyy-mm-dd
  to?: string;
}

export const CLOSE_REASON_LABELS: Record<string, string> = {
  ATTRIBUTION_EXPIRED: 'No qualifying purchase within the attribution window',
  PRIOR_PURCHASE: 'The friend had already purchased before the invitation',
  FIRST_PURCHASE_BELOW_MINIMUM: 'First purchase was below the minimum amount',
  SELF_REFERRAL: 'Self-referral',
};

export const SKIP_REASON_LABELS: Record<string, string> = {
  ZERO_REWARD: 'Reward value is 0',
  MAX_REFERRALS_REACHED: 'Referrer reached the maximum number of rewards',
  REWARD_TYPE_UNSUPPORTED: 'Reward type is not supported yet',
};

export function fetchReferralSettings(): Promise<ReferralSettings> {
  return apiRequest<ReferralSettings>('/admin/referrals/settings');
}

export function updateReferralSettings(patch: Partial<ReferralSettings>): Promise<ReferralSettings> {
  return apiRequest<ReferralSettings>('/admin/referrals/settings', { method: 'PATCH', body: patch });
}

export function fetchReferralSummary(): Promise<ReferralSummary> {
  return apiRequest<ReferralSummary>('/admin/referrals/summary');
}

export function fetchReferrals(filters: ReferralFilters, cursor?: string): Promise<ReferralPage> {
  const q = new URLSearchParams({ limit: '20' });
  if (filters.status) q.set('status', filters.status);
  if (filters.referrer?.trim()) q.set('referrer', filters.referrer.trim());
  if (filters.referred?.trim()) q.set('referred', filters.referred.trim());
  if (filters.from) q.set('from', new Date(`${filters.from}T00:00:00`).toISOString());
  if (filters.to) q.set('to', new Date(`${filters.to}T23:59:59.999`).toISOString());
  if (cursor) q.set('cursor', cursor);
  return apiRequest<ReferralPage>(`/admin/referrals?${q.toString()}`);
}

export function fetchReferral(id: string): Promise<ReferralDetail> {
  return apiRequest<ReferralDetail>(`/admin/referrals/${encodeURIComponent(id)}`);
}
