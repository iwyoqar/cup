import { Injectable } from '@nestjs/common';
import { RewardProgressRepository } from './reward-progress.repository';
import { RewardRedemptionsRepository } from './reward-redemptions.repository';
import { RewardProgramRecord, RewardProgress } from './reward-program.types';

// The ONE place reward progress is computed — no cached "progress" field anywhere (spec's
// explicit instruction). Both qualifyingCount and availableRewards are pure functions of two
// bounded numbers: total qualifying units ever purchased (RewardProgressRepository — since Phase
// 11.3 the SUM of qualifying CUP order items and qualifying imported Poster POS items, two
// local aggregate queries, one purchase history and one balance) and total redemptions ever
// recorded (RewardRedemptionsRepository, one count query) — never a per-order-item loop, never
// N+1, never a Poster call. POS refunds/returns are not modelled (Poster behaviour unverified).
//
// The math (verified against every example in the spec):
//   totalEarned      = floor(totalQualifying / buyQuantity)
//   availableRewards = max(0, totalEarned - redeemedCount)
//   qualifyingCount  = totalQualifying % buyQuantity
// A redemption never deletes or alters past OrderItem rows — "the cycle resetting" falls out
// entirely from redeemedCount increasing, with no separate reset step required. E.g. 10
// qualifying units, buyQuantity 5, 1 prior redemption -> totalEarned=2, availableRewards=1,
// qualifyingCount=0 (the two already-complete cycles are fully absorbed into
// totalEarned/availableRewards, never double-counted into qualifyingCount).
@Injectable()
export class RewardProgressService {
  constructor(
    private readonly progressRepository: RewardProgressRepository,
    private readonly redemptionsRepository: RewardRedemptionsRepository,
  ) {}

  // Phase 15: the SAME math as getProgress for MANY customers at once (grouped queries whatever the number of customers — chunked only to respect
  // the SQL variable limit). Returns the customers that currently have at least one reward available, with how many credits they earned in total.
  async getAvailableForCustomers(program: RewardProgramRecord, customerIds: string[]): Promise<Map<string, { earned: number; available: number }>> {
    const out = new Map<string, { earned: number; available: number }>();
    const CHUNK = 5000; // well under SQLite's 32 766-variable limit; more customers than this simply take one more grouped query per program
    for (let i = 0; i < customerIds.length; i += CHUNK) {
      const ids = customerIds.slice(i, i + CHUNK);
      const [qualifying, redeemed] = await Promise.all([
        this.progressRepository.sumQualifyingQuantityForCustomers(ids, program.qualifyingCategoryId),
        this.redemptionsRepository.countsForCustomers(program.id, ids),
      ]);
      for (const id of ids) {
        const earned = Math.floor((qualifying.get(id) ?? 0) / program.buyQuantity);
        const available = Math.max(0, earned - (redeemed.get(id) ?? 0));
        if (available > 0) out.set(id, { earned, available });
      }
    }
    return out;
  }

  async getProgress(program: RewardProgramRecord, customerId: string): Promise<RewardProgress> {
    const [totalQualifying, redeemedCount] = await Promise.all([
      this.progressRepository.sumQualifyingQuantity(customerId, program.qualifyingCategoryId),
      this.redemptionsRepository.countForCustomer(program.id, customerId),
    ]);
    const totalEarned = Math.floor(totalQualifying / program.buyQuantity);
    return {
      qualifyingCount: totalQualifying % program.buyQuantity,
      availableRewards: Math.max(0, totalEarned - redeemedCount),
    };
  }
}
