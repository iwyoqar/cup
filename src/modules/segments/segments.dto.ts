import { z } from 'zod';
import { SEGMENT_FIELDS, SEGMENT_OPERATORS } from './segment-condition-allowlist';

// Deliberately the only accepted shape — zod's default "strip unknown keys" behavior means any
// extra field is silently dropped before it reaches SegmentsService. `value` accepts a string
// or number from the client and is normalized to a string for storage (SegmentCondition.value
// is always text — see schema.prisma's comment on why).
export const segmentConditionSchema = z.object({
  field: z.enum(SEGMENT_FIELDS),
  operator: z.enum(SEGMENT_OPERATORS),
  value: z.union([z.string(), z.number()]).transform(String),
});

export const createSegmentSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional(),
  logic: z.enum(['AND', 'OR']),
  conditions: z.array(segmentConditionSchema).min(1),
  isActive: z.boolean().optional(),
});

export const updateSegmentSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  logic: z.enum(['AND', 'OR']).optional(),
  conditions: z.array(segmentConditionSchema).min(1).optional(),
  isActive: z.boolean().optional(),
});

export type CreateSegmentInput = z.infer<typeof createSegmentSchema>;
export type UpdateSegmentInput = z.infer<typeof updateSegmentSchema>;
