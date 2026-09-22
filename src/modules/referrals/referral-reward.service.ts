import { Injectable, Logger } from '@nestjs/common';
import { PrismaService, PrismaTransactionClient } from '../../common/prisma/prisma.service';
import { isUniqueConstraintViolation } from '../../common/util/prisma-errors';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { ReferralSettings, ReferralSettingsService } from './referral-settings.service';
import { RewardBeneficiary, SUPPORTED_REWARD_TYPES, SkipReason } from './referral.types';
import { ReferralsRepository } from './referrals.repository';

const ATTEMPTS = 6;
const isRetryable = (err: unknown): boolean => {
  const code = err && typeof err === 'object' ? (err as { code?: string }).code : undefined;
  const text = err instanceof Error ? err.message : '';
  return isUniqueConstraintViolation(err) || code === 'P2034' || code === 'P2028' || /locked|busy|timed out|Transaction/i.test(text);
};

export interface GrantSummary {
  status: 'DISABLED' | 'NOT_QUALIFIED' | 'DONE';
  granted: number; // rewards GRANTED by THIS call
  skipped: number; // reward decisions recorded as SKIPPED by THIS call
}

// Phase 14 — the ONE place referral rewards are decided and paid. Points go through the EXISTING LoyaltyService (creditPointsTx: the same EARN
// ledger row and balance accounting as every other earned point) — there is no parallel ledger and LoyaltyAccount.balance is never touched here.
//
// Exactly-once, enforced by the database:
//   * ReferralReward is unique on (referralId, beneficiary): a beneficiary's reward is decided once, whatever races.
//   * The claim row is inserted BEFORE the points are credited, and both happen in ONE transaction: a lost race raises a unique violation, rolls
//     back that whole transaction (credit included) and the retry finds the winner's row and does nothing.
//   * A referrer's GRANTED rewards are numbered 1..N (unique on customer + beneficiary + ordinal), which is what makes maxSuccessfulReferrals
//     race-proof even across DIFFERENT referrals of the same referrer.
// The friend's reward is never blocked by the referrer's cap (the referrer simply gets a SKIPPED row with the reason).
@Injectable()
export class ReferralRewardService {
  private readonly logger = new Logger(ReferralRewardService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: ReferralsRepository,
    private readonly settings: ReferralSettingsService,
    private readonly loyalty: LoyaltyService,
  ) {}

  // Idempotent and safe to call any number of times, from any number of workers.
  async grantRewards(referralId: string, now: Date = new Date()): Promise<GrantSummary> {
    const settings = await this.settings.get();
    if (!settings.enabled) return { status: 'DISABLED', granted: 0, skipped: 0 };

    let lastError: unknown;
    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
      try {
        const summary = await this.prisma.runTransaction((tx) => this.grantInTransaction(tx, referralId, settings, now));
        this.logger.log(`Referral ${referralId} reward result=${summary.status} granted=${summary.granted} skipped=${summary.skipped}`);
        return summary;
      } catch (err) {
        if (!isRetryable(err)) throw err;
        lastError = err;
        await new Promise((resolve) => setTimeout(resolve, 15 * (attempt + 1)));
      }
    }
    // Every attempt lost a race or hit contention. The reconciler picks the referral up again on its next tick.
    this.logger.warn(`Referral ${referralId} reward deferred after contention: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
    return { status: 'DONE', granted: 0, skipped: 0 };
  }

  private async grantInTransaction(tx: PrismaTransactionClient, referralId: string, settings: ReferralSettings, now: Date): Promise<GrantSummary> {
    const referral = await this.repository.findReferralWithCustomers(referralId, tx);
    if (!referral || (referral.status !== 'QUALIFIED' && referral.status !== 'REWARDED')) return { status: 'NOT_QUALIFIED', granted: 0, skipped: 0 };

    const existing = await this.repository.rewardsForReferral(referralId, tx);
    const decided = new Set(existing.map((r) => r.beneficiary));
    let granted = 0;
    let skipped = 0;
    let anyGranted = existing.some((r) => r.status === 'GRANTED');

    for (const beneficiary of ['REFERRED', 'REFERRER'] as const satisfies readonly RewardBeneficiary[]) {
      if (decided.has(beneficiary)) continue;
      const outcome = await this.decide(tx, referral, beneficiary, settings);
      if (outcome === 'GRANTED') {
        granted += 1;
        anyGranted = true;
      } else {
        skipped += 1;
      }
    }
    if (anyGranted) await this.repository.casRewarded(tx, referralId, now);
    return { status: 'DONE', granted, skipped };
  }

  private async decide(
    tx: PrismaTransactionClient,
    referral: { id: string; referrerCustomerId: string; referredCustomerId: string },
    beneficiary: RewardBeneficiary,
    settings: ReferralSettings,
  ): Promise<'GRANTED' | 'SKIPPED'> {
    const isReferrer = beneficiary === 'REFERRER';
    const customerId = isReferrer ? referral.referrerCustomerId : referral.referredCustomerId;
    const type = isReferrer ? settings.referrerRewardType : settings.referredRewardType;
    const value = isReferrer ? settings.referrerRewardValue : settings.referredRewardValue;

    const skip = (reason: SkipReason) => this.repository.createReward(tx, { referralId: referral.id, beneficiary, customerId, rewardType: type, status: 'SKIPPED', skipReason: reason, points: 0 }).then(() => 'SKIPPED' as const);

    if (!SUPPORTED_REWARD_TYPES.includes(type)) return skip('REWARD_TYPE_UNSUPPORTED');
    if (!Number.isInteger(value) || value <= 0) return skip('ZERO_REWARD');

    let ordinal: number | null = null;
    if (isReferrer) {
      const already = await this.repository.grantedReferrerRewardCount(tx, customerId);
      if (settings.maxSuccessfulReferrals > 0 && already >= settings.maxSuccessfulReferrals) return skip('MAX_REFERRALS_REACHED');
      ordinal = already + 1;
    }

    const row = await this.repository.createReward(tx, { referralId: referral.id, beneficiary, customerId, rewardType: type, status: 'GRANTED', points: value, ordinal });
    const ledgerId = await this.loyalty.creditPointsTx(tx, customerId, value, { description: isReferrer ? 'Referral reward: your friend made their first purchase' : 'Referral reward: welcome gift' });
    await this.repository.linkRewardLedger(tx, row.id, ledgerId);
    return 'GRANTED';
  }
}
