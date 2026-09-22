import { z } from 'zod';

// Shape validation only — AutomationsService re-validates every rule (trigger config per type, campaign / segment / reward-program existence,
// limits) server-side; the backend is authoritative.
const base = {
  name: z.string(),
  description: z.string().nullable().optional(),
  triggerType: z.string(),
  triggerConfig: z.record(z.string(), z.unknown()),
  campaignId: z.string().min(1),
  segmentId: z.string().nullable().optional(),
  cooldownHours: z.number().int().optional(),
  maxSendsPerCustomer: z.number().int().nullable().optional(),
};

export const createAutomationSchema = z.object(base).strict();
export const updateAutomationSchema = z.object(base).partial().strict();

export const updateCrmSettingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    dailyLimit: z.number().int().optional(),
    quietHoursStart: z.string().optional(),
    quietHoursEnd: z.string().optional(),
    batchSize: z.number().int().optional(),
    runIntervalSeconds: z.number().int().optional(),
    defaultCooldownHours: z.number().int().optional(),
    defaultMaxSends: z.number().int().optional(),
    maxEventAgeHours: z.number().int().optional(),
  })
  .strict();
