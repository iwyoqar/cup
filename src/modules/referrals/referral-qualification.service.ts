import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Loyalty2Repository } from '../loyalty2/loyalty2.repository';
import { decideReferral, purchaseKey } from './referral-rules';
import { ReferralRewardService } from './referral-reward.service';
import { ReferralSettingsService } from './referral-settings.service';
import { ReferralsRepository } from './referrals.repository';

export interface QualificationSummary {
  status: 'DISABLED' | 'RAN';
  examined: number;
  qualified: number;
  closed: number; // rejected / invalid / expired
  kept: number;
  rewardsGranted: number;
  reconciled: number;
}

const EMPTY: QualificationSummary = { status: 'RAN', examined: 0, qualified: 0, closed: 0, kept: 0, rewardsGranted: 0, reconciled: 0 };
const DAY_MS = 86_400_000;

// Phase 14 — qualification. A referral becomes QUALIFIED when the friend's first qualifying purchase (CUP order OR imported POS purchase — the ONE
// canonical definition also used by Loyalty 2.0, Analytics and Customer 360) meets the configured rules (see referral-rules.ts). Purchases are read
// from CUP's own tables; Poster is never called and nothing is imported here. The transition itself is a compare-and-set on the referral row, so two
// workers evaluating the same referral produce exactly one QUALIFIED transition; rewards are then decided by the idempotent ReferralRewardService.
//
// Work is bounded: one batch of at most `batch` referrals per tick, chosen least-recently-checked first, with the friends' purchases fetched in two
// bulk queries — no query per referral and no scan of all customers or all referrals.
@Injectable()
export class ReferralQualificationService {
  private readonly logger = new Logger(ReferralQualificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: ReferralsRepository,
    private readonly settings: ReferralSettingsService,
    private readonly purchases: Loyalty2Repository,
    private readonly rewards: ReferralRewardService,
  ) {}

  async qualifyBatch(now: Date, batch: number): Promise<QualificationSummary> {
    const settings = await this.settings.get();
    if (!settings.enabled) return { ...EMPTY, status: 'DISABLED' };

    const summary: QualificationSummary = { ...EMPTY };
    const cutoff = settings.attributionWindowDays > 0 ? now.getTime() - settings.attributionWindowDays * DAY_MS : null;
    const ids = await this.repository.pendingCandidateIds(cutoff, batch);
    if (ids.length > 0) {
      const referrals = await this.repository.findByIds(ids);
      const purchasesByCustomer = await this.purchases.qualifyingPurchasesForCustomers(referrals.map((r) => r.referredCustomerId));
      const kept: string[] = [];
      const justQualified: string[] = [];

      for (const referral of referrals) {
        summary.examined += 1;
        const decision = decideReferral(referral, purchasesByCustomer.get(referral.referredCustomerId) ?? [], settings, now);
        if (decision.kind === 'QUALIFY') {
          const won = await this.repository.casQualify(this.prisma, referral.id, { qualifiedAt: now, purchaseKey: purchaseKey(decision.purchase), amountMinor: decision.purchase.amountMinor });
          if (won) {
            summary.qualified += 1;
            justQualified.push(referral.id);
            this.logger.log(`Referral ${referral.id} qualified source=${decision.purchase.sourceType}`);
          }
        } else if (decision.kind === 'CLOSE') {
          if (await this.repository.casClose(this.prisma, referral.id, decision.status, decision.reason, now)) {
            summary.closed += 1;
            this.logger.log(`Referral ${referral.id} closed status=${decision.status} reason=${decision.reason}`);
          }
        } else {
          summary.kept += 1;
          kept.push(referral.id);
        }
      }
      await this.repository.touchChecked(kept, now);

      for (const id of justQualified) summary.rewardsGranted += (await this.rewards.grantRewards(id, now)).granted;
    }

    // Reconcile: a QUALIFIED referral that lost its reward step (crash, contention) is finished here. Idempotent — a fully decided referral is skipped.
    for (const id of await this.repository.qualifiedWithoutFullRewards(batch)) {
      const result = await this.rewards.grantRewards(id, now);
      if (result.granted + result.skipped > 0) summary.reconciled += 1;
      summary.rewardsGranted += result.granted;
    }
    return summary;
  }
}
