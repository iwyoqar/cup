import { z } from 'zod';

// Partial by design — PATCH semantics, only the fields actually present are updated (see
// LoyaltySettingsService.update). zod's default "strip unknown keys" behavior means any extra
// field is silently dropped before it reaches the service.
export const updateLoyaltySettingsSchema = z.object({
  enabled: z.boolean().optional(),
  earnRate: z.number().int().nonnegative().optional(),
  earnUnitAmount: z.number().int().nonnegative().optional(),
  minimumOrderAmount: z.number().int().nonnegative().optional(),
  welcomeBonus: z.number().int().nonnegative().optional(),
  pointsExpireAfterDays: z.number().int().nonnegative().optional(),
  spendEnabled: z.boolean().optional(),
  pointValue: z.number().int().nonnegative().optional(),
});

export type UpdateLoyaltySettingsInput = z.infer<typeof updateLoyaltySettingsSchema>;
