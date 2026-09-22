// Stored as a plain String column (not a Prisma enum) — same portability rule as
// order-status.ts and idempotency-status.ts (the sqlite connector doesn't support Prisma
// enums). EXPIRATION and ADJUSTMENT have no code path creating them yet in Phase 3 — declared
// for the ledger's own extensibility (Part 6/7), same pattern as OrderStatus's provisional
// values.
export const LOYALTY_TRANSACTION_TYPES = ['EARN', 'SPEND', 'WELCOME_BONUS', 'ADJUSTMENT', 'EXPIRATION'] as const;

export type LoyaltyTransactionType = (typeof LOYALTY_TRANSACTION_TYPES)[number];
