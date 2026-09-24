import { BadRequestException, Injectable } from '@nestjs/common';
import { PosterReportsService, PosterSalesReference } from './poster-reports.service';
import { ProductSalesQuery, ProductSalesReconciliation, ProductSalesRow, ReportsProductSalesService } from './reports-product-sales.service';
import { ReportsProductSalesRepository } from './reports-product-sales.repository';

export type ProductSortBy = 'revenue' | 'quantity' | 'averagePrice' | 'theoreticalGrossProfit' | 'theoreticalCOGS';

export interface ProductsReportQuery extends ProductSalesQuery {
  categoryId?: string;
  search?: string;
  sortBy: ProductSortBy;
  sortDirection: 'asc' | 'desc';
}

export interface ReportsProductRow extends ProductSalesRow {
  posterReference: { quantity: number; revenueMinor: number } | null; // Poster's own figure for this product — comparison only
}

export interface ReportsProductsSummary {
  productsSold: number; // distinct products with qualifying sales
  unitsSold: number;
  revenueMinor: number;
  productsWithRecipe: number; // sold products whose theoretical unit cost is known
  costedRevenueMinor: number; // revenue of those products only — the base theoretical gross profit is computed on
  theoreticalCOGSMinor: number | null; // null when no sold product has a recipe (never a fake 0)
  theoreticalGrossProfitMinor: number | null; // costedRevenue - theoreticalCOGS: products WITHOUT a recipe are left out, not costed at 0
}

export interface ReportsPosterProductsReference {
  available: boolean;
  unavailableReason: 'poster_unavailable' | 'malformed_response' | null;
  totalQuantity: number | null;
  totalRevenueMinor: number | null;
  unmapped: { posterProductId: string; name: string; quantity: number; revenueMinor: number }[]; // Poster products with no CUP Product
}

export interface ReportsProductsOverview {
  period: { key: ProductSalesQuery['period']; startDate: string; endDate: string; timezoneOffsetMinutes: number };
  branch: { id: string; name: string } | null;
  category: { id: string; name: string } | null;
  source: ProductSalesQuery['source'];
  filters: { branches: { id: string; name: string }[]; categories: { id: string; name: string; isActive: boolean }[] };
  summary: ReportsProductsSummary;
  products: ReportsProductRow[];
  // Imported POS lines (CUP DB) whose Poster product has no CUP Product — counted in Analytics revenue, not in any
  // product row above. Only listed when no category filter is set (they have no category by definition).
  unmappedPos: { posterProductId: string; name: string | null; quantity: number; revenueMinor: number }[];
  posterReference: ReportsPosterProductsReference;
  reconciliation: ProductSalesReconciliation;
  warnings: string[];
}

// Reports Phase C1 — Products. A view over ReportsProductSalesService's canonical per-product aggregate: filters, sorts
// and summarizes it; computes no revenue of its own. Poster's dash.getProductsSales is read once as a separate
// reference (per-product comparison + products Poster sold that CUP has no Product for), never merged in.
@Injectable()
export class ReportsProductsService {
  constructor(
    private readonly productSales: ReportsProductSalesService,
    private readonly repository: ReportsProductSalesRepository,
    private readonly posterReports: PosterReportsService,
  ) {}

  async getProducts(query: ProductsReportQuery, now: Date = new Date()): Promise<ReportsProductsOverview> {
    const categories = await this.repository.listCategories();
    const category = query.categoryId ? categories.find((c) => c.id === query.categoryId) : undefined;
    if (query.categoryId && !category) throw new BadRequestException('Unknown category.');

    const agg = await this.productSales.aggregate(query, now);
    const ymd = (d: string) => d.replace(/-/g, '');
    const poster = await this.posterReports.getProductsSalesReference(ymd(agg.range.startDate), ymd(agg.range.endDate), agg.branch ? String(agg.branch.posterSpotId) : undefined);
    const posterById = poster.available ? new Map(poster.rows.map((r) => [r.posterId, r])) : null;

    const inCategory = category ? agg.products.filter((p) => p.categoryId === category.id) : agg.products;
    const summary = summarize(inCategory);

    const needle = query.search?.trim().toLocaleLowerCase();
    const visible = needle ? inCategory.filter((p) => p.productName.toLocaleLowerCase().includes(needle)) : inCategory;
    const products: ReportsProductRow[] = sortProducts(visible, query.sortBy, query.sortDirection).map((p) => {
      const ref = posterById?.get(p.posterProductId);
      return { ...p, posterReference: ref ? { quantity: ref.quantity, revenueMinor: ref.revenueMinor } : null };
    });

    const unmappedPos = category
      ? []
      : agg.unmappedPos
          .map((u) => ({ ...u, name: posterById?.get(u.posterProductId)?.name ?? null }))
          .filter((u) => !needle || (u.name ?? u.posterProductId).toLocaleLowerCase().includes(needle))
          .sort((a, b) => b.revenueMinor - a.revenueMinor);

    const posterReference = await this.buildPosterReference(poster);
    const warnings = this.warnings(agg.reconciliation, posterReference, query.source);

    return {
      period: { key: query.period, startDate: agg.range.startDate, endDate: agg.range.endDate, timezoneOffsetMinutes: agg.offsetMinutes },
      branch: agg.branch ? { id: agg.branch.id, name: agg.branch.name } : null,
      category: category ? { id: category.id, name: category.name } : null,
      source: query.source,
      filters: { branches: agg.branches, categories: categories.map((c) => ({ id: c.id, name: c.name, isActive: c.isActive })) },
      summary,
      products,
      unmappedPos,
      posterReference,
      reconciliation: agg.reconciliation,
      warnings,
    };
  }

  private async buildPosterReference(poster: PosterSalesReference): Promise<ReportsPosterProductsReference> {
    if (!poster.available) return { available: false, unavailableReason: poster.reason, totalQuantity: null, totalRevenueMinor: null, unmapped: [] };
    const mapped = await this.repository.productIdsByPosterId(poster.rows.map((r) => r.posterId));
    return {
      available: true,
      unavailableReason: null,
      totalQuantity: Math.round(poster.rows.reduce((s, r) => s + r.quantity, 0) * 1000) / 1000,
      totalRevenueMinor: poster.rows.reduce((s, r) => s + r.revenueMinor, 0),
      unmapped: poster.rows
        .filter((r) => !mapped.has(r.posterId))
        .map((r) => ({ posterProductId: r.posterId, name: r.name, quantity: r.quantity, revenueMinor: r.revenueMinor }))
        .sort((a, b) => b.revenueMinor - a.revenueMinor),
    };
  }

  private warnings(rec: ProductSalesReconciliation, poster: ReportsPosterProductsReference, source: ProductSalesQuery['source']): string[] {
    const warnings: string[] = [];
    if (rec.unmappedPosRevenueMinor !== 0) warnings.push('Some imported POS sales are for Poster products that have no CUP product. They are counted in Analytics revenue and listed under "Unmapped POS products", not in any product row.');
    if (rec.cupOrderLevelDifferenceMinor !== 0 || rec.posReceiptLevelDifferenceMinor !== 0)
      warnings.push('Product revenue is the sum of sale lines; Analytics revenue is the sum of order/receipt totals. They differ by order-level amounts (e.g. promotion discounts, receipt-level adjustments) — see Reconciliation.');
    // Poster sees every sale (CUP-originated included), so its total is only comparable to the source=all figure.
    const ratio = source === 'all' && poster.totalRevenueMinor && rec.canonicalRevenueMinor > 0 ? poster.totalRevenueMinor / rec.canonicalRevenueMinor : null;
    if (ratio !== null && (ratio > 20 || ratio < 0.05)) warnings.push("Poster's product report total is more than 20x away from CUP revenue for the same period. This usually indicates a unit mismatch in Poster's report; treat Poster reference amounts as unverified.");
    return warnings;
  }
}

export function summarize(rows: ProductSalesRow[]): ReportsProductsSummary {
  let unitsSold = 0;
  let revenueMinor = 0;
  let productsWithRecipe = 0;
  let costedRevenueMinor = 0;
  let cogs = 0;
  for (const p of rows) {
    unitsSold += p.quantity;
    revenueMinor += p.revenueMinor;
    if (p.costing.theoreticalCOGSMinor !== null) {
      productsWithRecipe += 1;
      costedRevenueMinor += p.revenueMinor;
      cogs += p.costing.theoreticalCOGSMinor;
    }
  }
  return {
    productsSold: rows.length,
    unitsSold,
    revenueMinor,
    productsWithRecipe,
    costedRevenueMinor,
    theoreticalCOGSMinor: productsWithRecipe > 0 ? cogs : null,
    theoreticalGrossProfitMinor: productsWithRecipe > 0 ? costedRevenueMinor - cogs : null,
  };
}

const SORT_VALUE: Record<ProductSortBy, (p: ProductSalesRow) => number | null> = {
  revenue: (p) => p.revenueMinor,
  quantity: (p) => p.quantity,
  averagePrice: (p) => p.averagePriceMinor,
  theoreticalGrossProfit: (p) => p.costing.theoreticalGrossProfitMinor,
  theoreticalCOGS: (p) => p.costing.theoreticalCOGSMinor,
};

// Unknown values (no recipe -> null COGS/profit) always sort last, in either direction — never treated as 0.
function sortProducts(rows: ProductSalesRow[], sortBy: ProductSortBy, direction: 'asc' | 'desc'): ProductSalesRow[] {
  const value = SORT_VALUE[sortBy];
  const sign = direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (va === null || vb === null) return va === vb ? a.productName.localeCompare(b.productName) : va === null ? 1 : -1;
    return (va - vb) * sign || b.revenueMinor - a.revenueMinor || a.productName.localeCompare(b.productName);
  });
}
