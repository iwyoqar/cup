import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

// Thin, explicit domain errors over Nest's HttpException — same pattern as
// src/modules/orders/orders.errors.ts. Messages are customer-safe; no Prisma/internal detail.

export class ProductNotFoundError extends NotFoundException {
  constructor() {
    super('Product not found.');
  }
}

// Symmetric with BranchInactiveError below: an inactive product is an entity-state conflict,
// not malformed input, so 409 rather than 400 — matching this phase's own categorization of
// "inactive branch" as a 409.
export class ProductInactiveError extends ConflictException {
  constructor() {
    super('This product is not currently available.');
  }
}

export class BranchNotFoundError extends NotFoundException {
  constructor() {
    super('Branch not found.');
  }
}

export class BranchInactiveError extends ConflictException {
  constructor() {
    super('This branch is not currently active.');
  }
}

export class CartBranchChangeBlockedError extends ConflictException {
  constructor() {
    super('Cannot change branch while the cart contains items from another branch. Clear the cart first.');
  }
}

export class CartHasNoBranchError extends ConflictException {
  constructor() {
    super('Select a branch before adding items to the cart.');
  }
}

export class CartItemNotFoundError extends NotFoundException {
  constructor() {
    super('Cart item not found.');
  }
}

// Phase 1.5 checkout errors.

export class EmptyCartError extends ConflictException {
  constructor() {
    super('Your cart is empty.');
  }
}

// Phase 8.1: Poster's documented incoming-order API gives no verified way to represent a
// zero-total order (the docs are silent on it, and the response never echoes price), so an
// order made ONLY of a free reward line is rejected rather than created as "free" in CUP while
// Poster may charge the normal price. Thrown before the checkout lock and before Poster.
export class RewardOnlyOrderNotAllowedError extends ConflictException {
  constructor() {
    super('Reward-only orders are currently unavailable. Add at least one paid item.');
  }
}

// Phase 8.1 hard production gate (REWARD_CHECKOUT_ENABLED, default off) — see env.schema.ts.
export class RewardCheckoutUnavailableError extends ConflictException {
  constructor() {
    super('Free rewards cannot be redeemed at checkout right now.');
  }
}

export class CartExpiredError extends ConflictException {
  constructor() {
    super('Your cart has expired. Please review your items and try again.');
  }
}

// The DB-backed checkout lock (Cart.checkoutLockedAt) is what this maps to — see
// cart.repository.ts / cart.service.ts. Distinct from Phase 0's IdempotencyKeyInProgressError:
// this one guards two DIFFERENT Idempotency-Keys racing on the same cart, which the per-key
// idempotency mechanism alone cannot catch.
export class CheckoutAlreadyInProgressError extends ConflictException {
  constructor() {
    super('A checkout is already in progress for this cart.');
  }
}

export class MissingIdempotencyKeyError extends BadRequestException {
  constructor() {
    super('Idempotency-Key header is required.');
  }
}

// Distinct from CheckoutAlreadyInProgressError: that one means "wait, something is actively
// happening." This one means a PREVIOUS checkout attempt against this cart ended in an
// unresolved (uncertain / stuck in_progress) state — CUP cannot confirm whether Poster
// already created an order from these contents, so no further checkout attempt against this
// cart, even under a brand-new Idempotency-Key, may proceed automatically. This is the fix
// for the exact gap analyzed after Phase 1.5's initial checkpoint: a time-only lock self-heal
// would otherwise let a new key silently authorize a second real Poster order. Requires
// manual reconciliation, matching Phase 0's existing "uncertain" philosophy.
export class CheckoutRequiresManualReconciliationError extends ConflictException {
  constructor() {
    super(
      'A previous checkout attempt for this cart had an uncertain outcome with Poster and was ' +
        'not resolved. This cart cannot be checked out again until that is manually reconciled.',
    );
  }
}
