import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { isUniqueConstraintViolation } from '../../common/util/prisma-errors';
import { REFERRAL_CODE_MAX_ATTEMPTS, buildReferralLink, displayReferralCode, generateReferralCodeBody, isReferralCodeCollision, normalizeReferralCode } from './referral-code';
import { ReferralBotIdentityService } from './referral-bot-identity.service';
import { ReferralSettings, ReferralSettingsService } from './referral-settings.service';
import { PENDING_STATUSES, REFERRAL_STATUSES, ReferralStatus, SUCCESS_STATUSES } from './referral.types';
import { ReferralsRepository } from './referrals.repository';

const sum = (counts: Record<string, number>, statuses: readonly string[]) => statuses.reduce((n, s) => n + (counts[s] ?? 0), 0);
const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

export type CustomerReferralOverview =
  | { enabled: false }
  | { enabled: true; eligible: false }
  | {
      enabled: true;
      eligible: true;
      referralCode: string;
      referralLink: string | null;
      successfulReferrals: number;
      pendingReferrals: number;
      totalRewardsEarned: number;
      reward: { referrerPoints: number; friendPoints: number };
      limitReached: boolean;
      myReferral: { status: ReferralStatus; welcomePoints: number | null } | null;
    };

const purchaseSource = (key: string | null): string | null => (key ? (key.startsWith('POS:') ? 'POS purchase' : 'CUP order') : null);

// Read models + code issuance. Nothing here decides attribution, qualification or rewards (those are ReferralAttributionService /
// ReferralQualificationService / ReferralRewardService), and no method accepts a customer id from a client: the customer API passes the id of the
// authenticated customer, the admin API works on referral ids.
@Injectable()
export class ReferralsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: ReferralsRepository,
    private readonly settings: ReferralSettingsService,
    private readonly bot: ReferralBotIdentityService,
  ) {}

  // ------------------------------------------------------------------------------------------------------------------ customer

  // The only write on the customer read path is the lazy, idempotent creation of the customer's own code (never while the program is off).
  async getOverview(customerId: string): Promise<CustomerReferralOverview> {
    const settings = await this.settings.get();
    if (!settings.enabled) return { enabled: false };
    if (!(await this.repository.isRegistered(customerId))) return { enabled: true, eligible: false };

    const body = await this.ensureCode(customerId);
    const [counts, points, own, granted] = await Promise.all([
      this.repository.countsByStatusForReferrer(customerId),
      this.repository.rewardPointsEarned(customerId),
      this.repository.findOwnReferral(customerId),
      settings.maxSuccessfulReferrals > 0 ? this.repository.grantedReferrerRewardCount(this.prisma, customerId) : Promise.resolve(0),
    ]);
    const username = this.bot.username();
    return {
      enabled: true,
      eligible: true,
      referralCode: displayReferralCode(body),
      referralLink: username ? buildReferralLink(username, body) : null,
      successfulReferrals: sum(counts, SUCCESS_STATUSES),
      pendingReferrals: sum(counts, PENDING_STATUSES),
      totalRewardsEarned: points.asReferrer + points.asReferred,
      reward: { referrerPoints: settings.referrerRewardValue, friendPoints: settings.referredRewardValue },
      limitReached: settings.maxSuccessfulReferrals > 0 && granted >= settings.maxSuccessfulReferrals,
      myReferral: own ? { status: own.status as ReferralStatus, welcomePoints: points.asReferred > 0 ? points.asReferred : null } : null,
    };
  }

  async getHistory(customerId: string, options: { cursor?: string; limit: number }) {
    const rows = await this.repository.historyPage(customerId, options.cursor, options.limit + 1);
    const hasMore = rows.length > options.limit;
    const page = hasMore ? rows.slice(0, options.limit) : rows;
    return {
      // Deliberately no names, ids or contact data of the invited friends.
      items: page.map((r) => ({
        status: r.status,
        invitedAt: iso(r.attributedAt ?? r.createdAt),
        qualifiedAt: iso(r.qualifiedAt),
        rewardPoints: r.rewards.filter((w) => w.status === 'GRANTED').reduce((n, w) => n + w.points, 0),
      })),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  // Lazy + race-safe: the customer's row is unique, and a code collision (astronomically rare) just draws another random code.
  async ensureCode(customerId: string): Promise<string> {
    const existing = await this.repository.findCodeByCustomer(customerId);
    if (existing) return existing.code;
    for (let attempt = 0; attempt < REFERRAL_CODE_MAX_ATTEMPTS; attempt += 1) {
      try {
        return (await this.repository.createCode(customerId, generateReferralCodeBody())).code;
      } catch (err) {
        if (isReferralCodeCollision(err)) continue;
        if (isUniqueConstraintViolation(err)) {
          const winner = await this.repository.findCodeByCustomer(customerId);
          if (winner) return winner.code;
        }
        throw err;
      }
    }
    throw new Error('Could not allocate a unique referral code.');
  }

  // ------------------------------------------------------------------------------------------------------------- Customer 360

  // STRICTLY read-only (an admin looking at a profile must never create a code or move a referral). Counts only for the people this customer invited.
  async getCustomerSummary(customerId: string) {
    const [code, counts, points, own] = await Promise.all([
      this.repository.findCodeByCustomer(customerId),
      this.repository.countsByStatusForReferrer(customerId),
      this.repository.rewardPointsEarned(customerId),
      this.repository.findOwnReferral(customerId),
    ]);
    return {
      referralCode: code ? displayReferralCode(code.code) : null,
      successfulReferrals: sum(counts, SUCCESS_STATUSES),
      pendingReferrals: sum(counts, PENDING_STATUSES),
      rewardPointsEarned: { asReferrer: points.asReferrer, asReferred: points.asReferred, total: points.asReferrer + points.asReferred },
      referredBy: own ? { status: own.status, referrerName: own.referrer.displayName, at: iso(own.attributedAt ?? own.createdAt), closeReason: own.closeReason } : null,
    };
  }

  // Phase 16: the Staff Panel's read-only view. Counts per stage for the people this customer invited (never who they are) and the customer's OWN
  // referral status. STRICTLY read-only: it never creates a code, and staff cannot attribute or assign a referrer.
  async getStaffView(customerId: string) {
    const [code, counts, own] = await Promise.all([this.repository.findCodeByCustomer(customerId), this.repository.countsByStatusForReferrer(customerId), this.repository.findOwnReferral(customerId)]);
    return {
      referralCode: code ? displayReferralCode(code.code) : null,
      invited: { successful: sum(counts, SUCCESS_STATUSES), pending: sum(counts, PENDING_STATUSES), qualified: counts['QUALIFIED'] ?? 0, rewarded: counts['REWARDED'] ?? 0 },
      referredBy: own ? { status: own.status as ReferralStatus, at: iso(own.attributedAt ?? own.createdAt) } : null,
    };
  }

  // ------------------------------------------------------------------------------------------------------------------ admin

  getSettings(): Promise<ReferralSettings> {
    return this.settings.get();
  }

  async adminSummary() {
    const [counts, totals] = await Promise.all([this.repository.adminStatusCounts(), this.repository.adminRewardTotals()]);
    const byStatus = Object.fromEntries(REFERRAL_STATUSES.map((s) => [s, counts[s] ?? 0]));
    return { total: Object.values(byStatus).reduce((a, b) => a + b, 0), byStatus, rewardsGrantedCount: totals.grantedCount, rewardPointsGranted: totals.grantedPoints };
  }

  async adminList(filter: { status?: ReferralStatus; referrer?: string; referred?: string; from?: Date; to?: Date; cursor?: string; limit: number }) {
    const rows = await this.repository.adminList({ ...filter, referrerCode: filter.referrer ? normalizeReferralCode(filter.referrer) : null, take: filter.limit + 1 });
    const hasMore = rows.length > filter.limit;
    const page = hasMore ? rows.slice(0, filter.limit) : rows;
    const pointsFor = (r: (typeof page)[number], b: string) => r.rewards.filter((w) => w.beneficiary === b && w.status === 'GRANTED').reduce((n, w) => n + w.points, 0);
    return {
      items: page.map((r) => ({
        id: r.id,
        status: r.status,
        referrer: { displayName: r.referrer.displayName },
        referred: { displayName: r.referred.displayName },
        createdAt: r.createdAt.toISOString(),
        attributedAt: iso(r.attributedAt ?? r.createdAt),
        qualifiedAt: iso(r.qualifiedAt),
        rewardedAt: iso(r.rewardedAt),
        closeReason: r.closeReason,
        referrerRewardPoints: pointsFor(r, 'REFERRER'),
        referredRewardPoints: pointsFor(r, 'REFERRED'),
      })),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  async adminDetail(id: string) {
    const r = await this.repository.adminDetail(id);
    if (!r) return null;
    const attributedAt = r.attributedAt ?? r.createdAt;
    const timeline = [
      { type: 'ATTRIBUTED', at: attributedAt, detail: 'Referral link opened and attributed' },
      r.registeredAt ? { type: 'REGISTERED', at: r.registeredAt, detail: 'Friend completed registration' } : null,
      r.qualifiedAt ? { type: 'QUALIFIED', at: r.qualifiedAt, detail: `First qualifying purchase (${purchaseSource(r.qualifyingPurchaseKey)})` } : null,
      ...r.rewards.map((w) => ({ type: `REWARD_${w.status}`, at: w.createdAt, detail: `${w.beneficiary === 'REFERRER' ? 'Referrer' : 'Friend'}: ${w.status === 'GRANTED' ? `${w.points} points` : `skipped (${w.skipReason})`}` })),
      r.closedAt ? { type: r.status, at: r.closedAt, detail: `Closed: ${r.closeReason}` } : null,
    ]
      .filter((e): e is { type: string; at: Date; detail: string } => e !== null)
      .sort((a, b) => a.at.getTime() - b.at.getTime());
    return {
      id: r.id,
      status: r.status,
      referrer: { displayName: r.referrer.displayName },
      referred: { displayName: r.referred.displayName },
      attribution: { code: r.referralCode ? displayReferralCode(r.referralCode) : null, attributedAt: attributedAt.toISOString(), registeredAt: iso(r.registeredAt) },
      qualification: { qualifiedAt: iso(r.qualifiedAt), source: purchaseSource(r.qualifyingPurchaseKey), amountMinor: r.qualifyingAmountMinor },
      closed: r.closedAt ? { at: r.closedAt.toISOString(), reason: r.closeReason } : null,
      rewards: r.rewards.map((w) => ({ beneficiary: w.beneficiary, rewardType: w.rewardType, status: w.status, skipReason: w.skipReason, points: w.points, at: w.createdAt.toISOString() })),
      timeline: timeline.map((e) => ({ type: e.type, at: e.at.toISOString(), detail: e.detail })),
    };
  }
}
