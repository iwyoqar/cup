import { apiRequest } from './api';
import { LoyaltySettings } from './types';

// Phase 12 — Loyalty 2.0 admin configuration (settings, levels, achievements). Every rule is validated again on the server.
export interface Loyalty2Settings {
  enabled: boolean;
  xpRate: number;
  xpUnitAmount: number;
  cashbackEnabled: boolean;
  purchasePointsEnabled: boolean;
  streakEnabled: boolean;
  birthdayEnabled: boolean;
  birthdayRewardPoints: number;
  birthdayWindowDays: number;
  referralEnabled: boolean;
  accrualStartsAt: string | null;
}

export interface LoyaltyLevelRow {
  code: string;
  name: string;
  color: string;
  icon: string;
  minLifetimeSpend: number;
  cashbackRateBps: number;
  pointMultiplierPercent: number;
  prioritySupport: boolean;
  isActive: boolean;
}

export interface AchievementRow {
  id: string;
  code: string;
  name: string;
  description: string;
  icon: string;
  conditionType: string;
  conditionValue: number;
  conditionParam: number | null;
  categoryId: string | null;
  rewardPoints: number;
  isActive: boolean;
  sortOrder: number;
}

export const CONDITION_LABELS: Record<string, string> = {
  TOTAL_PURCHASES: 'Total purchases',
  CATEGORY_UNITS: 'Units in a category',
  MORNING_PURCHASES: 'Purchases before an hour',
  WEEKEND_PURCHASES: 'Weekend purchases',
  BEST_STREAK: 'Best visit streak (days)',
  REWARD_REDEMPTIONS: 'Reward redemptions',
};

export const fetchLoyalty2Settings = () => apiRequest<Loyalty2Settings>('/admin/loyalty2/settings');
export const updateLoyalty2Settings = (partial: Partial<Loyalty2Settings>) => apiRequest<Loyalty2Settings>('/admin/loyalty2/settings', { method: 'PATCH', body: partial });
export const fetchLoyalty2Levels = () => apiRequest<LoyaltyLevelRow[]>('/admin/loyalty2/levels');
export const saveLoyalty2Levels = (levels: LoyaltyLevelRow[]) => apiRequest<LoyaltyLevelRow[]>('/admin/loyalty2/levels', { method: 'PUT', body: { levels } });
export const fetchLoyalty2Achievements = () => apiRequest<AchievementRow[]>('/admin/loyalty2/achievements');
export const createLoyalty2Achievement = (a: Omit<AchievementRow, 'id'>) => apiRequest<AchievementRow>('/admin/loyalty2/achievements', { method: 'POST', body: a });
export const updateLoyalty2Achievement = (id: string, a: Partial<Omit<AchievementRow, 'id' | 'code'>>) => apiRequest<AchievementRow>(`/admin/loyalty2/achievements/${id}`, { method: 'PATCH', body: a });

// The existing points-earning rule (Phase 3) is reused, not duplicated: it is read/written through its own endpoint.
export const fetchPointsRule = () => apiRequest<LoyaltySettings>('/admin/settings/loyalty');
export const updatePointsRule = (partial: Partial<LoyaltySettings>) => apiRequest<LoyaltySettings>('/admin/settings/loyalty', { method: 'PATCH', body: partial });
