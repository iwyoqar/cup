import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface PosPurchaseSummary {
  occurredAt: string;
  branchName: string;
  totalMinor: number;
  lines: { productName: string | null; quantity: number }[];
}

export interface PosCustomerSummary {
  count: number;
  totalMinor: number;
  firstAt: Date | null;
  lastAt: Date | null;
  // Per-branch purchase counts (branchId is never null on an imported row) — the unified favorite-branch input.
  branches: { branchId: string; count: number; mostRecentAt: Date }[];
  recent: PosPurchaseSummary[];
}

// Read-only view of a customer's IMPORTED Poster POS purchases. A separate metrics source: it never changes the
// meaning of the existing CUP-order metrics (CustomerMetricsService). Only status IMPORTED counts — UNRESOLVED receipts
// are kept for audit but excluded here. Bounded: two aggregates + one 5-row list, whatever the customer's history size.
@Injectable()
export class PosterImportedActivityService {
  constructor(private readonly prisma: PrismaService) {}

  async getForCustomer(customerId: string): Promise<PosCustomerSummary> {
    const where = { customerId, status: 'IMPORTED' };
    const [aggregate, byBranch, recent] = await Promise.all([
      this.prisma.posterImportedTransaction.aggregate({ where, _count: { _all: true }, _sum: { totalMinor: true }, _min: { occurredAt: true }, _max: { occurredAt: true } }),
      this.prisma.posterImportedTransaction.groupBy({ by: ['branchId'], where, _count: { _all: true }, _max: { occurredAt: true } }),
      this.prisma.posterImportedTransaction.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        take: 5,
        include: { branch: { select: { name: true } }, items: { orderBy: { lineIndex: 'asc' }, include: { product: { select: { name: true } } } } },
      }),
    ]);
    return {
      count: aggregate._count._all,
      totalMinor: aggregate._sum.totalMinor ?? 0,
      firstAt: aggregate._min.occurredAt,
      lastAt: aggregate._max.occurredAt,
      branches: byBranch.map((b) => ({ branchId: b.branchId, count: b._count._all, mostRecentAt: b._max.occurredAt as Date })),
      recent: recent.map((t) => ({
        occurredAt: t.occurredAt.toISOString(),
        branchName: t.branch.name,
        totalMinor: t.totalMinor,
        lines: t.items.map((i) => ({ productName: i.product?.name ?? null, quantity: i.quantity })),
      })),
    };
  }
}
