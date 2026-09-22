import { BadGatewayException, ConflictException, UnprocessableEntityException } from '@nestjs/common';

// Thin, explicit domain errors over Nest's HttpException so each idempotency/Poster outcome
// documented in docs/PHASE-0-PLAN.md maps to one obvious, distinguishable HTTP response
// without a generic exception-filter framework.

export class IdempotencyKeyInProgressError extends ConflictException {
  constructor() {
    super('A request with this Idempotency-Key is already in progress.');
  }
}

// Deliberately NOT auto-retried by the server. See docs/PHASE-0-PLAN.md section 8:
// an ambiguous Poster outcome must never be silently retried, or a duplicate order can
// be created. This is surfaced to the caller as a conflict requiring manual reconciliation.
export class IdempotencyKeyUncertainError extends ConflictException {
  constructor(reason: string) {
    super(
      `A previous request with this Idempotency-Key had an uncertain outcome with Poster ` +
        `(CUP cannot confirm whether an order was created) and was not retried automatically. ` +
        `Manual reconciliation against Poster is required before reusing this key. Detail: ${reason}`,
    );
  }
}

export class IdempotencyPayloadMismatchError extends UnprocessableEntityException {
  constructor() {
    super('This Idempotency-Key was already used with a different request payload.');
  }
}

export class OrderCreationFailedError extends BadGatewayException {
  constructor(reason: string) {
    super(`Poster rejected order creation: ${reason}`);
  }
}
