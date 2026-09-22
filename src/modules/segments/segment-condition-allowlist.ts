// Phase 5: the explicit allowlist a segment condition's field/operator/value must pass before
// it is ever persisted or evaluated. Never arbitrary SQL, never arbitrary Prisma filters from
// the frontend, never user-provided code — every condition is validated against exactly this
// list. Unknown field -> 400. Unknown operator -> 400. Field/operator mismatch -> 400.

import { GROWTH_FIELDS, GROWTH_NUMERIC_FIELDS, GrowthField } from '../growth-intelligence/growth-intelligence.types';

export const SEGMENT_FIELDS = [
  'orderCount',
  'totalSpentMinor',
  'averageOrderMinor',
  'firstOrderAt',
  'lastOrderAt',
  'loyaltyBalance',
  'loyaltyLifetimeEarned',
  'loyaltyLifetimeSpent',
  'favoriteBranch',
  // Phase 15 — Growth Intelligence (RFM / lifecycle / signals): unified CUP + POS, all branches, the configured default lookback.
  ...GROWTH_FIELDS,
] as const;
export type SegmentField = (typeof SEGMENT_FIELDS)[number];

export const SEGMENT_OPERATORS = [
  'equals',
  'not_equals',
  'greater_than',
  'greater_than_or_equal',
  'less_than',
  'less_than_or_equal',
  'before',
  'before_or_equal',
  'after',
  'after_or_equal',
] as const;
export type SegmentOperator = (typeof SEGMENT_OPERATORS)[number];

export type SegmentFieldValueType = 'number' | 'date' | 'string';

const NUMERIC_OPERATORS: readonly SegmentOperator[] = [
  'equals',
  'not_equals',
  'greater_than',
  'greater_than_or_equal',
  'less_than',
  'less_than_or_equal',
];
const DATE_OPERATORS: readonly SegmentOperator[] = ['before', 'before_or_equal', 'after', 'after_or_equal'];
const STRING_OPERATORS: readonly SegmentOperator[] = ['equals', 'not_equals'];

interface SegmentFieldDefinition {
  valueType: SegmentFieldValueType;
  allowedOperators: readonly SegmentOperator[];
}

// Phase 5 Part "DATE CONDITIONS": kept to absolute date operators only (before/after against a
// specific date) — relative rules ("no order in last 30 days") are documented here as
// deliberately deferred, not implemented. Storing a relative rule semantically (e.g.
// {field:'lastOrderAt', operator:'older_than_days', value:30}) would need its own operator
// family evaluated against "now" at read time; that's a genuine, separable feature, not a
// trivial addition, and belongs with future campaign/automation work rather than bolted onto
// this foundation phase.
export const SEGMENT_FIELD_DEFINITIONS: Record<SegmentField, SegmentFieldDefinition> = {
  orderCount: { valueType: 'number', allowedOperators: NUMERIC_OPERATORS },
  totalSpentMinor: { valueType: 'number', allowedOperators: NUMERIC_OPERATORS },
  averageOrderMinor: { valueType: 'number', allowedOperators: NUMERIC_OPERATORS },
  firstOrderAt: { valueType: 'date', allowedOperators: DATE_OPERATORS },
  lastOrderAt: { valueType: 'date', allowedOperators: DATE_OPERATORS },
  loyaltyBalance: { valueType: 'number', allowedOperators: NUMERIC_OPERATORS },
  loyaltyLifetimeEarned: { valueType: 'number', allowedOperators: NUMERIC_OPERATORS },
  loyaltyLifetimeSpent: { valueType: 'number', allowedOperators: NUMERIC_OPERATORS },
  favoriteBranch: { valueType: 'string', allowedOperators: STRING_OPERATORS },
  // Phase 15: numeric growth fields compare numerically; lifecycleState / rfmScore ("543") / growthSignal (the customer HAS the signal for equals, does NOT
  // have it for not_equals) are strings.
  ...(Object.fromEntries(GROWTH_NUMERIC_FIELDS.map((f) => [f, { valueType: 'number', allowedOperators: NUMERIC_OPERATORS }])) as Record<(typeof GROWTH_NUMERIC_FIELDS)[number], SegmentFieldDefinition>),
  lifecycleState: { valueType: 'string', allowedOperators: STRING_OPERATORS },
  rfmScore: { valueType: 'string', allowedOperators: STRING_OPERATORS },
  growthSignal: { valueType: 'string', allowedOperators: STRING_OPERATORS },
};

export type { GrowthField };

export function isSegmentField(value: string): value is SegmentField {
  return (SEGMENT_FIELDS as readonly string[]).includes(value);
}

export function isSegmentOperator(value: string): value is SegmentOperator {
  return (SEGMENT_OPERATORS as readonly string[]).includes(value);
}
