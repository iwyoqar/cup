import { ConflictException, NotFoundException } from '@nestjs/common';

// Thin, explicit domain errors over Nest's HttpException — same pattern as
// src/modules/cart/cart.errors.ts / src/modules/admin-auth/admin-auth.errors.ts.

export class CampaignNotFoundError extends NotFoundException {
  constructor() {
    super('Campaign not found.');
  }
}

export class CampaignNotEditableError extends ConflictException {
  constructor() {
    super('Only draft campaigns can be edited.');
  }
}

export class CampaignNotDeletableError extends ConflictException {
  constructor() {
    super('Only draft campaigns can be deleted.');
  }
}

// Covers both the common case (campaign is already 'sending'/'completed'/'failed' when the
// admin clicks Send) and the true race case (two concurrent send requests) — the atomic
// draft->sending claim in campaigns.repository.ts is what actually decides which request wins;
// this error is thrown whenever a caller's claim attempt did not win.
export class CampaignAlreadySendingError extends ConflictException {
  constructor() {
    super('This campaign is already sending or has already been sent.');
  }
}
