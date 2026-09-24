import { Injectable } from '@nestjs/common';
import { PosterReportsService } from './poster-reports.service';
import { ProductSalesQuery, ProductSalesReconciliation, ReportsProductSalesService } from './reports-product-sales.service';
import { ReportsProductSalesRepository } from './reports-product-sales.repository';

export type CategorySortBy = 'revenue' | 'units' | 'productCount' | 'theoreticalCOGS' | 'theoreticalGrossProfit';

export interface CategoriesReportQuery extends ProductSalesQuery {
  sortBy: CategorySortBy;
  sortDirection: 'asc' | 'desc';
}

export interface CategoryCosting {
  productsWithRecipe: number;
  recipeCoveragePercent: number; // productsWithRecipe / productCount (distinct SOLD products), 1 decimal
  costedRevenueMinor: number; // revenue of the products with a recipe
  theoreticalCOGSMinor: number | null; // sum of quantity x unit cost over products WITH a recipe; null if none has one
  theoreticalGrossProfitMinor: number | null; // costedRevenue - theoreticalCOGS (products without a recipe are left out, not costed at 0)
}

export interface ReportsCategoryRow {
  categoryId: string;
  categoryName: string;
  posterCategoryId: string;
  categoryActive: boolean;
  isPosterTopScreen: boolean; // CUP's fallback category for Poster products filed under no Poster category (id "0")
  productCount: number; // distinct products SOLD in the period, not catalog size
  unitsSold: number;
  revenueMinor: number;
  averageUnitPriceMinor: number | null;
  source: { cupQuantity: number; cupRevenueMinor: number; posQuantity: number; posRevenueMinor: number };
  costing: CategoryCosting;
  posterReference: { quantity: number; revenueMinor: number } | null;
}

export interface ReportsUncategorized {
  productCount: number;
  unitsSold: number;
  revenueMinor: number;
  products: { posterProductId: string; quantity: number; revenueMinor: number }[];
}

export interface ReportsCategoriesOverview {
  period: { key: ProductSalesQuery['period']; startDate: string; endDate: string; timezoneOffsetMinutes: number };
  branch: { id: string; name: string } | null;
  source: ProductSalesQuery['source'];
  filters: { branches: { id: string; name: string }[] };
  summary: {
    categoriesWithSales: number; // CUP categories with qualifying sales (Uncategorized not counted)
    productsSold: number; // distinct sold products, Uncategorized ones included
    unitsSold: number; // all rows, Uncategorized included
    revenueMinor: number; // all rows, Uncategorized included — equals product revenue + unmapped POS revenue
    productsWithRecipe: number;
    recipeCoveragePercent: number | null;
    costedRevenueMinor: number;
    theoreticalCOGSMinor: number | null;
    theoreticalGrossProfitMinor: number | null;
  };
  categories: ReportsCategoryRow[];
  // POS lines whose Poster product has no CUP Product (and therefore no CUP category). null when there are none.
  uncategorized: ReportsUncategorized | null;
  posterReference: {
    available: boolean;
    unavailableReason: 'poster_unavailable' | 'malformed_response' | null;
    totalQuantity: number | null;
    totalRevenueMinor: number | null;
    unmapped: { posterCategoryId: string; name: string; quantity: number; revenueMinor: number }[]; // Poster categories with no CUP Category
  };
  reconciliation: ProductSalesReconciliation;
  warnings: string[];
}

const coverage = (withRecipe: number, total: number) => (total > 0 ? Math.round((withRecipe * 1000) / total) / 10 : 0);

// Reports Phase C2 — Categories. Groups ReportsProductSalesService's canonical per-product rows by Product.categoryId
// (the real CUP relation — never by name). No sales query of its own, so category totals always equal the Products
// report's totals for the same filters; POS lines with no CUP product form an explicit "Uncategorized" row instead of
// being dropped or assigned. Poster's dash.getCategoriesSales is read once as a separate reference, mapped only via
// Category.posterCategoryId, and never merged into CUP figures. Poster profit fields are never read.
@Injectable()
export class ReportsCategoriesService {
  constructor(
    private readonly productSales: ReportsProductSalesService,
    private readonly repository: ReportsProductSalesRepository,
    private readonly posterReports: PosterReportsService,
  ) {}

  async getCategories(query: CategoriesReportQuery, now: Date = new Date()): Promise<ReportsCategoriesOverview> {
    const agg = await this.productSales.aggregate(query, now);
    const ymd = (d: string) => d.replace(/-/g, '');
    const [poster, allCategories] = await Promise.all([
      this.posterReports.getCategoriesSalesReference(ymd(agg.range.startDate), ymd(agg.range.endDate), agg.branch ? String(agg.branch.posterSpotId) : undefined),
      this.repository.listCategories(),
    ]);
    const posterById = poster.available ? new Map(poster.rows.map((r) => [r.posterId, r])) : null;

    const byCategory = new Map<string, ReportsCategoryRow>();
    for (const p of agg.products) {
      let c = byCategory.get(p.categoryId);
      if (!c) {
        const ref = posterById?.get(p.posterCategoryId);
        c = {
          categoryId: p.categoryId,
          categoryName: p.categoryName,
          posterCategoryId: p.posterCategoryId,
          categoryActive: p.categoryActive,
          isPosterTopScreen: p.posterCategoryId === '0',
          productCount: 0,
          unitsSold: 0,
          revenueMinor: 0,
          averageUnitPriceMinor: null,
          source: { cupQuantity: 0, cupRevenueMinor: 0, posQuantity: 0, posRevenueMinor: 0 },
          costing: { productsWithRecipe: 0, recipeCoveragePercent: 0, costedRevenueMinor: 0, theoreticalCOGSMinor: null, theoreticalGrossProfitMinor: null },
          posterReference: ref ? { quantity: ref.quantity, revenueMinor: ref.revenueMinor } : null,
        };
        byCategory.set(p.categoryId, c);
      }
      c.productCount += 1;
      c.unitsSold += p.quantity;
      c.revenueMinor += p.revenueMinor;
      c.source.cupQuantity += p.source.cupQuantity;
      c.source.cupRevenueMinor += p.source.cupRevenueMinor;
      c.source.posQuantity += p.source.posQuantity;
      c.source.posRevenueMinor += p.source.posRevenueMinor;
      if (p.costing.theoreticalCOGSMinor !== null) {
        c.costing.productsWithRecipe += 1;
        c.costing.costedRevenueMinor += p.revenueMinor;
        c.costing.theoreticalCOGSMinor = (c.costing.theoreticalCOGSMinor ?? 0) + p.costing.theoreticalCOGSMinor;
      }
    }
    for (const c of byCategory.values()) {
      c.averageUnitPriceMinor = c.unitsSold > 0 ? Math.round(c.revenueMinor / c.unitsSold) : null;
      c.costing.recipeCoveragePercent = coverage(c.costing.productsWithRecipe, c.productCount);
      c.costing.theoreticalGrossProfitMinor = c.costing.theoreticalCOGSMinor !== null ? c.costing.costedRevenueMinor - c.costing.theoreticalCOGSMinor : null;
    }
    const categories = sortCategories([...byCategory.values()], query.sortBy, query.sortDirection);

    const uncategorized: ReportsUncategorized | null =
      agg.unmappedPos.length > 0
        ? {
            productCount: agg.unmappedPos.length,
            unitsSold: agg.unmappedPos.reduce((s, u) => s + u.quantity, 0),
            revenueMinor: agg.unmappedPos.reduce((s, u) => s + u.revenueMinor, 0),
            products: [...agg.unmappedPos].sort((a, b) => b.revenueMinor - a.revenueMinor),
          }
        : null;

    let productsWithRecipe = 0;
    let costedRevenueMinor = 0;
    let cogs: number | null = null;
    for (const c of categories) {
      productsWithRecipe += c.costing.productsWithRecipe;
      costedRevenueMinor += c.costing.costedRevenueMinor;
      if (c.costing.theoreticalCOGSMinor !== null) cogs = (cogs ?? 0) + c.costing.theoreticalCOGSMinor;
    }
    const productsSold = categories.reduce((s, c) => s + c.productCount, 0) + (uncategorized?.productCount ?? 0);

    const knownPosterCategoryIds = new Set(allCategories.map((c) => c.posterCategoryId));
    const posterReference: ReportsCategoriesOverview['posterReference'] = poster.available
      ? {
          available: true,
          unavailableReason: null,
          totalQuantity: Math.round(poster.rows.reduce((s, r) => s + r.quantity, 0) * 1000) / 1000,
          totalRevenueMinor: poster.rows.reduce((s, r) => s + r.revenueMinor, 0),
          unmapped: poster.rows.filter((r) => !knownPosterCategoryIds.has(r.posterId)).map((r) => ({ posterCategoryId: r.posterId, name: r.name, quantity: r.quantity, revenueMinor: r.revenueMinor })),
        }
      : { available: false, unavailableReason: poster.reason, totalQuantity: null, totalRevenueMinor: null, unmapped: [] };

    const warnings: string[] = [];
    if (uncategorized) warnings.push('"Uncategorized" holds imported POS sales of Poster products that have no CUP product, so no CUP category. They are counted, not assigned to a category.');
    const rec = agg.reconciliation;
    if (rec.cupOrderLevelDifferenceMinor !== 0 || rec.posReceiptLevelDifferenceMinor !== 0)
      warnings.push('Category revenue is the sum of sale lines; Analytics revenue is the sum of order/receipt totals. They differ by order-level amounts (e.g. promotion discounts, receipt-level adjustments) — see Reconciliation.');
    if (posterById?.has('0'))
      warnings.push("Poster reports some coffee drinks under its top-screen category (0); CUP files them under the coffee category (owner decision in catalog sync). Poster's per-category figures for those two categories are therefore not directly comparable with CUP's.");
    const ratio = query.source === 'all' && posterReference.totalRevenueMinor && rec.canonicalRevenueMinor > 0 ? posterReference.totalRevenueMinor / rec.canonicalRevenueMinor : null;
    if (ratio !== null && (ratio > 20 || ratio < 0.05)) warnings.push("Poster's category report total is more than 20x away from CUP revenue for the same period. This usually indicates a unit mismatch in Poster's report; treat Poster reference amounts as unverified.");

    return {
      period: { key: query.period, startDate: agg.range.startDate, endDate: agg.range.endDate, timezoneOffsetMinutes: agg.offsetMinutes },
      branch: agg.branch ? { id: agg.branch.id, name: agg.branch.name } : null,
      source: query.source,
      filters: { branches: agg.branches },
      summary: {
        categoriesWithSales: categories.length,
        productsSold,
        unitsSold: categories.reduce((s, c) => s + c.unitsSold, 0) + (uncategorized?.unitsSold ?? 0),
        revenueMinor: categories.reduce((s, c) => s + c.revenueMinor, 0) + (uncategorized?.revenueMinor ?? 0),
        productsWithRecipe,
        recipeCoveragePercent: productsSold > 0 ? coverage(productsWithRecipe, productsSold) : null,
        costedRevenueMinor,
        theoreticalCOGSMinor: cogs,
        theoreticalGrossProfitMinor: cogs !== null ? costedRevenueMinor - cogs : null,
      },
      categories,
      uncategorized,
      posterReference,
      reconciliation: rec,
      warnings,
    };
  }
}

const SORT_VALUE: Record<CategorySortBy, (c: ReportsCategoryRow) => number | null> = {
  revenue: (c) => c.revenueMinor,
  units: (c) => c.unitsSold,
  productCount: (c) => c.productCount,
  theoreticalCOGS: (c) => c.costing.theoreticalCOGSMinor,
  theoreticalGrossProfit: (c) => c.costing.theoreticalGrossProfitMinor,
};

// Unknown costing (null) sorts last in either direction — never as 0.
function sortCategories(rows: ReportsCategoryRow[], sortBy: CategorySortBy, direction: 'asc' | 'desc'): ReportsCategoryRow[] {
  const value = SORT_VALUE[sortBy];
  const sign = direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (va === null || vb === null) return va === vb ? a.categoryName.localeCompare(b.categoryName) : va === null ? 1 : -1;
    return (va - vb) * sign || b.revenueMinor - a.revenueMinor || a.categoryName.localeCompare(b.categoryName);
  });
}
