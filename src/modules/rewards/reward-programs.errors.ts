import { ConflictException, NotFoundException } from '@nestjs/common';
import { RewardEligibilityReason } from './reward-program.types';

// Thin, explicit domain errors over Nest's HttpException — same pattern as
// src/modules/promotions/promotions.errors.ts.

export class RewardProgramNotFoundError extends NotFoundException {
  constructor() {
    super('Reward program not found.');
  }
}

export class RewardProgramLockedError extends ConflictException {
  constructor() {
    super('This reward program has existing redemptions — its qualifying category/buy quantity/reward quantity can no longer be changed.');
  }
}

// Carries the machine-readable reason so the caller (cart selection, checkout) can act on it
// without re-deriving eligibility itself.
export class RewardNotEligibleError extends ConflictException {
  constructor(public readonly reason: RewardEligibilityReason) {
    super(`Reward is not currently applicable: ${reason}`);
  }
}
