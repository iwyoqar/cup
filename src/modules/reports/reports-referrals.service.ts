import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ConfigService } from '../../common/config/config.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AnalyticsPeriod, resolveAnalyticsRange } from '../analytics/analytics-period';

export type ReferralSortBy = 'referrals' | 'qualified' | 'rewards' | 'qualifyingAmount';

export interface ReferralsReportQuery {
  period: AnalyticsPeriod;
  startDate?: string;
  endDate?: string;
  referrerCustomerId?: string;
  sortBy: ReferralSortBy;
  sortDirection: 'asc' | 'desc';
  page: number;
  limit: number;
}

export interface ReportsReferrerRow {
  customerId: string;
  name: string | null;
  code: string | null; // current referral code (current state)
  referralsCreated: number;
  qualified: number;
  rewardsGranted: number; // GRANTED ReferralReward rows to this referrer in the period
  rewardPoints: number;
  referredCustomers: number;
  qualifyingAmountMinor: number; // sum of the engine's recorded qualifying-purchase amounts for referrals qualified in the period
}

export interface ReportsReferredRow {
  referralId: string;
  referredCustomerId: string;
  referredName: string | null;
  referrerCustomerId: string;
  referrerName: string | null;
  createdAt: string;
  status: string; // Referral.status as persisted (current state)
  qualifiedAt: string | null;
  closeReason: string | null;
  referredReward: { status: string; points: number } | null;
  qualifyingAmountMinor: number | null;
}

export interface ReportsReferralsOverview {
  period: { key: AnalyticsPeriod; startDate: string; endDate: string; timezoneOffsetMinutes: number };
  summary: {
    referralCodes: number; // current state, all-time
    referralsCreated: number;
    qualifiedReferrals: number;
    rewardsGranted: number;
    rewardPointsGranted: number;
    rewardsSkipped: number;
    referrers: number;
    referredCustomers: number;
    qualifyingAmountMinor: number;
  };
  // Events whose own timestamp falls in the period (not a cohort): a referral created last month but qualified this week
  // counts under "qualified" here.
  funnel: { stage: 'CREATED' | 'REGISTERED' | 'QUALIFIED' | 'REWARDED' | 'CLOSED'; count: number }[];
  closedByReason: { reason: string; count: number }[];
  currentStatus: { status: string; count: number }[]; // all referrals, current state
  referrers: ReportsReferrerRow[];
  referrersPagination: { page: number; limit: number; total: number; totalPages: number };
  referred: ReportsReferredRow[]; // latest 50 referrals created in the period
  referredTotal: number;
  branchFilterSupported: false;
  notes: string[];
}

const REFERRED_LIMIT = 50;

// Reports Phase F4 — Referrals. Reads the referral engine's PERSISTED results only: Referral (status and its
// attributedAt / registeredAt / qualifiedAt / rewardedAt / closedAt stamps, qualifyingPurchaseKey /
// qualifyingAmountMinor written by ReferralQualificationService), ReferralCode and ReferralReward (GRANTED | SKIPPED).
// Qualification is never re-decided here. "Revenue" is limited to the qualifying purchase amount the engine recorded —
// never the referred customer's lifetime spend. Referrals carry no branch, so the report is all-branch.
@Injectable()
export class ReportsReferralsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async getReferrals(query: ReferralsReportQuery, now: Date = new Date()): Promise<ReportsReferralsOverview> {
    const offset = this.config.env.BUSINESS_TIMEZONE_OFFSET_MINUTES;
    const range = resolveAnalyticsRange(query, now, offset);
    const inRange = { gte: range.from, lt: range.to };
    if (query.referrerCustomerId && !(await this.prisma.customer.findUnique({ where: { id: query.referrerCustomerId }, select: { id: true } }))) throw new BadRequestException('Unknown referrer.');
    const scope: Prisma.ReferralWhereInput = query.referrerCustomerId ? { referrerCustomerId: query.referrerCustomerId } : {};

    const [codes, created, registered, qualified, rewarded, closed, currentStatus, rewardRows, createdByReferrer, qualifiedByReferrer, referredRows, referredTotal] = await Promise.all([
      this.prisma.referralCode.count(),
      this.prisma.referral.count({ where: { ...scope, createdAt: inRange } }),
      this.prisma.referral.count({ where: { ...scope, registeredAt: inRange } }),
      this.prisma.referral.aggregate({ where: { ...scope, qualifiedAt: inRange }, _count: { _all: true }, _sum: { qualifyingAmountMinor: true } }),
      this.prisma.referral.count({ where: { ...scope, rewardedAt: inRange } }),
      this.prisma.referral.groupBy({ by: ['closeReason'], where: { ...scope, closedAt: inRange }, _count: { _all: true } }),
      this.prisma.referral.groupBy({ by: ['status'], where: scope, _count: { _all: true } }),
      this.prisma.referralReward.groupBy({ by: ['customerId', 'beneficiary', 'status'], where: { createdAt: inRange, referral: scope }, _count: { _all: true }, _sum: { points: true } }),
      this.prisma.referral.groupBy({ by: ['referrerCustomerId'], where: { ...scope, createdAt: inRange }, _count: { _all: true } }),
      this.prisma.referral.groupBy({ by: ['referrerCustomerId'], where: { ...scope, qualifiedAt: inRange }, _count: { _all: true }, _sum: { qualifyingAmountMinor: true } }),
      this.prisma.referral.findMany({
        where: { ...scope, createdAt: inRange },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: REFERRED_LIMIT,
        select: { id: true, referredCustomerId: true, referrerCustomerId: true, createdAt: true, status: true, qualifiedAt: true, closeReason: true, qualifyingAmountMinor: true, referred: { select: { displayName: true } }, referrer: { select: { displayName: true } }, rewards: { where: { beneficiary: 'REFERRED' }, select: { status: true, points: true } } },
      }),
      this.prisma.referral.count({ where: { ...scope, createdAt: inRange } }),
    ]);

    // Referrer activity: every referrer with any event in the period.
    const byReferrer = new Map<string, ReportsReferrerRow>();
    const row = (id: string) => {
      let r = byReferrer.get(id);
      if (!r) byReferrer.set(id, (r = { customerId: id, name: null, code: null, referralsCreated: 0, qualified: 0, rewardsGranted: 0, rewardPoints: 0, referredCustomers: 0, qualifyingAmountMinor: 0 }));
      return r;
    };
    for (const c of createdByReferrer) Object.assign(row(c.referrerCustomerId), { referralsCreated: c._count._all, referredCustomers: c._count._all }); // referredCustomerId is unique per referral
    for (const q of qualifiedByReferrer) Object.assign(row(q.referrerCustomerId), { qualified: q._count._all, qualifyingAmountMinor: q._sum.qualifyingAmountMinor ?? 0 });
    for (const w of rewardRows) {
      if (w.beneficiary !== 'REFERRER' || w.status !== 'GRANTED') continue;
      const r = row(w.customerId);
      r.rewardsGranted += w._count._all;
      r.rewardPoints += w._sum.points ?? 0;
    }
    const sorted = sortReferrers([...byReferrer.values()], query.sortBy, query.sortDirection);
    const total = sorted.length;
    const totalPages = Math.max(1, Math.ceil(total / query.limit));
    const page = Math.min(query.page, totalPages);
    const pageRows = sorted.slice((page - 1) * query.limit, page * query.limit);
    const ids = pageRows.map((r) => r.customerId);
    const [people, pageCodes] = await Promise.all([
      this.prisma.customer.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true } }),
      this.prisma.referralCode.findMany({ where: { customerId: { in: ids } }, select: { customerId: true, code: true } }),
    ]);
    const nameOf = new Map(people.map((p) => [p.id, p.displayName]));
    const codeOf = new Map(pageCodes.map((c) => [c.customerId, c.code]));
    for (const r of pageRows) {
      r.name = nameOf.get(r.customerId) ?? null;
      r.code = codeOf.get(r.customerId) ?? null;
    }

    const granted = rewardRows.filter((w) => w.status === 'GRANTED');
    return {
      period: { key: query.period, startDate: range.startDate, endDate: range.endDate, timezoneOffsetMinutes: offset },
      summary: {
        referralCodes: codes,
        referralsCreated: created,
        qualifiedReferrals: qualified._count._all,
        rewardsGranted: granted.reduce((s, w) => s + w._count._all, 0),
        rewardPointsGranted: granted.reduce((s, w) => s + (w._sum.points ?? 0), 0),
        rewardsSkipped: rewardRows.filter((w) => w.status === 'SKIPPED').reduce((s, w) => s + w._count._all, 0),
        referrers: createdByReferrer.length,
        referredCustomers: created,
        qualifyingAmountMinor: qualified._sum.qualifyingAmountMinor ?? 0,
      },
      funnel: [
        { stage: 'CREATED', count: created },
        { stage: 'REGISTERED', count: registered },
        { stage: 'QUALIFIED', count: qualified._count._all },
        { stage: 'REWARDED', count: rewarded },
        { stage: 'CLOSED', count: closed.reduce((s, c) => s + c._count._all, 0) },
      ],
      closedByReason: closed.map((c) => ({ reason: c.closeReason ?? 'UNSPECIFIED', count: c._count._all })).sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
      currentStatus: currentStatus.map((s) => ({ status: s.status, count: s._count._all })).sort((a, b) => a.status.localeCompare(b.status)),
      referrers: pageRows,
      referrersPagination: { page, limit: query.limit, total, totalPages },
      referred: referredRows.map((r) => ({
        referralId: r.id,
        referredCustomerId: r.referredCustomerId,
        referredName: r.referred.displayName,
        referrerCustomerId: r.referrerCustomerId,
        referrerName: r.referrer.displayName,
        createdAt: r.createdAt.toISOString(),
        status: r.status,
        qualifiedAt: r.qualifiedAt ? r.qualifiedAt.toISOString() : null,
        closeReason: r.closeReason,
        referredReward: r.rewards[0] ? { status: r.rewards[0].status, points: r.rewards[0].points } : null,
        qualifyingAmountMinor: r.qualifyingAmountMinor,
      })),
      referredTotal,
      branchFilterSupported: false,
      notes: [
        "Qualification and rewards are the referral engine's own recorded results; this report never re-decides them.",
        'Funnel stages count events whose own timestamp falls in the selected period, so the stages are not a single cohort.',
        '"Qualifying purchase amount" is the amount of the one purchase that qualified each referral, as recorded by the engine — not the referred customer\'s lifetime spend.',
        'Referrals have no branch, so this report always covers all branches. Click tracking does not exist, so the funnel starts at referrals created.',
      ],
    };
  }
}

// Default: qualified desc, then rewards desc, then customerId asc. A usage table, never "top referrers".
function sortReferrers(rows: ReportsReferrerRow[], by: ReferralSortBy, direction: 'asc' | 'desc'): ReportsReferrerRow[] {
  const sign = direction === 'asc' ? 1 : -1;
  const value = (r: ReportsReferrerRow) => (by === 'referrals' ? r.referralsCreated : by === 'qualified' ? r.qualified : by === 'rewards' ? r.rewardsGranted : r.qualifyingAmountMinor);
  return [...rows].sort((a, b) => (value(a) - value(b)) * sign || b.rewardsGranted - a.rewardsGranted || (a.customerId < b.customerId ? -1 : a.customerId > b.customerId ? 1 : 0));
}
