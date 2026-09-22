// Phase 12 — the allowlist of achievement conditions and the STARTING configuration seeded once into an empty database.
// The seeded values are editable defaults, not business facts: the program stays switched off (Loyalty2Settings.enabled =
// false) until an admin reviews and enables it, and every achievement reward starts at 0 points.

export const ACHIEVEMENT_CONDITION_TYPES = [
  'TOTAL_PURCHASES', // qualifying purchases (CUP orders + imported POS) >= conditionValue
  'CATEGORY_UNITS', // paid units in categoryId (same source as reward progress) >= conditionValue
  'MORNING_PURCHASES', // purchases before conditionParam o'clock (business time) >= conditionValue
  'WEEKEND_PURCHASES', // purchases on Saturday/Sunday (business time) >= conditionValue
  'BEST_STREAK', // best visit streak >= conditionValue (needs the streak feature enabled)
  'REWARD_REDEMPTIONS', // reward redemptions (5+1 etc.) >= conditionValue
] as const;
export type AchievementConditionType = (typeof ACHIEVEMENT_CONDITION_TYPES)[number];

export function isAchievementConditionType(value: string): value is AchievementConditionType {
  return (ACHIEVEMENT_CONDITION_TYPES as readonly string[]).includes(value);
}

export const DEFAULT_LEVELS = [
  { code: 'BRONZE', name: 'Bronze', color: '#B0723A', icon: '🥉', minLifetimeSpend: 0, cashbackRateBps: 100, pointMultiplierPercent: 100, prioritySupport: false },
  { code: 'SILVER', name: 'Silver', color: '#9AA0A6', icon: '🥈', minLifetimeSpend: 500_000, cashbackRateBps: 200, pointMultiplierPercent: 110, prioritySupport: false },
  { code: 'GOLD', name: 'Gold', color: '#C9A227', icon: '🥇', minLifetimeSpend: 2_000_000, cashbackRateBps: 300, pointMultiplierPercent: 125, prioritySupport: true },
  { code: 'BLACK', name: 'Black', color: '#111111', icon: '🖤', minLifetimeSpend: 5_000_000, cashbackRateBps: 500, pointMultiplierPercent: 150, prioritySupport: true },
] as const;

export interface AchievementSeed {
  code: string;
  name: string;
  description: string;
  icon: string;
  conditionType: AchievementConditionType;
  conditionValue: number;
  conditionParam: number | null;
  isActive: boolean;
  sortOrder: number;
}

// The coffee achievements need a category; that choice is Admin's (never hardcoded), so they start inactive.
export const DEFAULT_ACHIEVEMENTS: AchievementSeed[] = [
  { code: 'FIRST_PURCHASE', name: 'First Purchase', description: 'Make your first purchase.', icon: '🎉', conditionType: 'TOTAL_PURCHASES', conditionValue: 1, conditionParam: null, isActive: true, sortOrder: 10 },
  { code: 'FIRST_COFFEE', name: 'First Coffee', description: 'Enjoy your first coffee.', icon: '☕', conditionType: 'CATEGORY_UNITS', conditionValue: 1, conditionParam: null, isActive: false, sortOrder: 20 },
  { code: 'COFFEES_10', name: '10 Coffees', description: 'Enjoy 10 coffees.', icon: '☕', conditionType: 'CATEGORY_UNITS', conditionValue: 10, conditionParam: null, isActive: false, sortOrder: 30 },
  { code: 'COFFEES_50', name: '50 Coffees', description: 'Enjoy 50 coffees.', icon: '🏅', conditionType: 'CATEGORY_UNITS', conditionValue: 50, conditionParam: null, isActive: false, sortOrder: 40 },
  { code: 'COFFEES_100', name: '100 Coffees', description: 'Enjoy 100 coffees.', icon: '🏆', conditionType: 'CATEGORY_UNITS', conditionValue: 100, conditionParam: null, isActive: false, sortOrder: 50 },
  { code: 'MASTER_5_PLUS_1', name: '5+1 Master', description: 'Redeem your first free reward.', icon: '🎁', conditionType: 'REWARD_REDEMPTIONS', conditionValue: 1, conditionParam: null, isActive: true, sortOrder: 60 },
  { code: 'MORNING_LOVER', name: 'Morning Lover', description: 'Visit us before 11:00 five times.', icon: '🌅', conditionType: 'MORNING_PURCHASES', conditionValue: 5, conditionParam: 11, isActive: true, sortOrder: 70 },
  { code: 'WEEKEND_VISITOR', name: 'Weekend Visitor', description: 'Visit us on four weekend days.', icon: '🌴', conditionType: 'WEEKEND_PURCHASES', conditionValue: 4, conditionParam: null, isActive: true, sortOrder: 80 },
  { code: 'STREAK_7', name: 'Week Streak', description: 'Visit seven days in a row.', icon: '🔥', conditionType: 'BEST_STREAK', conditionValue: 7, conditionParam: null, isActive: true, sortOrder: 90 },
];
