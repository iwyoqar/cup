import { z } from 'zod';
import { CANDIDATE_TYPES } from './growth-intelligence.types';

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');
const boundaries = z.array(z.number().int()).length(4);

// Shape validation only; ranges and the ordering rules are validated on the FULL resulting settings in GrowthSettingsService.update.
// .strict(): an unknown key is a 400, never silently ignored.
export const updateGrowthSettingsSchema = z
  .object({
    lookbackDays: z.number().int().optional(),
    recencyDaysBoundaries: boundaries.optional(),
    frequencyBoundaries: boundaries.optional(),
    monetaryBoundaries: boundaries.optional(),
    newDays: z.number().int().optional(),
    activeDays: z.number().int().optional(),
    dormantDays: z.number().int().optional(),
    churnDays: z.number().int().optional(),
    loyalMinPurchases: z.number().int().optional(),
    loyalMinRevenue: z.number().int().optional(),
    highValueRevenue: z.number().int().optional(),
    risingDays: z.number().int().optional(),
    secondPurchaseDueDays: z.number().int().optional(),
    signalWindowDays: z.number().int().optional(),
    birthdayLookaheadDays: z.number().int().optional(),
    upgradeProximityPercent: z.number().int().optional(),
  })
  .strict();

// period: 7 | 30 | 90 | 365 | custom (custom needs from + to). Omitted = the configured default lookback.
export const overviewQuerySchema = z
  .object({
    period: z.enum(['7', '30', '90', '365', 'custom']).optional(),
    from: dateOnly.optional(),
    to: dateOnly.optional(),
    branchId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
  })
  .strict()
  .refine((q) => (q.period === 'custom' ? Boolean(q.from && q.to) : !q.from && !q.to), { message: 'from and to are used only with period=custom, and are required there.' });

export const candidatesQuerySchema = z
  .object({
    type: z.enum(CANDIDATE_TYPES),
    cursor: z.string().max(200).optional(),
    limit: z.string().regex(/^\d{1,3}$/).optional(),
  })
  .strict();
