import { z } from 'zod';
import { PLAN_LIMITS } from './subscription-rules';

const int = (b: { min: number; max: number }) => z.number().int().min(b.min).max(b.max);

export const planCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    description: z.string().trim().max(300).nullable().optional(),
    priceMinor: int(PLAN_LIMITS.priceMinor),
    durationDays: int(PLAN_LIMITS.durationDays),
    totalPortions: int(PLAN_LIMITS.totalPortions),
    dailyPortionLimit: int(PLAN_LIMITS.dailyPortionLimit),
    cooldownMinutes: int(PLAN_LIMITS.cooldownMinutes),
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(1000).optional(),
    // Coffee Subscription — real Poster order purchase. Nullable so an update can explicitly clear a mapping (unmap), not just set one.
    productId: z.string().min(1).max(64).nullable().optional(),
  })
  .strict();

export const planUpdateSchema = planCreateSchema.partial().strict();

export const mappingCreateSchema = z
  .object({
    productId: z.string().min(1).max(64),
    portionCost: int(PLAN_LIMITS.portionCost),
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(1000).optional(),
  })
  .strict();

export const mappingUpdateSchema = z
  .object({ portionCost: int(PLAN_LIMITS.portionCost).optional(), isActive: z.boolean().optional(), sortOrder: z.number().int().min(0).max(1000).optional() })
  .strict();

export const purchaseSchema = z.object({ planId: z.string().min(1).max(64) }).strict();
export const adminPurchaseSchema = z.object({ customerId: z.string().min(1).max(64), planId: z.string().min(1).max(64) }).strict();
export const manualActivationSchema = z.object({ note: z.string().trim().min(3).max(300) }).strict();
export const cancelSchema = z.object({ reason: z.string().trim().min(3).max(200) }).strict();
export const resolveRedemptionSchema = z.object({ outcome: z.enum(['CONFIRMED', 'FAILED']), note: z.string().trim().min(3).max(300) }).strict();

export const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,128}$/;
