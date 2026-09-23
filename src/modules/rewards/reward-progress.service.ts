import { Injectable } from '@nestjs/common';
import { RewardProgressRepository } from './reward-progress.repository';
import { RewardRedemptionsRepository } from './reward-redemptions.repository';
import { RewardProgramRecord, RewardProgress } from './reward-program.types';

// The ONE place reward progress is computed — no cached "progress" field anywhere (spec's
// explicit instruction). Both qualifyingCount and availableRewards are pure functions of two
// bounded numbers: total qualifying VISITS ever made (RewardProgressRepository.countQualifyingOccasions
// — since 2026-09-24, one CUP order or one imported Poster POS transaction with at least one
// qualifying line item counts as ONE, regardless of how many qualifying items or what quantity that
// visit contains; owner decision — buying 5 coffees in a single visit must not by itself complete a
// "5 visits" cycle) and total redemptions ever recorded (RewardRedemptionsRepository, one count
// query) — never a per-order-item loop, never N+1, never a Poster call. POS refunds/returns are not
// modelled (Poster behaviour unverified).
//
// The math (verified against every example in the spec):
//   totalEarned      = floor(totalQualifying / buyQuantity)
//   availableRewards = max(0, totalEarned - redeemedCount)
//   qualifyingCount  = totalQualifying % buyQuantity
// (totalQualifying here is a count of qualifying VISITS, not units — see above.) A redemption never
// deletes or alters past Order/PosterImportedTransaction rows — "the cycle resetting" falls out
// entirely from redeemedCount increasing, with no separate reset step required. E.g. 10 qualifying
// visits, buyQuantity 5, 1 prior redemption -> totalEarned=2, availableRewards=1, qualifyingCount=0
// (the two already-complete cycles are fully absorbed into totalEarned/availableRewards, never
// double-counted into qualifyingCount).
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
        this.progressRepository.countQualifyingOccasionsForCustomers(ids, program.qualifyingCategoryId),
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
    // Owner decision (2026-09-24): counts distinct qualifying VISITS (one CUP order or one imported POS
    // transaction with at least one qualifying item = 1), never the summed item quantity within a visit
    // — see countQualifyingOccasions's own comment in reward-progress.repository.ts.
    const [totalQualifying, redeemedCount] = await Promise.all([
      this.progressRepository.countQualifyingOccasions(customerId, program.qualifyingCategoryId),
      this.redemptionsRepository.countForCustomer(program.id, customerId),
    ]);
    const totalEarned = Math.floor(totalQualifying / program.buyQuantity);
    return {
      qualifyingCount: totalQualifying % program.buyQuantity,
      availableRewards: Math.max(0, totalEarned - redeemedCount),
    };
  }
}
