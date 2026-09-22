import { ConflictException, NotFoundException } from '@nestjs/common';
import { PromotionEligibilityReason } from './promotion-benefit-allowlist';

// Thin, explicit domain errors over Nest's HttpException — same pattern as
// src/modules/campaigns/campaigns.errors.ts / src/modules/cart/cart.errors.ts.

export class PromotionNotFoundError extends NotFoundException {
  constructor() {
    super('Promotion not found.');
  }
}

// A promotion with at least one redemption has its benefit-defining fields locked (spec: "Do
// NOT silently rewrite history") — name/description/segment/dates/usage limit/active state
// remain editable regardless.
export class PromotionBenefitLockedError extends ConflictException {
  constructor() {
    super('This promotion has existing redemptions — its benefit type/value/product/quantity can no longer be changed.');
  }
}

// Carries the machine-readable reason so a future caller (e.g. checkout integration) can act on
// it without re-deriving eligibility itself.
export class PromotionNotEligibleError extends ConflictException {
  constructor(public readonly reason: PromotionEligibilityReason) {
    super(`Promotion is not eligible for this customer: ${reason}`);
  }
}

// Only reachable after exhausting the bounded claim-retry loop in PromotionRedemptionService —
// expected to be effectively unreachable in practice (it would require sustained, repeated
// concurrent redemption attempts for the exact same customer+promotion).
export class PromotionRedemptionRaceError extends ConflictException {
  constructor() {
    super('Could not safely record this redemption due to repeated concurrent attempts. Please try again.');
  }
}
