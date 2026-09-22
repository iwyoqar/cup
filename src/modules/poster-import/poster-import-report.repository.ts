import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface HistoryFilters {
  since?: Date; // occurredAt >= since
  until?: Date; // occurredAt < until
  branchId?: string;
  status?: string;
  source?: string;
  customerQuery?: string; // substring of the customer's display name
}

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

// Phase 19 — READ-ONLY queries behind the spot-mapping report, the data-quality report and the import history. Every method is a bounded aggregate or a
// paginated list; nothing loops per row and nothing here writes.
@Injectable()
export class PosterImportReportRepository {
  constructor(private readonly prisma: PrismaService) {}

  branchesWithUsage() {
    return this.prisma.branch.findMany({
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true, posterSpotId: true, isActive: true, _count: { select: { orders: true, posterImportedTransactions: true } } },
    });
  }

  // posterSpotId is @unique so this is always empty — it is checked anyway so the report states a fact rather than an assumption.
  async duplicateSpotIds(): Promise<number[]> {
    const rows = await this.prisma.branch.groupBy({ by: ['posterSpotId'], _count: { _all: true } });
    return rows.filter((r) => r._count._all > 1).map((r) => r.posterSpotId);
  }

  async importedStats() {
    const [byStatus, unresolvedReasons, imported, perBranch, itemLines, emptyImported, span] = await Promise.all([
      this.prisma.posterImportedTransaction.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.posterImportedTransaction.groupBy({ by: ['unresolvedReason'], where: { status: 'UNRESOLVED' }, _count: { _all: true } }),
      this.prisma.posterImportedTransaction.aggregate({ where: { status: 'IMPORTED' }, _sum: { totalMinor: true, paidMinor: true }, _count: { _all: true } }),
      this.prisma.posterImportedTransaction.groupBy({ by: ['branchId'], where: { status: 'IMPORTED' }, _count: { _all: true }, _sum: { totalMinor: true } }),
      this.prisma.$queryRaw<{ mapped: bigint | number | null; unmapped: bigint | number | null }[]>(Prisma.sql`
        SELECT SUM(CASE WHEN i."productId" IS NOT NULL THEN 1 ELSE 0 END) AS mapped, SUM(CASE WHEN i."productId" IS NULL THEN 1 ELSE 0 END) AS unmapped
          FROM "poster_imported_transaction_items" i JOIN "poster_imported_transactions" t ON t."id" = i."transactionId" WHERE t."status" = 'IMPORTED'`),
      this.prisma.$queryRaw<{ n: bigint | number }[]>(Prisma.sql`
        SELECT COUNT(*) AS n FROM "poster_imported_transactions" t WHERE t."status" = 'IMPORTED' AND NOT EXISTS (SELECT 1 FROM "poster_imported_transaction_items" i WHERE i."transactionId" = t."id")`),
      this.prisma.posterImportedTransaction.aggregate({ where: { status: 'IMPORTED' }, _min: { occurredAt: true, importedAt: true }, _max: { occurredAt: true, importedAt: true } }),
    ]);
    return {
      byStatus: byStatus.map((r) => ({ status: r.status, count: r._count._all })),
      unresolvedReasons: unresolvedReasons.map((r) => ({ reason: r.unresolvedReason ?? 'UNKNOWN', count: r._count._all })),
      imported: { count: imported._count._all, totalMinor: imported._sum.totalMinor ?? 0, paidMinor: imported._sum.paidMinor ?? 0 },
      perBranch: perBranch.map((r) => ({ branchId: r.branchId, count: r._count._all, totalMinor: r._sum.totalMinor ?? 0 })),
      itemLines: { mapped: num(itemLines[0]?.mapped), unmapped: num(itemLines[0]?.unmapped) },
      importedWithoutItems: num(emptyImported[0]?.n),
      span: { firstOccurredAt: span._min.occurredAt, lastOccurredAt: span._max.occurredAt, firstImportedAt: span._min.importedAt, lastImportedAt: span._max.importedAt },
    };
  }

  async customerLinkStats(): Promise<{ total: number; linkedToPoster: number }> {
    const [total, linked] = await Promise.all([this.prisma.customer.count(), this.prisma.customer.count({ where: { posterClientId: { not: null } } })]);
    return { total, linkedToPoster: linked };
  }

  // Customer / loyalty / reward / referral events that carry NO purchase link. They stay in all-branches numbers and are never given a branch (Phase 18 rule).
  async unattributedEvents() {
    const [ledger, redemptions, promotions, referrals] = await Promise.all([
      this.prisma.$queryRaw<{ rows: bigint | number; points: bigint | number | null }[]>(Prisma.sql`SELECT COUNT(*) AS rows, SUM("points") AS points FROM "loyalty_transactions" WHERE "orderId" IS NULL`),
      this.prisma.$queryRaw<{ n: bigint | number }[]>(Prisma.sql`SELECT COUNT(*) AS n FROM "reward_redemptions" WHERE "orderId" IS NULL`),
      this.prisma.$queryRaw<{ n: bigint | number }[]>(Prisma.sql`SELECT COUNT(*) AS n FROM "promotion_redemptions" WHERE "orderId" IS NULL`),
      this.prisma.$queryRaw<{ total: bigint | number; resolvable: bigint | number | null }[]>(Prisma.sql`
        SELECT COUNT(*) AS total,
               SUM(CASE WHEN (r."qualifyingPurchaseKey" LIKE 'CUP_ORDER:%' AND EXISTS (SELECT 1 FROM "orders" o WHERE o."id" = substr(r."qualifyingPurchaseKey", 11)))
                          OR (r."qualifyingPurchaseKey" LIKE 'POS:%' AND EXISTS (SELECT 1 FROM "poster_imported_transactions" t WHERE t."id" = substr(r."qualifyingPurchaseKey", 5)))
                        THEN 1 ELSE 0 END) AS resolvable
          FROM "referrals" r WHERE r."status" IN ('QUALIFIED', 'REWARDED')`),
    ]);
    const total = num(referrals[0]?.total);
    return {
      loyaltyLedgerWithoutOrder: { rows: num(ledger[0]?.rows), points: num(ledger[0]?.points) },
      rewardRedemptionsWithoutOrder: num(redemptions[0]?.n),
      promotionRedemptionsWithoutOrder: num(promotions[0]?.n),
      referrals: { qualified: total, attributedToAPurchase: num(referrals[0]?.resolvable), unattributed: total - num(referrals[0]?.resolvable) },
    };
  }

  // A page of the imported-transaction table (the import audit trail). Admin-facing: the customer appears by display name only.
  async history(filters: HistoryFilters, skip: number, take: number) {
    const where: Prisma.PosterImportedTransactionWhereInput = {
      ...(filters.since || filters.until ? { occurredAt: { ...(filters.since ? { gte: filters.since } : {}), ...(filters.until ? { lt: filters.until } : {}) } } : {}),
      ...(filters.branchId ? { branchId: filters.branchId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.source ? { source: filters.source } : {}),
      ...(filters.customerQuery ? { customer: { displayName: { contains: filters.customerQuery } } } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.posterImportedTransaction.count({ where }),
      this.prisma.posterImportedTransaction.findMany({
        where,
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
        select: {
          posterTransactionId: true,
          occurredAt: true,
          importedAt: true,
          status: true,
          unresolvedReason: true,
          source: true,
          totalMinor: true,
          paidMinor: true,
          posterSpotId: true,
          branch: { select: { name: true } },
          customer: { select: { displayName: true } },
          _count: { select: { items: true } },
        },
      }),
    ]);
    return { total, rows };
  }
}
