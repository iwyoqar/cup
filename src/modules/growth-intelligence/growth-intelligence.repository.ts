import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { epochMsCastSql } from '../../common/prisma/sql-dialect';
import { CUSTOMER_METRICS_ORDER_STATUSES } from '../customer-metrics/customer-metrics-order-statuses';
import { CustomerAggregate } from './growth-intelligence.rules';

const ORDER_STATUSES = [...CUSTOMER_METRICS_ORDER_STATUSES];
const MAX_IN = 500;
// SQLite can hand a window-function / CASE result back as text, so every numeric column is coerced explicitly.
const num = (v: bigint | number | string | null | undefined): number => (v === null || v === undefined ? 0 : Number(v));
const numOrNull = (v: bigint | number | string | null | undefined): number | null => (v === null || v === undefined ? null : num(v));

export interface AggregateQuery {
  customerIds?: string[]; // omitted = every purchasing customer
  branchId?: string | null; // omitted / null = all branches (including CUP orders with no branch)
  lookbackFrom: Date; // inclusive
  lookbackTo: Date; // exclusive
  highValueRevenue: number;
}

// Only Prisma / raw SQL for Growth Intelligence lives here. There is exactly ONE purchase aggregate (below) — RFM, lifecycle, signals, segment fields,
// Customer 360 and the Admin dashboard all read it, so the definitions can never drift apart.
@Injectable()
export class GrowthIntelligenceRepository {
  constructor(private readonly prisma: PrismaService) {}

  // The ONE bulk aggregate: one row per customer with at least one qualifying purchase, computed in the database in a single pass over the union
  // of the two canonical sources — qualifying CUP orders (CUSTOMER_METRICS_ORDER_STATUSES, by createdAt / branchId) and IMPORTED POS purchases
  // (by occurredAt / branchId). Pending, failed, cancelled, uncertain, unresolved and non-IMPORTED rows are excluded by the same predicates every
  // other module uses. Window functions give the 2nd purchase time and the moment lifetime revenue first reached the high-value threshold without
  // loading purchases into the application. A branch view only sees purchases at that branch (a customer whose activity has no mapped branch never
  // appears in one, but is included in "all branches").
  async aggregates(q: AggregateQuery): Promise<CustomerAggregate[]> {
    const ids = q.customerIds;
    if (ids && ids.length === 0) return [];
    if (ids && ids.length > MAX_IN) {
      // Too many ids for one IN list: aggregate everyone once and keep the requested ones (still ONE query, never one per customer).
      const wanted = new Set(ids);
      return (await this.aggregates({ ...q, customerIds: undefined })).filter((r) => wanted.has(r.customerId));
    }
    const idFilter = (col: string) => (ids ? Prisma.sql`AND ${Prisma.raw(col)} IN (${Prisma.join(ids)})` : Prisma.empty);
    const branch = (col: string) => (q.branchId ? Prisma.sql`AND ${Prisma.raw(col)} = ${q.branchId}` : Prisma.empty);
    const rows = await this.prisma.$queryRaw<
      { c: string; purchases: bigint | number; revenue: bigint | number | null; firstAt: bigint | number; lastAt: bigint | number; secondAt: bigint | number | null; highValueAt: bigint | number | null; lbPurchases: bigint | number | null; lbRevenue: bigint | number | null }[]
    >(Prisma.sql`
      WITH p AS (
        SELECT "customerId" AS c, ${epochMsCastSql('"createdAt"')} AS t, "totalMinor" AS a
          FROM "orders" WHERE "status" IN (${Prisma.join(ORDER_STATUSES)}) ${branch('"branchId"')} ${idFilter('"customerId"')}
        UNION ALL
        SELECT "customerId", ${epochMsCastSql('"occurredAt"')}, "totalMinor"
          FROM "poster_imported_transactions" WHERE "status" = 'IMPORTED' ${branch('"branchId"')} ${idFilter('"customerId"')}
      ), r AS (
        SELECT c, t, a,
               ROW_NUMBER() OVER (PARTITION BY c ORDER BY t) AS rn,
               SUM(a) OVER (PARTITION BY c ORDER BY t ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cum
          FROM p
      )
      SELECT c, COUNT(*) AS purchases, SUM(a) AS revenue, MIN(t) AS firstAt, MAX(t) AS lastAt,
             MAX(CASE WHEN rn = 2 THEN t END) AS secondAt,
             MIN(CASE WHEN cum >= ${q.highValueRevenue} THEN t END) AS highValueAt,
             SUM(CASE WHEN t >= ${q.lookbackFrom.getTime()} AND t < ${q.lookbackTo.getTime()} THEN 1 ELSE 0 END) AS lbPurchases,
             SUM(CASE WHEN t >= ${q.lookbackFrom.getTime()} AND t < ${q.lookbackTo.getTime()} THEN a ELSE 0 END) AS lbRevenue
        FROM r GROUP BY c`);
    return rows.map((r) => ({
      customerId: r.c,
      purchases: num(r.purchases),
      revenue: num(r.revenue),
      firstAt: num(r.firstAt),
      lastAt: num(r.lastAt),
      secondAt: numOrNull(r.secondAt),
      highValueAt: numOrNull(r.highValueAt),
      lookbackPurchases: num(r.lbPurchases),
      lookbackRevenue: num(r.lbRevenue),
    }));
  }

  customerCount(): Promise<number> {
    return this.prisma.customer.count();
  }

  async customerNames(ids: string[]): Promise<Map<string, string | null>> {
    const out = new Map<string, string | null>();
    for (let i = 0; i < ids.length; i += MAX_IN) {
      const rows = await this.prisma.customer.findMany({ where: { id: { in: ids.slice(i, i + MAX_IN) } }, select: { id: true, displayName: true } });
      for (const r of rows) out.set(r.id, r.displayName);
    }
    return out;
  }

  // Customers that have a birthday on file (a date-only value the customer set themselves). Bounded by the customers who chose to set one.
  // Phase 26: isActive: true — a deactivated customer no longer generates a BIRTHDAY_UPCOMING signal/opportunity.
  async birthdays(ids?: string[]): Promise<{ customerId: string; birthDate: Date }[]> {
    const rows = await this.prisma.customer.findMany({ where: { isActive: true, birthDate: { not: null }, ...(ids && ids.length <= MAX_IN ? { id: { in: ids } } : {}) }, select: { id: true, birthDate: true } });
    return rows.map((r) => ({ customerId: r.id, birthDate: r.birthDate as Date }));
  }

  // Referrals that qualified inside the window (bounded by the window, not by the customer count).
  async qualifiedReferralsSince(from: Date): Promise<{ referralId: string; referrerCustomerId: string; qualifiedAt: Date }[]> {
    const rows = await this.prisma.referral.findMany({
      where: { status: { in: ['QUALIFIED', 'REWARDED'] }, qualifiedAt: { gte: from } },
      select: { id: true, referrerCustomerId: true, qualifiedAt: true },
      orderBy: { qualifiedAt: 'desc' },
      take: 5000,
    });
    return rows.map((r) => ({ referralId: r.id, referrerCustomerId: r.referrerCustomerId, qualifiedAt: r.qualifiedAt as Date }));
  }

  async levelUpsSince(from: Date): Promise<{ customerId: string; levelCode: string; levelName: string; reachedAt: Date }[]> {
    return this.prisma.loyaltyLevelUp.findMany({ where: { reachedAt: { gte: from } }, select: { customerId: true, levelCode: true, levelName: true, reachedAt: true }, orderBy: { reachedAt: 'desc' }, take: 5000 });
  }

  findActiveBranch(branchId: string) {
    return this.prisma.branch.findFirst({ where: { id: branchId, isActive: true }, select: { id: true, name: true } });
  }

  findBranch(branchId: string) {
    return this.prisma.branch.findUnique({ where: { id: branchId }, select: { id: true, name: true } });
  }

  listActiveBranches() {
    return this.prisma.branch.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
  }
}
