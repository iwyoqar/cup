import { GrowthField, isGrowthField } from '../growth-intelligence/growth-intelligence.types';
import { SEGMENT_FIELD_DEFINITIONS, SegmentField, SegmentOperator } from './segment-condition-allowlist';

export interface SegmentConditionInput {
  field: SegmentField;
  operator: SegmentOperator;
  value: string;
}

// What a customer's data looks like once assembled for evaluation — merged from
// CustomerMetricsService's bulk order metrics/favoriteBranch and LoyaltyService's bulk account
// snapshot. Pure data, no Prisma types leak in here.
// Phase 15: the growth fields (all null when the customer has no qualifying purchase — a condition on null never matches) and the derived signal types.
export type GrowthSegmentMetrics = Partial<Record<Exclude<GrowthField, 'growthSignal'>, number | string | null>> & { growthSignals?: string[] | null };

export interface CustomerSegmentMetrics {
  growth?: GrowthSegmentMetrics;
  orderCount: number;
  totalSpentMinor: number;
  averageOrderMinor: number;
  firstOrderAt: Date | null;
  lastOrderAt: Date | null;
  favoriteBranch: string | null;
  loyaltyBalance: number;
  loyaltyLifetimeEarned: number;
  loyaltyLifetimeSpent: number;
}

// Null-handling rule (spec: "Null/date-specific handling may be needed for customers who have
// never ordered"): a condition against a null metric value (a customer who has never ordered,
// so firstOrderAt/lastOrderAt/favoriteBranch are null) ALWAYS evaluates to false, regardless of
// operator — including not_equals. "We have no data" is never treated as satisfying a
// condition, even one that superficially reads as "different from X".
export function evaluateCondition(condition: SegmentConditionInput, metrics: CustomerSegmentMetrics): boolean {
  const fieldDef = SEGMENT_FIELD_DEFINITIONS[condition.field];
  if (condition.field === 'growthSignal') {
    // Multi-valued: equals = the customer currently has that signal, not_equals = they do not. No signal data requested/available -> never matches.
    const signals = metrics.growth?.growthSignals;
    if (!signals) return false;
    const has = signals.includes(condition.value);
    return condition.operator === 'equals' ? has : condition.operator === 'not_equals' ? !has : false;
  }
  const actual: number | string | Date | null = isGrowthField(condition.field)
    ? (metrics.growth?.[condition.field as Exclude<GrowthField, 'growthSignal'>] ?? null)
    : (metrics as unknown as Record<string, number | string | Date | null>)[condition.field];

  if (actual === null) {
    return false;
  }

  switch (fieldDef.valueType) {
    case 'number':
      return evaluateNumber(condition.operator, actual as number, Number(condition.value));
    case 'date':
      return evaluateDate(condition.operator, (actual as Date).getTime(), new Date(condition.value).getTime());
    case 'string':
      return evaluateString(condition.operator, actual as string, condition.value);
  }
}

function evaluateNumber(operator: SegmentOperator, actual: number, expected: number): boolean {
  switch (operator) {
    case 'equals':
      return actual === expected;
    case 'not_equals':
      return actual !== expected;
    case 'greater_than':
      return actual > expected;
    case 'greater_than_or_equal':
      return actual >= expected;
    case 'less_than':
      return actual < expected;
    case 'less_than_or_equal':
      return actual <= expected;
    default:
      // Structurally unreachable: field/operator compatibility is validated before a condition
      // is ever persisted (see segments.service.ts) — never guessed at here.
      return false;
  }
}

function evaluateDate(operator: SegmentOperator, actualMs: number, expectedMs: number): boolean {
  switch (operator) {
    case 'before':
      return actualMs < expectedMs;
    case 'before_or_equal':
      return actualMs <= expectedMs;
    case 'after':
      return actualMs > expectedMs;
    case 'after_or_equal':
      return actualMs >= expectedMs;
    default:
      return false;
  }
}

function evaluateString(operator: SegmentOperator, actual: string, expected: string): boolean {
  switch (operator) {
    case 'equals':
      return actual === expected;
    case 'not_equals':
      return actual !== expected;
    default:
      return false;
  }
}

// A segment with zero conditions never matches anyone — defensive; the service layer already
// requires at least one condition to save a segment at all.
export function evaluateSegment(
  logic: 'AND' | 'OR',
  conditions: SegmentConditionInput[],
  metrics: CustomerSegmentMetrics,
): boolean {
  if (conditions.length === 0) {
    return false;
  }
  return logic === 'AND'
    ? conditions.every((condition) => evaluateCondition(condition, metrics))
    : conditions.some((condition) => evaluateCondition(condition, metrics));
}
