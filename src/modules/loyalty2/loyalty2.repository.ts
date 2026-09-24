import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Db, PrismaService } from '../../common/prisma/prisma.service';
import { dayBucketSql, hourOfDaySql, isWeekendSql } from '../../common/prisma/sql-dialect';
import { CUSTOMER_METRICS_ORDER_STATUSES } from '../customer-metrics/customer-metrics-order-statuses';
import { LevelDef } from './loyalty2-math';

// The one canonical "qualifying purchase" list Loyalty 2.0 works from — exactly the Phase 5 / Analytics V1 definition:
// CUP orders in CUSTOMER_METRICS_ORDER_STATUSES + Poster POS purchases with status IMPORTED. Purchase time = Order.createdAt /
// PosterImportedTransaction.occurredAt. Only Prisma / raw SQL in this file.
export type PurchaseSource = 'CUP_ORDER' | 'POS';

export interface QualifyingPurchase {
  sourceType: PurchaseSource;
  sourceId: string;
  at: Date;
  amountMinor: number;
}

export interface LevelRow extends LevelDef {
  id: string;
  isActive: boolean;
}

const STATUSES = [...CUSTOMER_METRICS_ORDER_STATUSES];
// Raw SQL keeps the day/hour arithmetic in the database; the business timezone is a fixed offset, so these boundaries are
// deterministic. Phase 24: the actual day/hour/weekend expressions are dialect-aware (src/common/prisma/sql-dialect.ts) — this
// CTE itself only aliases the two source columns as `t`, unchanged for either SQLite or PostgreSQL.
const PURCHASE_TIMES = (customerId: string) => Prisma.sql`(
  SELECT "createdAt" AS t FROM "orders" WHERE "customerId" = ${customerId} AND "status" IN (${Prisma.join(STATUSES)})
  UNION ALL
  SELECT "occurredAt" AS t FROM "poster_imported_transactions" WHERE "customerId" = ${customerId} AND "status" = 'IMPORTED'
)`;

// Ascending (time, CUP before POS, id) — the one total order every "first purchase" / "spend before this purchase" calculation uses.
export function comparePurchases(a: QualifyingPurchase, b: QualifyingPurchase): number {
  return a.at.getTime() - b.at.getTime() || (a.sourceType === b.sourceType ? 0 : a.sourceType === 'CUP_ORDER' ? -1 : 1) || (a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0);
}

@Injectable()
export class Loyalty2Repository {
  constructor(private readonly prisma: PrismaService) {}

  // --- levels ---------------------------------------------------------------------------------------------------------

  async findLevels(): Promise<LevelRow[]> {
    return this.prisma.loyaltyLevel.findMany({ orderBy: { minLifetimeSpend: 'asc' } });
  }

  countLevels(): Promise<number> {
    return this.prisma.loyaltyLevel.count();
  }

  createLevels(levels: readonly LevelDef[]) {
    return this.prisma.loyaltyLevel.createMany({ data: levels.map((l) => ({ ...l })) });
  }

  // Replace-all in one transaction: upsert by code, delete the codes that are no longer configured. History rows keep
  // their own name snapshots, so nothing dangles.
  async replaceLevels(levels: readonly (LevelDef & { isActive: boolean })[]): Promise<void> {
    await this.prisma.runTransaction(async (tx) => {
      await tx.loyaltyLevel.deleteMany({ where: { code: { notIn: levels.map((l) => l.code) } } });
      for (const level of levels) {
        await tx.loyaltyLevel.upsert({ where: { code: level.code }, create: { ...level }, update: { ...level } });
      }
    });
  }

  // --- achievements ---------------------------------------------------------------------------------------------------

  findAchievements(options: { activeOnly?: boolean } = {}) {
    return this.prisma.achievement.findMany({ where: options.activeOnly ? { isActive: true } : {}, orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] });
  }

  findAchievementById(id: string) {
    return this.prisma.achievement.findUnique({ where: { id } });
  }

  countAchievements(): Promise<number> {
    return this.prisma.achievement.count();
  }

  createAchievements(rows: Prisma.AchievementCreateManyInput[]) {
    return this.prisma.achievement.createMany({ data: rows });
  }

  createAchievement(data: Prisma.AchievementCreateInput) {
    return this.prisma.achievement.create({ data });
  }

  updateAchievement(id: string, data: Prisma.AchievementUpdateInput) {
    return this.prisma.achievement.update({ where: { id }, data });
  }

  // --- reads for derivation --------------------------------------------------------------------------------------------

  // Ascending (time, source, id): the total order every "spend before this purchase" calculation uses. One bounded pair of
  // narrow column reads for ONE customer (no joins, no per-row queries).
  async qualifyingPurchases(customerId: string): Promise<QualifyingPurchase[]> {
    const [orders, pos] = await Promise.all([
      this.prisma.order.findMany({ where: { customerId, status: { in: STATUSES } }, select: { id: true, createdAt: true, totalMinor: true } }),
      this.prisma.posterImportedTransaction.findMany({ where: { customerId, status: 'IMPORTED' }, select: { id: true, occurredAt: true, totalMinor: true } }),
    ]);
    const all: QualifyingPurchase[] = [
      ...orders.map((o): QualifyingPurchase => ({ sourceType: 'CUP_ORDER', sourceId: o.id, at: o.createdAt, amountMinor: o.totalMinor })),
      ...pos.map((t): QualifyingPurchase => ({ sourceType: 'POS', sourceId: t.id, at: t.occurredAt, amountMinor: t.totalMinor })),
    ];
    return all.sort(comparePurchases);
  }

  // Phase 14: the SAME canonical qualifying-purchase definition and the SAME total order, for many customers in two narrow queries (one per
  // source) — Referrals uses it to find each referred customer's first purchase without a query per referral. A customer with no purchase
  // simply has an empty list.
  async qualifyingPurchasesForCustomers(customerIds: string[]): Promise<Map<string, QualifyingPurchase[]>> {
    const out = new Map<string, QualifyingPurchase[]>(customerIds.map((id) => [id, []]));
    if (customerIds.length === 0) return out;
    const [orders, pos] = await Promise.all([
      this.prisma.order.findMany({ where: { customerId: { in: customerIds }, status: { in: STATUSES } }, select: { id: true, customerId: true, createdAt: true, totalMinor: true } }),
      this.prisma.posterImportedTransaction.findMany({ where: { customerId: { in: customerIds }, status: 'IMPORTED' }, select: { id: true, customerId: true, occurredAt: true, totalMinor: true } }),
    ]);
    for (const o of orders) out.get(o.customerId)?.push({ sourceType: 'CUP_ORDER', sourceId: o.id, at: o.createdAt, amountMinor: o.totalMinor });
    // customerId: { in: customerIds } already excludes null at the DB level.
    for (const t of pos) if (t.customerId) out.get(t.customerId)?.push({ sourceType: 'POS', sourceId: t.id, at: t.occurredAt, amountMinor: t.totalMinor });
    for (const list of out.values()) list.sort(comparePurchases);
    return out;
  }

  async purchaseTotals(customerId: string): Promise<{ count: number; spend: number }> {
    const [cup, pos] = await Promise.all([
      this.prisma.order.aggregate({ where: { customerId, status: { in: STATUSES } }, _count: { _all: true }, _sum: { totalMinor: true } }),
      this.prisma.posterImportedTransaction.aggregate({ where: { customerId, status: 'IMPORTED' }, _count: { _all: true }, _sum: { totalMinor: true } }),
    ]);
    return { count: cup._count._all + pos._count._all, spend: (cup._sum.totalMinor ?? 0) + (pos._sum.totalMinor ?? 0) };
  }

  async visitDays(customerId: string, offsetMinutes: number): Promise<string[]> {
    const day = dayBucketSql('t', offsetMinutes);
    const rows = await this.prisma.$queryRaw<{ d: string }[]>(Prisma.sql`SELECT DISTINCT ${day} AS d FROM ${PURCHASE_TIMES(customerId)} ORDER BY d`);
    return rows.map((r) => r.d);
  }

  async countMorningPurchases(customerId: string, beforeHour: number, offsetMinutes: number): Promise<number> {
    const hour = hourOfDaySql('t', offsetMinutes);
    const rows = await this.prisma.$queryRaw<{ n: bigint | number }[]>(Prisma.sql`SELECT COUNT(*) AS n FROM ${PURCHASE_TIMES(customerId)} WHERE ${hour} < ${beforeHour}`);
    return Number(rows[0]?.n ?? 0);
  }

  async countWeekendPurchases(customerId: string, offsetMinutes: number): Promise<number> {
    const weekend = isWeekendSql('t', offsetMinutes);
    const rows = await this.prisma.$queryRaw<{ n: bigint | number }[]>(Prisma.sql`SELECT COUNT(*) AS n FROM ${PURCHASE_TIMES(customerId)} WHERE ${weekend}`);
    return Number(rows[0]?.n ?? 0);
  }

  redemptionCount(customerId: string): Promise<number> {
    return this.prisma.rewardRedemption.count({ where: { customerId } });
  }

  async processedAccruals(customerId: string): Promise<Set<string>> {
    const rows = await this.prisma.loyaltyAccrual.findMany({ where: { customerId }, select: { sourceType: true, sourceId: true } });
    return new Set(rows.map((r) => `${r.sourceType}:${r.sourceId}`));
  }

  async recordedLevelCodes(customerId: string): Promise<Set<string>> {
    const rows = await this.prisma.loyaltyLevelUp.findMany({ where: { customerId }, select: { levelCode: true } });
    return new Set(rows.map((r) => r.levelCode));
  }

  unlocks(customerId: string) {
    return this.prisma.customerAchievement.findMany({ where: { customerId }, select: { achievementId: true, unlockedAt: true } });
  }

  async claimedBirthdayYears(customerId: string): Promise<Set<number>> {
    const rows = await this.prisma.birthdayRewardClaim.findMany({ where: { customerId }, select: { year: true } });
    return new Set(rows.map((r) => r.year));
  }

  async findBirthDate(customerId: string): Promise<Date | null> {
    const row = await this.prisma.customer.findUnique({ where: { id: customerId }, select: { birthDate: true } });
    return row?.birthDate ?? null;
  }

  // Set-once: only fills an EMPTY birthday (returns false when one already exists), so it cannot be re-set to game the
  // once-a-year reward.
  async setBirthDateIfMissing(customerId: string, birthDate: Date): Promise<boolean> {
    const result = await this.prisma.customer.updateMany({ where: { id: customerId, birthDate: null }, data: { birthDate } });
    return result.count === 1;
  }

  // Cashback wallet = aggregates of its ledger (no cached wallet row).
  async cashbackTotals(db: Db, customerId: string): Promise<{ earned: number; spent: number; balance: number }> {
    const rows = await db.cashbackTransaction.groupBy({ by: ['type'], where: { customerId }, _sum: { amountMinor: true } });
    const sum = (type: string) => rows.find((r) => r.type === type)?._sum.amountMinor ?? 0;
    const earned = sum('EARN');
    const spent = sum('SPEND');
    return { earned, spent, balance: earned - spent };
  }

  cashbackWallet(customerId: string) {
    return this.cashbackTotals(this.prisma, customerId);
  }

  // --- background sync candidates -------------------------------------------------------------------------------------

  // Customers that have a qualifying purchase on/after `sinceMs` with no LoyaltyAccrual yet (anti-join, bounded).
  async customersWithUnprocessedPurchases(sinceMs: number, limit: number): Promise<string[]> {
    const [cup, pos] = await Promise.all([
      this.prisma.$queryRaw<{ customerId: string }[]>(Prisma.sql`
        SELECT DISTINCT o."customerId" AS customerId FROM "orders" o
        LEFT JOIN "loyalty_accruals" a ON a."sourceType" = 'CUP_ORDER' AND a."sourceId" = o."id"
        WHERE a."id" IS NULL AND o."status" IN (${Prisma.join(STATUSES)}) AND o."createdAt" >= ${sinceMs} LIMIT ${limit}`),
      this.prisma.$queryRaw<{ customerId: string }[]>(Prisma.sql`
        SELECT DISTINCT t."customerId" AS customerId FROM "poster_imported_transactions" t
        LEFT JOIN "loyalty_accruals" a ON a."sourceType" = 'POS' AND a."sourceId" = t."id"
        WHERE a."id" IS NULL AND t."status" = 'IMPORTED' AND t."occurredAt" >= ${sinceMs} LIMIT ${limit}`),
    ]);
    return [...new Set([...cup, ...pos].map((r) => r.customerId))].slice(0, limit);
  }

  // --- writes (each takes a Db so callers can group them in one transaction) ------------------------------------------

  createAccrual(db: Db, data: Prisma.LoyaltyAccrualUncheckedCreateInput) {
    return db.loyaltyAccrual.create({ data });
  }

  createCashback(db: Db, data: Prisma.CashbackTransactionUncheckedCreateInput) {
    return db.cashbackTransaction.create({ data });
  }

  createLevelUp(db: Db, data: Prisma.LoyaltyLevelUpUncheckedCreateInput) {
    return db.loyaltyLevelUp.create({ data });
  }

  createUnlock(db: Db, data: Prisma.CustomerAchievementUncheckedCreateInput) {
    return db.customerAchievement.create({ data });
  }

  createBirthdayClaim(db: Db, data: Prisma.BirthdayRewardClaimUncheckedCreateInput) {
    return db.birthdayRewardClaim.create({ data });
  }
}
