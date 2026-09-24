import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { dateTimeParam } from '../../common/prisma/sql-dialect';
import { buildSearchWhere } from '../admin-customers/admin-customers.repository';
import { QueryRange } from '../analytics/analytics.repository';
import { CUSTOMER_METRICS_ORDER_STATUSES } from '../customer-metrics/customer-metrics-order-statuses';

export interface CustomerSourceAggregate {
  customerId: string;
  purchases: number;
  revenue: number;
  first: Date | null;
  last: Date | null;
}

const CUP_STATUSES = [...CUSTOMER_METRICS_ORDER_STATUSES];
const ID_CHUNK = 500; // keeps every `IN (...)` well under both SQLite's and PostgreSQL's bind-parameter limits

// Reports Phase D1 — grouped, per-CUSTOMER purchase aggregates (one row per customer, never per order). The qualifying
// filters are EXACTLY AnalyticsRepository's private cupWhere/posWhere (canonical CUP statuses; POS status IMPORTED;
// createdAt/occurredAt in range; explicit branchId) — restated here because those helpers are private and Analytics is
// not modified. Anonymous POS receipts (customerId NULL) never enter a per-customer figure.
@Injectable()
export class ReportsCustomersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async cupByCustomer(range: QueryRange): Promise<CustomerSourceAggregate[]> {
    const rows = await this.prisma.order.groupBy({
      by: ['customerId'],
      where: { status: { in: CUP_STATUSES }, createdAt: { gte: range.from, lt: range.to }, ...(range.branchId ? { branchId: range.branchId } : {}) },
      _count: { _all: true },
      _sum: { totalMinor: true },
      _min: { createdAt: true },
      _max: { createdAt: true },
    });
    return rows.map((r) => ({ customerId: r.customerId, purchases: r._count._all, revenue: r._sum.totalMinor ?? 0, first: r._min.createdAt, last: r._max.createdAt }));
  }

  async posByCustomer(range: QueryRange): Promise<CustomerSourceAggregate[]> {
    const rows = await this.prisma.posterImportedTransaction.groupBy({
      by: ['customerId'],
      where: { ...this.posWhere(range), customerId: { not: null } },
      _count: { _all: true },
      _sum: { totalMinor: true },
      _min: { occurredAt: true },
      _max: { occurredAt: true },
    });
    return rows.map((r) => ({ customerId: r.customerId as string, purchases: r._count._all, revenue: r._sum.totalMinor ?? 0, first: r._min.occurredAt, last: r._max.occurredAt }));
  }

  // Units = item quantity. CUP: paid lines only (isRewardItem = false), the same rule as the Products report; POS: every
  // imported line of the receipt. One grouped query per source.
  async unitsByCustomer(range: QueryRange): Promise<Map<string, number>> {
    const cupBranch = range.branchId ? Prisma.sql`AND o."branchId" = ${range.branchId}` : Prisma.empty;
    const posBranch = range.branchId ? Prisma.sql`AND t."branchId" = ${range.branchId}` : Prisma.empty;
    const [cup, pos] = await Promise.all([
      this.prisma.$queryRaw<{ customerId: string; units: bigint | number | null }[]>(Prisma.sql`
        SELECT o."customerId" AS "customerId", SUM(i."quantity") AS units
        FROM "order_items" i JOIN "orders" o ON o."id" = i."orderId"
        WHERE i."isRewardItem" = false AND o."status" IN (${Prisma.join(CUP_STATUSES)})
          AND o."createdAt" >= ${dateTimeParam(range.from)} AND o."createdAt" < ${dateTimeParam(range.to)} ${cupBranch}
        GROUP BY o."customerId"`),
      this.prisma.$queryRaw<{ customerId: string; units: bigint | number | null }[]>(Prisma.sql`
        SELECT t."customerId" AS "customerId", SUM(i."quantity") AS units
        FROM "poster_imported_transaction_items" i JOIN "poster_imported_transactions" t ON t."id" = i."transactionId"
        WHERE t."status" = 'IMPORTED' AND t."customerId" IS NOT NULL
          AND t."occurredAt" >= ${dateTimeParam(range.from)} AND t."occurredAt" < ${dateTimeParam(range.to)} ${posBranch}
        GROUP BY t."customerId"`),
    ]);
    const out = new Map<string, number>();
    for (const r of [...cup, ...pos]) out.set(r.customerId, (out.get(r.customerId) ?? 0) + Number(r.units ?? 0));
    return out;
  }

  // Customer-less POS receipts: units only (count/revenue come from AnalyticsRepository.posAnonymousTotals, unchanged).
  async anonymousPosUnits(range: QueryRange): Promise<number> {
    const r = await this.prisma.posterImportedTransactionItem.aggregate({ where: { transaction: { ...this.posWhere(range), customerId: null } }, _sum: { quantity: true } });
    return r._sum.quantity ?? 0;
  }

  // Which of `ids` match the Customer 360 search rule (name / Telegram username / phone digits). Chunked.
  async filterBySearch(ids: string[], search: string): Promise<Set<string>> {
    const out = new Set<string>();
    for (let i = 0; i < ids.length; i += ID_CHUNK) {
      const rows = await this.prisma.customer.findMany({ where: { id: { in: ids.slice(i, i + ID_CHUNK) }, ...buildSearchWhere(search) }, select: { id: true } });
      for (const r of rows) out.add(r.id);
    }
    return out;
  }

  // Identity for ONE page of rows (<= limit ids).
  async identities(ids: string[]): Promise<Map<string, { name: string | null; phone: string | null; isActive: boolean }>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.customer.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true, phone: true, isActive: true } });
    return new Map(rows.map((r) => [r.id, { name: r.displayName, phone: r.phone, isActive: r.isActive }]));
  }

  private posWhere(range: QueryRange): Prisma.PosterImportedTransactionWhereInput {
    return { status: 'IMPORTED', occurredAt: { gte: range.from, lt: range.to }, ...(range.branchId ? { branchId: range.branchId } : {}) };
  }
}
