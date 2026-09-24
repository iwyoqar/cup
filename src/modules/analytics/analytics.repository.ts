import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { dateTimeParam, dayBucketSql } from '../../common/prisma/sql-dialect';
import { CUSTOMER_METRICS_ORDER_STATUSES } from '../customer-metrics/customer-metrics-order-statuses';

export interface QueryRange {
  from: Date; // inclusive
  to: Date; // exclusive
  branchId: string | null;
}

export interface SourceTotals {
  count: number;
  revenue: number;
}

export interface DailyRow {
  day: string;
  revenue: number;
  orders: number;
}

export interface ProductAggregate {
  productId: string;
  quantity: number;
  revenue: number;
}

// The QUALIFYING CUP sales are exactly the statuses the existing CustomerMetrics already counts, so analytics and Customer 360
// agree on what an order is. Imported POS purchases qualify only when IMPORTED (UNRESOLVED rows never count).
const CUP_STATUSES = [...CUSTOMER_METRICS_ORDER_STATUSES];

// Phase 17 — read-only aggregate queries. ALL Prisma access for analytics lives here. Aggregation happens in the database;
// results are small (one row per day / per customer / per product), never one row per order.
@Injectable()
export class AnalyticsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // --- reference data -------------------------------------------------------------------------------------------

  findActiveBranches() {
    return this.prisma.branch.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
  }

  findBranch(branchId: string) {
    return this.prisma.branch.findUnique({ where: { id: branchId }, select: { id: true, name: true } });
  }

  async importedPosRowsExist(): Promise<boolean> {
    return (await this.prisma.posterImportedTransaction.count({ where: { status: 'IMPORTED' } })) > 0;
  }

  // --- totals ---------------------------------------------------------------------------------------------------

  async cupTotals(range: QueryRange): Promise<SourceTotals> {
    const r = await this.prisma.order.aggregate({ where: this.cupWhere(range), _count: { _all: true }, _sum: { totalMinor: true } });
    return { count: r._count._all, revenue: r._sum.totalMinor ?? 0 };
  }

  async posTotals(range: QueryRange): Promise<SourceTotals> {
    const r = await this.prisma.posterImportedTransaction.aggregate({ where: this.posWhere(range), _count: { _all: true }, _sum: { totalMinor: true } });
    return { count: r._count._all, revenue: r._sum.totalMinor ?? 0 };
  }

  // Reports Phase A — the customer-less subset of posTotals above (same posWhere, plus customerId: null). Never a
  // second revenue calculation: callers derive "identified POS" by subtracting this from posTotals's own total.
  async posAnonymousTotals(range: QueryRange): Promise<SourceTotals> {
    const r = await this.prisma.posterImportedTransaction.aggregate({ where: { ...this.posWhere(range), customerId: null }, _count: { _all: true }, _sum: { totalMinor: true } });
    return { count: r._count._all, revenue: r._sum.totalMinor ?? 0 };
  }

  // --- customers ------------------------------------------------------------------------------------------------

  async cupCustomerIds(range: QueryRange): Promise<string[]> {
    const rows = await this.prisma.order.groupBy({ by: ['customerId'], where: this.cupWhere(range) });
    return rows.map((r) => r.customerId);
  }

  // customerId: { not: null } excludes anonymous imported receipts (owner decision, 2026-09-24 — see the model's own
  // schema comment) from the customer count; they still count fully toward revenue via posTotals above.
  async posCustomerIds(range: QueryRange): Promise<string[]> {
    const rows = await this.prisma.posterImportedTransaction.groupBy({ by: ['customerId'], where: { ...this.posWhere(range), customerId: { not: null } } });
    return rows.map((r) => r.customerId as string);
  }

  // Which of `customerIds` had a qualifying sale STRICTLY BEFORE `before` (any branch — "returning" means returning to the business).
  async cupCustomersWithSaleBefore(customerIds: string[], before: Date): Promise<string[]> {
    if (customerIds.length === 0) return [];
    const rows = await this.prisma.order.groupBy({ by: ['customerId'], where: { status: { in: CUP_STATUSES }, customerId: { in: customerIds }, createdAt: { lt: before } } });
    return rows.map((r) => r.customerId);
  }

  async posCustomersWithSaleBefore(customerIds: string[], before: Date): Promise<string[]> {
    if (customerIds.length === 0) return [];
    const rows = await this.prisma.posterImportedTransaction.groupBy({ by: ['customerId'], where: { status: 'IMPORTED', customerId: { in: customerIds }, occurredAt: { lt: before } } });
    return rows.map((r) => r.customerId as string); // customerId: { in: customerIds } already excludes null at the DB level
  }

  // --- daily revenue --------------------------------------------------------------------------------------------
  // The one place non-portable SQL is used: grouping by business-local calendar day. Prisma cannot group by a date part, and the two
  // supported dialects store DateTime completely differently (SQLite: integer epoch-ms; PostgreSQL: native UTC timestamp) — see
  // src/common/prisma/sql-dialect.ts for why this needs a real per-dialect expression, not a syntax-only translation.
  // (If the database ever moves off these two dialects, only these two queries — via that shared helper — change.)

  async cupDailyRevenue(range: QueryRange, offsetMinutes: number): Promise<DailyRow[]> {
    const branch = range.branchId ? Prisma.sql`AND "branchId" = ${range.branchId}` : Prisma.empty;
    const day = dayBucketSql('"createdAt"', offsetMinutes);
    const rows = await this.prisma.$queryRaw<{ day: string; revenue: bigint | number | null }[]>(Prisma.sql`
      SELECT ${day} AS day, SUM("totalMinor") AS revenue
      FROM "orders"
      WHERE "status" IN (${Prisma.join(CUP_STATUSES)}) AND "createdAt" >= ${dateTimeParam(range.from)} AND "createdAt" < ${dateTimeParam(range.to)} ${branch}
      GROUP BY day`);
    return rows.map((r) => ({ day: r.day, revenue: Number(r.revenue ?? 0) }));
  }

  async posDailyRevenue(range: QueryRange, offsetMinutes: number): Promise<DailyRow[]> {
    const branch = range.branchId ? Prisma.sql`AND "branchId" = ${range.branchId}` : Prisma.empty;
    const day = dayBucketSql('"occurredAt"', offsetMinutes);
    const rows = await this.prisma.$queryRaw<{ day: string; revenue: bigint | number | null }[]>(Prisma.sql`
      SELECT ${day} AS day, SUM("totalMinor") AS revenue
      FROM "poster_imported_transactions"
      WHERE "status" = 'IMPORTED' AND "occurredAt" >= ${dateTimeParam(range.from)} AND "occurredAt" < ${dateTimeParam(range.to)} ${branch}
      GROUP BY day`);
    return rows.map((r) => ({ day: r.day, revenue: Number(r.revenue ?? 0) }));
  }

  // --- products -------------------------------------------------------------------------------------------------

  // PAID units only (isRewardItem = false): a free reward unit carries no revenue and is not a sale of the product.
  async cupProducts(range: QueryRange): Promise<ProductAggregate[]> {
    const rows = await this.prisma.orderItem.groupBy({
      by: ['productId'],
      where: { isRewardItem: false, order: this.cupWhere(range) },
      _sum: { quantity: true, totalPriceMinor: true },
    });
    return rows.map((r) => ({ productId: r.productId, quantity: r._sum.quantity ?? 0, revenue: r._sum.totalPriceMinor ?? 0 }));
  }

  // POS product revenue = Poster's own line paid amount (already converted by the Poster money adapter at import time).
  async posProducts(range: QueryRange): Promise<ProductAggregate[]> {
    const rows = await this.prisma.posterImportedTransactionItem.groupBy({
      by: ['productId'],
      where: { productId: { not: null }, transaction: this.posWhere(range) },
      _sum: { quantity: true, posterPayedSumMinor: true },
    });
    return rows.map((r) => ({ productId: r.productId as string, quantity: r._sum.quantity ?? 0, revenue: r._sum.posterPayedSumMinor ?? 0 }));
  }

  async productNames(productIds: string[]): Promise<Map<string, string>> {
    if (productIds.length === 0) return new Map();
    const rows = await this.prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true } });
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  // --- shared filters -------------------------------------------------------------------------------------------

  private cupWhere(range: QueryRange): Prisma.OrderWhereInput {
    return { status: { in: CUP_STATUSES }, createdAt: { gte: range.from, lt: range.to }, ...(range.branchId ? { branchId: range.branchId } : {}) };
  }

  // branchId is required (non-null) on imported POS rows, so an unmapped branch can never appear under any branch or in "all".
  private posWhere(range: QueryRange): Prisma.PosterImportedTransactionWhereInput {
    return { status: 'IMPORTED', occurredAt: { gte: range.from, lt: range.to }, ...(range.branchId ? { branchId: range.branchId } : {}) };
  }
}
