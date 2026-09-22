export const IDEMPOTENCY_STATUSES = ['in_progress', 'completed', 'failed', 'uncertain'] as const;

export type IdempotencyStatus = (typeof IDEMPOTENCY_STATUSES)[number];
