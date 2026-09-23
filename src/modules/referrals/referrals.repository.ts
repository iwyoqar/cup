import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Db, PrismaService } from '../../common/prisma/prisma.service';
import { epochMsCastSql, epochMsParam } from '../../common/prisma/sql-dialect';
import { CUSTOMER_METRICS_ORDER_STATUSES } from '../customer-metrics/customer-metrics-order-statuses';
import { PENDING_STATUSES, REFERRAL_EVENT_TYPES, ReferralEvent, ReferralEventType, ReferralStatus } from './referral.types';

const ORDER_STATUSES = [...CUSTOMER_METRICS_ORDER_STATUSES];

export interface EventCursor {
  t: number;
  type: ReferralEventType;
  id: string;
}

export interface AdminListFilter {
  status?: ReferralStatus;
  referrer?: string; // display-name fragment, or a referral code
  referred?: string; // display-name fragment
  referrerCode?: string | null; // normalized code body derived from `referrer` (null when it is not a code)
  from?: Date;
  to?: Date;
  cursor?: string;
  take: number;
}

const num = (v: bigint | number): number => (typeof v === 'bigint' ? Number(v) : v);

// Only Prisma / raw SQL for referrals lives here. Every method that a service wants inside a transaction takes a Db.
@Injectable()
export class ReferralsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ------------------------------------------------------------------------------------------------------------------ codes

  findCodeByCustomer(customerId: string, db: Db = this.prisma) {
    return db.referralCode.findUnique({ where: { customerId } });
  }

  findCodeOwner(code: string, db: Db = this.prisma) {
    return db.referralCode.findUnique({ where: { code }, select: { customerId: true } });
  }

  createCode(customerId: string, code: string) {
    return this.prisma.referralCode.create({ data: { customerId, code } });
  }

  // Registered = a phone is on file (the existing registration definition, derived from Customer.phone — see TelegramRegistrationService).
  async isRegistered(customerId: string): Promise<boolean> {
    const row = await this.prisma.customer.findUnique({ where: { id: customerId }, select: { phone: true } });
    return Boolean(row?.phone);
  }

  // ------------------------------------------------------------------------------------------------------------ attribution

  findByReferred(referredCustomerId: string, db: Db = this.prisma) {
    return db.referral.findUnique({ where: { referredCustomerId } });
  }

  // Circular guard: is `referrerId` already someone `referredId` referred?
  async existsReferral(referrerCustomerId: string, referredCustomerId: string): Promise<boolean> {
    return (await this.prisma.referral.count({ where: { referrerCustomerId, referredCustomerId } })) > 0;
  }

  createReferral(data: { referrerCustomerId: string; referredCustomerId: string; status: ReferralStatus; referralCode: string; attributedAt: Date; registeredAt: Date | null }) {
    return this.prisma.referral.create({ data });
  }

  // ATTRIBUTED -> REGISTERED, once. Conditional update: any other status is left alone.
  async markRegistered(referredCustomerId: string, at: Date): Promise<boolean> {
    const result = await this.prisma.referral.updateMany({ where: { referredCustomerId, status: 'ATTRIBUTED' }, data: { status: 'REGISTERED', registeredAt: at } });
    return result.count > 0;
  }

  // ---------------------------------------------------------------------------------------------- qualification / expiry batch

  // Bounded candidates: still-pending referrals that (a) have at least one qualifying purchase of any time, or (b) are past their attribution window
  // (`expiredBeforeMs`, null = the window never expires). Least-recently-checked first (never-checked first), so a full batch can never starve the rest.
  // The purchase predicate is the canonical one (CUSTOMER_METRICS_ORDER_STATUSES orders + IMPORTED POS rows) used everywhere else.
  async pendingCandidateIds(expiredBeforeMs: number | null, limit: number): Promise<string[]> {
    const expired = expiredBeforeMs === null ? Prisma.empty : Prisma.sql`OR COALESCE(r."attributedAt", r."createdAt") < ${epochMsParam(expiredBeforeMs)}`;
    const rows = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT r."id" AS id FROM "referrals" r
      WHERE r."status" IN (${Prisma.join([...PENDING_STATUSES])})
        AND (
          EXISTS (SELECT 1 FROM "orders" o WHERE o."customerId" = r."referredCustomerId" AND o."status" IN (${Prisma.join(ORDER_STATUSES)}))
          OR EXISTS (SELECT 1 FROM "poster_imported_transactions" t WHERE t."customerId" = r."referredCustomerId" AND t."status" = 'IMPORTED')
          ${expired}
        )
      ORDER BY (r."checkedAt" IS NOT NULL), r."checkedAt", r."id" LIMIT ${limit}`);
    return rows.map((r) => r.id);
  }

  findByIds(ids: string[]) {
    return this.prisma.referral.findMany({ where: { id: { in: ids } } });
  }

  async touchChecked(ids: string[], at: Date): Promise<void> {
    if (ids.length === 0) return;
    await this.prisma.referral.updateMany({ where: { id: { in: ids }, status: { in: [...PENDING_STATUSES] } }, data: { checkedAt: at } });
  }

  // Compare-and-set transitions: the WHERE clause is the guard, so two workers can never both win.
  async casQualify(db: Db, id: string, data: { qualifiedAt: Date; purchaseKey: string; amountMinor: number }): Promise<boolean> {
    const result = await db.referral.updateMany({
      where: { id, status: { in: [...PENDING_STATUSES] } },
      data: { status: 'QUALIFIED', qualifiedAt: data.qualifiedAt, qualifyingPurchaseKey: data.purchaseKey, qualifyingAmountMinor: data.amountMinor },
    });
    return result.count > 0;
  }

  async casClose(db: Db, id: string, status: 'EXPIRED' | 'REJECTED' | 'INVALID', reason: string, at: Date): Promise<boolean> {
    const result = await db.referral.updateMany({ where: { id, status: { in: [...PENDING_STATUSES] } }, data: { status, closedAt: at, closeReason: reason } });
    return result.count > 0;
  }

  async casRewarded(db: Db, id: string, at: Date): Promise<boolean> {
    const result = await db.referral.updateMany({ where: { id, status: 'QUALIFIED' }, data: { status: 'REWARDED', rewardedAt: at } });
    return result.count > 0;
  }

  // QUALIFIED referrals that still lack one of their two reward decisions (a crash between qualifying and rewarding) — the reconciler's work list.
  async qualifiedWithoutFullRewards(limit: number): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT r."id" AS id FROM "referrals" r
      WHERE r."status" = 'QUALIFIED' AND (SELECT COUNT(*) FROM "referral_rewards" w WHERE w."referralId" = r."id") < 2
      ORDER BY r."qualifiedAt", r."id" LIMIT ${limit}`);
    return rows.map((r) => r.id);
  }

  // ------------------------------------------------------------------------------------------------------------------ rewards

  rewardsForReferral(referralId: string, db: Db = this.prisma) {
    return db.referralReward.findMany({ where: { referralId }, orderBy: { createdAt: 'asc' } });
  }

  createReward(db: Db, data: Prisma.ReferralRewardUncheckedCreateInput) {
    return db.referralReward.create({ data });
  }

  linkRewardLedger(db: Db, rewardId: string, loyaltyTransactionId: string) {
    return db.referralReward.update({ where: { id: rewardId }, data: { loyaltyTransactionId } });
  }

  grantedReferrerRewardCount(db: Db, referrerCustomerId: string): Promise<number> {
    return db.referralReward.count({ where: { customerId: referrerCustomerId, beneficiary: 'REFERRER', status: 'GRANTED' } });
  }

  findReferralWithCustomers(id: string, db: Db = this.prisma) {
    return db.referral.findUnique({ where: { id } });
  }

  // ------------------------------------------------------------------------------------------------------- customer read models

  async countsByStatusForReferrer(referrerCustomerId: string): Promise<Record<string, number>> {
    const rows = await this.prisma.referral.groupBy({ by: ['status'], where: { referrerCustomerId }, _count: { _all: true } });
    return Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
  }

  async rewardPointsEarned(customerId: string): Promise<{ asReferrer: number; asReferred: number }> {
    const rows = await this.prisma.referralReward.groupBy({ by: ['beneficiary'], where: { customerId, status: 'GRANTED' }, _sum: { points: true } });
    const pick = (b: string) => rows.find((r) => r.beneficiary === b)?._sum.points ?? 0;
    return { asReferrer: pick('REFERRER'), asReferred: pick('REFERRED') };
  }

  // The friend's own referral (they are the "referred" side), with the referrer's display name for Admin only.
  findOwnReferral(referredCustomerId: string) {
    return this.prisma.referral.findUnique({ where: { referredCustomerId }, include: { referrer: { select: { displayName: true } } } });
  }

  // Newest first, bounded. Cursor = the last referral id of the previous page.
  historyPage(referrerCustomerId: string, cursor: string | undefined, take: number) {
    return this.prisma.referral.findMany({
      where: { referrerCustomerId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { rewards: { where: { beneficiary: 'REFERRER' }, select: { status: true, points: true } } },
    });
  }

  // ------------------------------------------------------------------------------------------------------------------ admin

  private adminWhere(filter: Pick<AdminListFilter, 'status' | 'referrer' | 'referred' | 'referrerCode' | 'from' | 'to'>): Prisma.ReferralWhereInput {
    const and: Prisma.ReferralWhereInput[] = [];
    if (filter.status) and.push({ status: filter.status });
    if (filter.referrer) {
      and.push({ OR: [{ referrer: { displayName: { contains: filter.referrer } } }, ...(filter.referrerCode ? [{ referrer: { referralCode: { code: filter.referrerCode } } }] : [])] });
    }
    if (filter.referred) and.push({ referred: { displayName: { contains: filter.referred } } });
    if (filter.from || filter.to) and.push({ createdAt: { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lte: filter.to } : {}) } });
    return and.length > 0 ? { AND: and } : {};
  }

  adminList(filter: AdminListFilter) {
    return this.prisma.referral.findMany({
      where: this.adminWhere(filter),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: filter.take,
      ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
      include: {
        referrer: { select: { displayName: true } },
        referred: { select: { displayName: true } },
        rewards: { select: { beneficiary: true, status: true, points: true } },
      },
    });
  }

  adminDetail(id: string) {
    return this.prisma.referral.findUnique({
      where: { id },
      include: { referrer: { select: { displayName: true } }, referred: { select: { displayName: true } }, rewards: { orderBy: { createdAt: 'asc' } } },
    });
  }

  async adminStatusCounts(): Promise<Record<string, number>> {
    const rows = await this.prisma.referral.groupBy({ by: ['status'], _count: { _all: true } });
    return Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
  }

  async adminRewardTotals(): Promise<{ grantedPoints: number; grantedCount: number }> {
    const agg = await this.prisma.referralReward.aggregate({ where: { status: 'GRANTED' }, _sum: { points: true }, _count: { _all: true } });
    return { grantedPoints: agg._sum.points ?? 0, grantedCount: agg._count._all };
  }

  // ------------------------------------------------------------------------------------------------------------------ events

  // Ordered, bounded, resumable stream derived from the four lifecycle timestamps. A row contributes one event per timestamp it has.
  async eventsAfter(cursor: EventCursor | null, sinceMs: number, limit: number): Promise<{ event: ReferralEvent; cursor: EventCursor }[]> {
    const after = cursor ? Prisma.sql`AND (t > ${cursor.t} OR (t = ${cursor.t} AND (type > ${cursor.type} OR (type = ${cursor.type} AND id > ${cursor.id}))))` : Prisma.empty;
    const rows = await this.prisma.$queryRaw<{ t: bigint | number; type: string; id: string; referrer: string; referred: string }[]>(Prisma.sql`
      SELECT t, type, id, referrer, referred FROM (
        SELECT ${epochMsCastSql('"attributedAt"')} AS t, 'REFERRAL_ATTRIBUTED' AS type, "id" AS id, "referrerCustomerId" AS referrer, "referredCustomerId" AS referred FROM "referrals" WHERE "attributedAt" IS NOT NULL
        UNION ALL
        SELECT ${epochMsCastSql('"registeredAt"')}, 'REFERRAL_REGISTERED', "id", "referrerCustomerId", "referredCustomerId" FROM "referrals" WHERE "registeredAt" IS NOT NULL
        UNION ALL
        SELECT ${epochMsCastSql('"qualifiedAt"')}, 'REFERRAL_QUALIFIED', "id", "referrerCustomerId", "referredCustomerId" FROM "referrals" WHERE "qualifiedAt" IS NOT NULL
        UNION ALL
        SELECT ${epochMsCastSql('"rewardedAt"')}, 'REFERRAL_REWARDED', "id", "referrerCustomerId", "referredCustomerId" FROM "referrals" WHERE "rewardedAt" IS NOT NULL
      ) WHERE t >= ${sinceMs} ${after} ORDER BY t, type, id LIMIT ${limit}`);
    return rows
      .filter((r) => (REFERRAL_EVENT_TYPES as readonly string[]).includes(r.type))
      .map((r) => {
        const t = num(r.t);
        const type = r.type as ReferralEventType;
        return {
          event: { type, referralId: r.id, referrerCustomerId: r.referrer, referredCustomerId: r.referred, eventKey: `referral:${r.id}:${type}`, at: new Date(t) },
          cursor: { t, type, id: r.id },
        };
      });
  }

}
