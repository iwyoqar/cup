import { z } from 'zod';
import { REWARD_PROGRAM_TYPES } from './reward-program-allowlist';

// startsAt/endsAt arrive as ISO date strings, same convention as promotions.dto.ts — parsed and
// cross-validated (endsAt > startsAt) in reward-programs.service.ts.
export const createRewardProgramSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(500).optional(),
    type: z.enum(REWARD_PROGRAM_TYPES),
    qualifyingCategoryId: z.string().min(1),
    buyQuantity: z.number().int().positive(),
    rewardQuantity: z.number().int().positive(),
    startsAt: z.string().min(1),
    endsAt: z.string().min(1).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export const updateRewardProgramSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    qualifyingCategoryId: z.string().min(1).optional(),
    buyQuantity: z.number().int().positive().optional(),
    rewardQuantity: z.number().int().positive().optional(),
    startsAt: z.string().min(1).optional(),
    endsAt: z.string().min(1).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export type CreateRewardProgramInput = z.infer<typeof createRewardProgramSchema>;
export type UpdateRewardProgramInput = z.infer<typeof updateRewardProgramSchema>;
