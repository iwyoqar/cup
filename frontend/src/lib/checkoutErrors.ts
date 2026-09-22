import { ApiError } from './api/client';
import { toUserMessage } from './api/errors';

export type CheckoutOutcomeKind = 'uncertain' | 'in_progress' | 'expired' | 'failed';

export interface CheckoutOutcome {
  kind: CheckoutOutcomeKind;
  message: string;
}

// Classifies a POST /cart/checkout failure against the EXISTING backend error types (see
// cart.errors.ts / orders.errors.ts) — never invents a new state, never treats "uncertain" as
// safely retryable (spec sections 6/7/17/28). A network-level failure (no HTTP response at
// all) is treated the same as "uncertain": the frontend cannot know whether the backend ever
// received the request, so it must not offer a convenient retry with a new key.
export function classifyCheckoutOutcome(err: unknown): CheckoutOutcome {
  if (!(err instanceof ApiError) || err.status === 0) {
    return { kind: 'uncertain', message: 'Buyurtma holatini tekshirish kerak.' };
  }

  const msg = err.backendMessage.toLowerCase();

  // Matches both IdempotencyKeyUncertainError ("uncertain outcome... manual reconciliation")
  // and CheckoutRequiresManualReconciliationError ("...manually reconciled").
  if (msg.includes('uncertain outcome') || msg.includes('manually reconciled')) {
    return { kind: 'uncertain', message: 'Buyurtma holatini aniqlash kerak. Iltimos, qayta buyurtma yubormang.' };
  }

  // Matches both CheckoutAlreadyInProgressError and IdempotencyKeyInProgressError.
  if (msg.includes('already in progress')) {
    return { kind: 'in_progress', message: 'Buyurtma allaqachon yuborilmoqda. Iltimos, biroz kuting.' };
  }

  if (msg.includes('cart has expired')) {
    return { kind: 'expired', message: toUserMessage(err) };
  }

  // EmptyCartError, CartHasNoBranchError, BranchInactiveError, ProductInactiveError,
  // IdempotencyPayloadMismatchError, OrderCreationFailedError, and anything else: Poster was
  // either never contacted or definitively rejected the request — safe to show as a plain
  // failure the customer can retry (a fresh checkout attempt gets its own new key).
  return { kind: 'failed', message: toUserMessage(err) };
}
