import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { TriggerType } from './automation.types';

// Strictly validated trigger configuration, one schema per trigger. Nothing is a free-form blob: every schema is .strict() (unknown keys are
// rejected), durations are bounded positive integers, thresholds are bounded. The parsed, normalised object is what is stored.
const MINUTES_PER_WEEK = 7 * 24 * 60;

export const triggerConfigSchemas = {
  FIRST_PURCHASE: z.object({ delayMinutes: z.number().int().min(0).max(MINUTES_PER_WEEK) }).strict(),
  REWARD_UNLOCKED: z.object({ rewardProgramId: z.string().min(1).max(64) }).strict(),
  BIRTHDAY: z.object({ daysBefore: z.number().int().min(0).max(30) }).strict(),
  INACTIVE_CUSTOMER: z.object({ inactiveDays: z.number().int().min(1).max(730), includeExisting: z.boolean().default(false) }).strict(),
  ABANDONED_CART: z.object({ delayMinutes: z.number().int().min(1).max(MINUTES_PER_WEEK) }).strict(),
  LOYALTY_MILESTONE: z
    .object({
      metric: z.enum(['lifetimeSpend', 'lifetimeXP', 'lifetimeCoffeeQuantity', 'rewardCount']),
      threshold: z.number().int().min(1).max(1_000_000_000_000),
      // Only for lifetimeCoffeeQuantity: WHICH category counts (chosen in Admin, never hardcoded).
      categoryId: z.string().min(1).max(64).optional(),
    })
    .strict(),
  SCHEDULED_SEGMENT: z
    .object({
      frequency: z.enum(['DAILY', 'WEEKLY']),
      weekday: z.number().int().min(0).max(6).optional(), // 0 = Sunday
      time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time must be HH:MM'),
    })
    .strict(),
} as const;

export type TriggerConfigs = { [K in TriggerType]: z.infer<(typeof triggerConfigSchemas)[K]> };
export type AnyTriggerConfig = TriggerConfigs[TriggerType];

// Throws BadRequestException with a precise message; returns the normalised config.
export function validateTriggerConfig<T extends TriggerType>(type: T, raw: unknown): TriggerConfigs[T] {
  const parsed = triggerConfigSchemas[type].safeParse(raw);
  if (!parsed.success) {
    throw new BadRequestException(`Invalid ${type} configuration: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'config'}: ${i.message}`).join('; ')}`);
  }
  const value = parsed.data as TriggerConfigs[T];
  if (type === 'LOYALTY_MILESTONE') {
    const v = value as TriggerConfigs['LOYALTY_MILESTONE'];
    if (v.metric === 'lifetimeCoffeeQuantity' && !v.categoryId) throw new BadRequestException('LOYALTY_MILESTONE with lifetimeCoffeeQuantity needs a categoryId.');
    if (v.metric !== 'lifetimeCoffeeQuantity' && v.categoryId) throw new BadRequestException('categoryId is only valid for lifetimeCoffeeQuantity.');
  }
  if (type === 'SCHEDULED_SEGMENT') {
    const v = value as TriggerConfigs['SCHEDULED_SEGMENT'];
    if (v.frequency === 'WEEKLY' && v.weekday === undefined) throw new BadRequestException('A WEEKLY schedule needs a weekday (0 = Sunday .. 6 = Saturday).');
    if (v.frequency === 'DAILY' && v.weekday !== undefined) throw new BadRequestException('A DAILY schedule has no weekday.');
  }
  return value;
}

// Re-parse of a STORED config (defence in depth: a corrupt/legacy row must degrade to INVALID_TRIGGER, never crash the runner).
export function parseStoredConfig<T extends TriggerType>(type: T, stored: string): TriggerConfigs[T] | null {
  try {
    return validateTriggerConfig(type, JSON.parse(stored));
  } catch {
    return null;
  }
}

// --- message variables: a strict allowlist, no template language, no code --------------------------------------------------

export const MESSAGE_VARIABLES = ['firstName', 'displayName', 'points', 'rewardCount', 'rewardProgress', 'level', 'branchName'] as const;
export type MessageVariable = (typeof MESSAGE_VARIABLES)[number];

const VARIABLE_PATTERN = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

export function findVariables(text: string): string[] {
  return [...text.matchAll(VARIABLE_PATTERN)].map((m) => m[1]);
}

export function unknownVariables(text: string): string[] {
  return [...new Set(findVariables(text).filter((v) => !(MESSAGE_VARIABLES as readonly string[]).includes(v)))];
}

// Replaces ONLY allowlisted variables from `values`; an unknown variable is left exactly as written (visibly unresolved). Nothing is evaluated.
export function renderVariables(text: string, values: Partial<Record<MessageVariable, string>>): string {
  return text.replace(VARIABLE_PATTERN, (whole, name: string) => ((MESSAGE_VARIABLES as readonly string[]).includes(name) && values[name as MessageVariable] !== undefined ? (values[name as MessageVariable] as string) : whole));
}
