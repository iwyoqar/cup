import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AbcClass, classifyAbc } from './abc-classification';
import { ProductSalesQuery, ProductSalesRow, ReportsProductSalesService } from './reports-product-sales.service';
import { ReportsProductSalesRepository } from './reports-product-sales.repository';

export interface AbcReportQuery extends ProductSalesQuery {
  categoryId?: string;
}

export interface ReportsAbcRow {
  classification: AbcClass;
  productId: string;
  posterProductId: string; // reference only
  productName: string;
  categoryId: string;
  categoryName: string;
  units: number;
  revenueMinor: number;
  revenueSharePercent: number;
  cumulativeRevenueSharePercent: number;
  theoreticalCOGSMinor: number | null; // shown only; never used for the classification
  theoreticalGrossProfitMinor: number | null;
}

export interface ReportsAbcOverview {
  period: { key: ProductSalesQuery['period']; startDate: string; endDate: string; timezoneOffsetMinutes: number };
  branch: { id: string; name: string } | null;
  category: { id: string; name: string } | null;
  source: ProductSalesQuery['source'];
  filters: { branches: { id: string; name: string }[]; categories: { id: string; name: string; isActive: boolean }[] };
  summary: {
    productsWithSales: number; // products with positive revenue = the classified population
    productRevenueMinor: number; // sum over that population
    classes: { classification: AbcClass; products: number; revenueMinor: number; revenueSharePercent: number }[];
    zeroSalesCatalogProducts: number; // active catalog products (in the category filter) with no positive revenue in the period
    nonPositiveRevenueProducts: number; // products that sold but had revenue <= 0 (excluded from ABC)
    nonPositiveRevenueMinor: number;
  };
  rows: ReportsAbcRow[];
  unmappedPos: { products: number; revenueMinor: number }; // POS lines with no CUP product — cannot be classified (only when no category filter)
  reconciliation: { productReportRevenueMinor: number; abcRevenueMinor: number; excludedNonPositiveMinor: number; unmappedPosRevenueMinor: number };
  notes: string[];
}

// Reports Phase G — ABC analysis. Classifies the SAME per-product aggregate the Products report uses
// (ReportsProductSalesService: canonical CUP order lines + independent imported POS lines, anonymous included), after
// applying period / branch / source / category — so the population, and therefore each product's class, changes with the
// filters by design. Revenue only: theoretical cost is displayed, never used to classify; Poster profit is never read.
// Nothing is persisted or cached.
@Injectable()
export class ReportsAbcService {
  constructor(
    private readonly productSales: ReportsProductSalesService,
    private readonly repository: ReportsProductSalesRepository,
    private readonly prisma: PrismaService,
  ) {}

  async getAbc(query: AbcReportQuery, now: Date = new Date()): Promise<ReportsAbcOverview> {
    const categories = await this.repository.listCategories();
    const category = query.categoryId ? categories.find((c) => c.id === query.categoryId) : undefined;
    if (query.categoryId && !category) throw new BadRequestException('Unknown category.');

    const agg = await this.productSales.aggregate(query, now);
    const population: ProductSalesRow[] = category ? agg.products.filter((p) => p.categoryId === category.id) : agg.products;
    const positive = population.filter((p) => p.revenueMinor > 0);
    const nonPositive = population.filter((p) => p.revenueMinor <= 0);
    const byId = new Map(positive.map((p) => [p.productId, p]));

    const classified = classifyAbc(positive.map((p) => ({ productId: p.productId, revenueMinor: p.revenueMinor })));
    const total = classified.reduce((s, r) => s + r.revenueMinor, 0);
    const rows: ReportsAbcRow[] = classified.map((r) => {
      const p = byId.get(r.productId)!;
      return {
        classification: r.classification,
        productId: p.productId,
        posterProductId: p.posterProductId,
        productName: p.productName,
        categoryId: p.categoryId,
        categoryName: p.categoryName,
        units: p.quantity,
        revenueMinor: r.revenueMinor,
        revenueSharePercent: r.revenueSharePercent,
        cumulativeRevenueSharePercent: r.cumulativeRevenueSharePercent,
        theoreticalCOGSMinor: p.costing.theoreticalCOGSMinor,
        theoreticalGrossProfitMinor: p.costing.theoreticalGrossProfitMinor,
      };
    });

    const classes = (['A', 'B', 'C'] as const).map((c) => {
      const inClass = rows.filter((r) => r.classification === c);
      const revenueMinor = inClass.reduce((s, r) => s + r.revenueMinor, 0);
      return { classification: c, products: inClass.length, revenueMinor, revenueSharePercent: total > 0 ? Math.round((revenueMinor * 10_000) / total) / 100 : 0 };
    });

    // Active catalog products (in scope) that are not in the classified population. The id list is catalog-sized.
    const zeroSalesCatalogProducts = await this.prisma.product.count({ where: { isActive: true, ...(category ? { categoryId: category.id } : {}), id: { notIn: positive.map((p) => p.productId) } } });
    const unmappedRevenue = category ? 0 : agg.unmappedPos.reduce((s, u) => s + u.revenueMinor, 0);
    const productReportRevenue = population.reduce((s, p) => s + p.revenueMinor, 0);

    const notes = [
      'ABC classification is based on product revenue for the selected period and filters.',
      'ABC is not a profitability or inventory classification; theoretical cost columns are shown for reference only.',
      'A: products up to 80% of cumulative revenue (the product crossing 80% stays A). B: up to 95% (the product crossing 95% stays B). C: the rest. Equal revenue is ordered by product ID.',
    ];
    if (!category && agg.unmappedPos.length > 0) notes.push('Imported POS sales of Poster products with no CUP product cannot be classified and are shown separately.');
    if (nonPositive.length > 0) notes.push('Products whose revenue in the period is zero or negative are excluded from the classification.');

    return {
      period: { key: query.period, startDate: agg.range.startDate, endDate: agg.range.endDate, timezoneOffsetMinutes: agg.offsetMinutes },
      branch: agg.branch ? { id: agg.branch.id, name: agg.branch.name } : null,
      category: category ? { id: category.id, name: category.name } : null,
      source: query.source,
      filters: { branches: agg.branches, categories: categories.map((c) => ({ id: c.id, name: c.name, isActive: c.isActive })) },
      summary: {
        productsWithSales: rows.length,
        productRevenueMinor: total,
        classes,
        zeroSalesCatalogProducts,
        nonPositiveRevenueProducts: nonPositive.length,
        nonPositiveRevenueMinor: nonPositive.reduce((s, p) => s + p.revenueMinor, 0),
      },
      rows,
      unmappedPos: { products: category ? 0 : agg.unmappedPos.length, revenueMinor: unmappedRevenue },
      reconciliation: { productReportRevenueMinor: productReportRevenue, abcRevenueMinor: total, excludedNonPositiveMinor: productReportRevenue - total, unmappedPosRevenueMinor: unmappedRevenue },
      notes,
    };
  }
}
