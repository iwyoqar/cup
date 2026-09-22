import { z } from 'zod';
import { PROMOTION_BENEFIT_TYPES } from './promotion-benefit-allowlist';

// Shape-only validation — which of benefitValue/benefitProductId/benefitQuantity are actually
// REQUIRED (and their allowed ranges) depends on benefitType, so every benefit field is
// optional here; promotions.service.ts's validateBenefit() enforces the real per-type rules
// (including the DB-dependent product existence/active check this schema can't express),
// exactly mirroring how SegmentsService.validateConditions owns segment condition validation
// beyond what segments.dto.ts's zod schema alone can check.
const benefitFields = {
  benefitType: z.enum(PROMOTION_BENEFIT_TYPES),
  benefitValue: z.number().int().optional(),
  benefitProductId: z.string().min(1).optional(),
  benefitQuantity: z.number().int().optional(),
};

// startsAt/endsAt arrive as ISO date strings (matching the Admin UI's <input type="datetime-local">
// converted to ISO before sending) — parsed and cross-validated (endsAt > startsAt) in
// promotions.service.ts, same "DTO checks shape, service checks business rules" split used for
// segment condition values (Number.isNaN(new Date(...).getTime()) there).
export const createPromotionSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(500).optional(),
    segmentId: z.string().min(1).nullable().optional(),
    startsAt: z.string().min(1),
    endsAt: z.string().min(1).nullable().optional(),
    usageLimitPerCustomer: z.number().int().positive().nullable().optional(),
    isActive: z.boolean().optional(),
    ...benefitFields,
  })
  .strict();

export const updatePromotionSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    segmentId: z.string().min(1).nullable().optional(),
    startsAt: z.string().min(1).optional(),
    endsAt: z.string().min(1).nullable().optional(),
    usageLimitPerCustomer: z.number().int().positive().nullable().optional(),
    isActive: z.boolean().optional(),
    benefitType: z.enum(PROMOTION_BENEFIT_TYPES).optional(),
    benefitValue: z.number().int().nullable().optional(),
    benefitProductId: z.string().min(1).nullable().optional(),
    benefitQuantity: z.number().int().nullable().optional(),
  })
  .strict();

export type CreatePromotionInput = z.infer<typeof createPromotionSchema>;
export type UpdatePromotionInput = z.infer<typeof updatePromotionSchema>;
