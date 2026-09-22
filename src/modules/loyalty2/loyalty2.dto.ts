import { z } from 'zod';

// Shape validation only — the services re-validate every business rule (ranges, ordering, catalog existence) server-side.
export const updateLoyalty2SettingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    xpRate: z.number().int().optional(),
    xpUnitAmount: z.number().int().optional(),
    cashbackEnabled: z.boolean().optional(),
    purchasePointsEnabled: z.boolean().optional(),
    streakEnabled: z.boolean().optional(),
    birthdayEnabled: z.boolean().optional(),
    birthdayRewardPoints: z.number().int().optional(),
    birthdayWindowDays: z.number().int().optional(),
    referralEnabled: z.boolean().optional(),
    accrualStartsAt: z.string().min(1).nullable().optional(),
  })
  .strict();

const levelSchema = z
  .object({
    code: z.string(),
    name: z.string(),
    color: z.string(),
    icon: z.string(),
    minLifetimeSpend: z.number().int(),
    cashbackRateBps: z.number().int(),
    pointMultiplierPercent: z.number().int(),
    prioritySupport: z.boolean(),
    isActive: z.boolean(),
  })
  .strict();

export const replaceLevelsSchema = z.object({ levels: z.array(levelSchema) }).strict();

const achievementFields = {
  name: z.string(),
  description: z.string(),
  icon: z.string(),
  conditionType: z.string(),
  conditionValue: z.number().int(),
  conditionParam: z.number().int().nullable().optional(),
  categoryId: z.string().min(1).nullable().optional(),
  rewardPoints: z.number().int(),
  isActive: z.boolean(),
  sortOrder: z.number().int().optional(),
};

export const createAchievementSchema = z.object({ code: z.string(), ...achievementFields }).strict();
export const updateAchievementSchema = z.object(achievementFields).partial().strict();

export const setBirthdaySchema = z.object({ birthDate: z.string() }).strict();
