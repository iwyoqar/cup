// Phase 13 — CRM automation domain vocabulary. Everything is a validated string allowlist (the project avoids Prisma enums).

export const AUTOMATION_STATUSES = ['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED'] as const;
export type AutomationStatus = (typeof AUTOMATION_STATUSES)[number];

export const TRIGGER_TYPES = ['FIRST_PURCHASE', 'REWARD_UNLOCKED', 'BIRTHDAY', 'INACTIVE_CUSTOMER', 'ABANDONED_CART', 'LOYALTY_MILESTONE', 'SCHEDULED_SEGMENT'] as const;
export type TriggerType = (typeof TRIGGER_TYPES)[number];

export function isTriggerType(value: string): value is TriggerType {
  return (TRIGGER_TYPES as readonly string[]).includes(value);
}
export function isAutomationStatus(value: string): value is AutomationStatus {
  return (AUTOMATION_STATUSES as readonly string[]).includes(value);
}

export const TRIGGER_LABELS: Record<TriggerType, { label: string; description: string }> = {
  FIRST_PURCHASE: { label: 'First purchase', description: "The customer's first qualifying purchase across CUP orders and imported POS." },
  REWARD_UNLOCKED: { label: 'Reward unlocked', description: 'A new reward credit of a chosen reward program is earned.' },
  BIRTHDAY: { label: 'Birthday', description: "The customer's birthday (or N days before it) in business time." },
  INACTIVE_CUSTOMER: { label: 'Inactive customer', description: 'No qualifying purchase for N days (win-back).' },
  ABANDONED_CART: { label: 'Abandoned cart', description: 'A cart with items left untouched for the configured delay.' },
  LOYALTY_MILESTONE: { label: 'Loyalty milestone', description: 'A customer metric crosses a configured threshold.' },
  SCHEDULED_SEGMENT: { label: 'Scheduled segment', description: 'On a schedule, message the current members of a segment.' },
};

// Execution statuses: PENDING (decided, waiting), SENT / FAILED (a send was ATTEMPTED — Telegram only ever confirms acceptance, there is no
// "delivered" state), SKIPPED (with a reason).
export const EXECUTION_STATUSES = ['PENDING', 'SENT', 'FAILED', 'SKIPPED'] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

export const SKIP_REASONS = [
  'NO_TELEGRAM_ACCOUNT',
  'COOLDOWN',
  'FREQUENCY_LIMIT',
  'DAILY_LIMIT',
  'SEGMENT_MISMATCH',
  'AUTOMATION_DISABLED',
  'INVALID_TRIGGER',
  'CAMPAIGN_NOT_READY',
  'CONDITION_NO_LONGER_MET',
  'EXPIRED',
] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

// The lightweight internal customer-event abstraction (no bus, no queue): typed events DERIVED from canonical tables by the
// AutomationEventsService and consumed by the trigger evaluators in the same process.
export const CUSTOMER_EVENT_TYPES = ['CUSTOMER_REGISTERED', 'PURCHASE_COMPLETED', 'REWARD_UNLOCKED', 'LOYALTY_MILESTONE_REACHED', 'BIRTHDAY_REACHED', 'CART_ABANDONED'] as const;
export type CustomerEventType = (typeof CUSTOMER_EVENT_TYPES)[number];

export interface CustomerEvent {
  type: CustomerEventType;
  customerId: string;
  // Canonical source identity — CUP: Order.id, POS: the Poster transaction id — never amount/time/customer.
  sourceKey: string;
  at: Date;
}

// A trigger evaluator's output: a customer + the deterministic idempotency key of this occurrence.
export interface TriggerCandidate {
  customerId: string;
  triggerKey: string;
  notBeforeAt: Date | null;
}
