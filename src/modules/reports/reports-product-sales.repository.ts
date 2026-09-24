import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { QueryRange } from '../analytics/analytics.repository';

export interface ProductMeta {
  id: string;
  name: string;
  posterProductId: string;
  categoryId: string;
  categoryName: string;
  posterCategoryId: string;
  categoryActive: boolean;
  hasRecipe: boolean;
  theoreticalCostMinor: number | null;
}

export interface UnmappedPosLine {
  posterProductId: string;
  quantity: number;
  revenueMinor: number;
}

// Reports Phase C1/C2 — the few read-only lookups the product/category reports need that AnalyticsRepository does not
// already expose. Revenue/quantity per CUP product is NOT computed here: that stays AnalyticsRepository.cupProducts /
// posProducts (the same aggregates Analytics' Top Products and Finance P&L COGS use), called unchanged.
@Injectable()
export class ReportsProductSalesRepository {
  constructor(private readonly prisma: PrismaService) {}

  // One query for every product that had sales — never per product.
  async productsMeta(productIds: string[]): Promise<Map<string, ProductMeta>> {
    if (productIds.length === 0) return new Map();
    const rows = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true, posterProductId: true, categoryId: true, hasRecipe: true, theoreticalCostMinor: true, category: { select: { name: true, posterCategoryId: true, isActive: true } } },
    });
    return new Map(
      rows.map((r) => [
        r.id,
        {
          id: r.id,
          name: r.name,
          posterProductId: r.posterProductId,
          categoryId: r.categoryId,
          categoryName: r.category.name,
          posterCategoryId: r.category.posterCategoryId,
          categoryActive: r.category.isActive,
          hasRecipe: r.hasRecipe,
          theoreticalCostMinor: r.theoreticalCostMinor,
        },
      ]),
    );
  }

  // Imported POS lines whose Poster product has no CUP Product (productId NULL — the import keeps the line and its
  // money rather than dropping it). AnalyticsRepository.posProducts deliberately excludes these; they are surfaced
  // here, grouped by Poster product id, so product revenue can be reconciled to Analytics revenue. Same qualifying
  // filter as AnalyticsRepository's private posWhere (IMPORTED, occurredAt in range, optional branchId) — kept in sync
  // by hand because that helper is private and Analytics is not modified in this phase.
  async unmappedPosLines(range: QueryRange): Promise<UnmappedPosLine[]> {
    const transaction: Prisma.PosterImportedTransactionWhereInput = { status: 'IMPORTED', occurredAt: { gte: range.from, lt: range.to }, ...(range.branchId ? { branchId: range.branchId } : {}) };
    const rows = await this.prisma.posterImportedTransactionItem.groupBy({
      by: ['posterProductId'],
      where: { productId: null, transaction },
      _sum: { quantity: true, posterPayedSumMinor: true },
    });
    return rows.map((r) => ({ posterProductId: r.posterProductId, quantity: r._sum.quantity ?? 0, revenueMinor: r._sum.posterPayedSumMinor ?? 0 }));
  }

  // Used as a filter list and to map Poster category ids -> CUP categories via Category.posterCategoryId (never by name).
  listCategories() {
    return this.prisma.category.findMany({ select: { id: true, name: true, posterCategoryId: true, isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
  }

  // Poster product id -> CUP Product (Product.posterProductId is unique). Used only to decide which Poster reference
  // rows are unmapped; one query over the ids Poster returned.
  async productIdsByPosterId(posterProductIds: string[]): Promise<Map<string, string>> {
    if (posterProductIds.length === 0) return new Map();
    const rows = await this.prisma.product.findMany({ where: { posterProductId: { in: posterProductIds } }, select: { id: true, posterProductId: true } });
    return new Map(rows.map((r) => [r.posterProductId, r.id]));
  }
}
