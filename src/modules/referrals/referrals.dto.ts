import { z } from 'zod';
import { REFERRAL_STATUSES, REWARD_TYPES } from './referral.types';

// Shape validation only; the business validation of the FULL resulting settings happens in ReferralSettingsService.update. .strict(): an unknown
// key (e.g. an attempt to write a reward amount or a status) is a 400, never silently ignored.
export const updateReferralSettingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    referrerRewardType: z.enum(REWARD_TYPES).optional(),
    referrerRewardValue: z.number().int().optional(),
    referredRewardType: z.enum(REWARD_TYPES).optional(),
    referredRewardValue: z.number().int().optional(),
    minimumPurchaseAmount: z.number().int().optional(),
    rewardOnFirstPurchaseOnly: z.boolean().optional(),
    maxSuccessfulReferrals: z.number().int().optional(),
    attributionWindowDays: z.number().int().optional(),
  })
  .strict();
export type UpdateReferralSettingsInput = z.infer<typeof updateReferralSettingsSchema>;

const isoDate = z
  .string()
  .max(40)
  .refine((v) => !Number.isNaN(new Date(v).getTime()), 'must be a valid date')
  .transform((v) => new Date(v));

export const adminListQuerySchema = z
  .object({
    status: z.enum(REFERRAL_STATUSES).optional(),
    referrer: z.string().trim().min(1).max(100).optional(),
    referred: z.string().trim().min(1).max(100).optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    cursor: z.string().regex(/^[A-Za-z0-9]{1,64}$/).optional(),
    limit: z.string().optional(),
  })
  .strict();
