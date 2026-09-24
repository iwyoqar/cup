import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '../../common/config/config.service';
import { AnalyticsRepository, ProductAggregate, QueryRange } from '../analytics/analytics.repository';
import { AnalyticsPeriod, resolveAnalyticsRange, ResolvedRange } from '../analytics/analytics-period';
import { BranchIntelligenceRepository } from '../branch-intelligence/branch-intelligence.repository';
import { ProductMeta, ReportsProductSalesRepository, UnmappedPosLine } from './reports-product-sales.repository';

export type ProductSalesSource = 'all' | 'cup' | 'pos';

export interface ProductSalesQuery {
  period: AnalyticsPeriod;
  startDate?: string;
  endDate?: string;
  branchId?: string;
  source: ProductSalesSource;
}

export interface ProductCosting {
  hasRecipe: boolean; // true only when a theoretical unit cost is actually known
  theoreticalCostMinor: number | null;
  theoreticalCOGSMinor: number | null; // quantity x theoreticalCostMinor — null (never 0) without a recipe
  theoreticalGrossProfitMinor: number | null;
}

export interface ProductSalesRow {
  productId: string;
  posterProductId: string;
  productName: string;
  categoryId: string;
  categoryName: string;
  posterCategoryId: string;
  categoryActive: boolean;
  quantity: number;
  revenueMinor: number;
  averagePriceMinor: number | null;
  source: { cupQuantity: number; cupRevenueMinor: number; posQuantity: number; posRevenueMinor: number };
  costing: ProductCosting;
}

// How product-line revenue relates to Analytics' canonical revenue (order/receipt totals) for the same range, branch
// and source. Product revenue is built from LINES; canonical revenue from ORDER/RECEIPT totals, so the two differ by
// anything that lives on the order rather than a line (CUP promotion discounts, reward lines priced by the order,
// Poster receipt-level discounts/rounding) plus POS lines whose Poster product has no CUP Product.
export interface ProductSalesReconciliation {
  canonicalRevenueMinor: number; // AnalyticsRepository.cupTotals + posTotals (per `source`) — the Analytics figure
  productRevenueMinor: number; // sum of the product rows (mapped CUP products)
  unmappedPosRevenueMinor: number; // imported POS lines with no CUP Product
  cupOrderLevelDifferenceMinor: number; // CUP Order.totalMinor sum - CUP product-line revenue
  posReceiptLevelDifferenceMinor: number; // POS receipt totalMinor sum - (mapped + unmapped POS line revenue)
}

export interface ProductSalesAggregate {
  range: ResolvedRange;
  offsetMinutes: number;
  branch: { id: string; name: string; posterSpotId: number } | null;
  branches: { id: string; name: string }[];
  products: ProductSalesRow[]; // every CUP product with qualifying sales, unsorted
  unmappedPos: UnmappedPosLine[];
  reconciliation: ProductSalesReconciliation;
}

// Reports Phase C1/C2 — the ONE product-sales aggregation both the Products and Categories reports are built on (the
// Categories report groups these rows; it never re-queries sales). Every sales figure is read from AnalyticsRepository's
// existing, unmodified per-product aggregates:
//   CUP  = cupProducts: qualifying OrderItems (CUSTOMER_METRICS_ORDER_STATUSES, paid lines only — isRewardItem=false),
//          branch = Order.branchId.
//   POS  = posProducts: IMPORTED PosterImportedTransaction lines (identified AND anonymous receipts alike; customerId is
//          never looked at), branch = the import's own spot -> Branch mapping stored on the row.
// No double counting: a CUP-originated Poster receipt is never imported as independent POS (the POS import's existing
// PosterIncomingOrderLink / posterTransactionId-unique rules decide that) — this report adds no dedup logic of its own.
@Injectable()
export class ReportsProductSalesService {
  constructor(
    private readonly analyticsRepository: AnalyticsRepository,
    private readonly branchIntelligenceRepository: BranchIntelligenceRepository,
    private readonly repository: ReportsProductSalesRepository,
    private readonly config: ConfigService,
  ) {}

  async aggregate(query: ProductSalesQuery, now: Date = new Date()): Promise<ProductSalesAggregate> {
    const offset = this.config.env.BUSINESS_TIMEZONE_OFFSET_MINUTES;
    const range = resolveAnalyticsRange(query, now, offset); // canonical resolver; throws 400 on an invalid custom range

    const allBranches = await this.branchIntelligenceRepository.listBranches();
    const branchRow = query.branchId ? allBranches.find((b) => b.id === query.branchId) : undefined;
    if (query.branchId && !branchRow) throw new BadRequestException('Unknown branch.');
    const q: QueryRange = { from: range.from, to: range.to, branchId: branchRow ? branchRow.id : null };

    const wantCup = query.source !== 'pos';
    const wantPos = query.source !== 'cup';
    const none: ProductAggregate[] = [];
    const [cupRows, posRows, unmappedPos, cupTotals, posTotals] = await Promise.all([
      wantCup ? this.analyticsRepository.cupProducts(q) : Promise.resolve(none),
      wantPos ? this.analyticsRepository.posProducts(q) : Promise.resolve(none),
      wantPos ? this.repository.unmappedPosLines(q) : Promise.resolve([] as UnmappedPosLine[]),
      wantCup ? this.analyticsRepository.cupTotals(q) : Promise.resolve({ count: 0, revenue: 0 }),
      wantPos ? this.analyticsRepository.posTotals(q) : Promise.resolve({ count: 0, revenue: 0 }),
    ]);

    const bySource = new Map<string, ProductSalesRow['source']>();
    const entry = (id: string) => {
      let s = bySource.get(id);
      if (!s) bySource.set(id, (s = { cupQuantity: 0, cupRevenueMinor: 0, posQuantity: 0, posRevenueMinor: 0 }));
      return s;
    };
    for (const r of cupRows) {
      const s = entry(r.productId);
      s.cupQuantity += r.quantity;
      s.cupRevenueMinor += r.revenue;
    }
    for (const r of posRows) {
      const s = entry(r.productId);
      s.posQuantity += r.quantity;
      s.posRevenueMinor += r.revenue;
    }

    const meta = await this.repository.productsMeta([...bySource.keys()]);
    const products: ProductSalesRow[] = [];
    for (const [productId, source] of bySource) {
      const m = meta.get(productId);
      if (!m) continue; // unreachable: OrderItem/PosterImportedTransactionItem.productId are FKs to Product
      products.push(this.buildRow(m, source));
    }

    const cupLineRevenue = cupRows.reduce((s, r) => s + r.revenue, 0);
    const posLineRevenue = posRows.reduce((s, r) => s + r.revenue, 0);
    const unmappedPosRevenueMinor = unmappedPos.reduce((s, r) => s + r.revenueMinor, 0);

    return {
      range,
      offsetMinutes: offset,
      branch: branchRow ? { id: branchRow.id, name: branchRow.name, posterSpotId: branchRow.posterSpotId } : null,
      branches: allBranches.filter((b) => b.isActive).map((b) => ({ id: b.id, name: b.name })),
      products,
      unmappedPos,
      reconciliation: {
        canonicalRevenueMinor: cupTotals.revenue + posTotals.revenue,
        productRevenueMinor: cupLineRevenue + posLineRevenue,
        unmappedPosRevenueMinor,
        cupOrderLevelDifferenceMinor: cupTotals.revenue - cupLineRevenue,
        posReceiptLevelDifferenceMinor: posTotals.revenue - posLineRevenue - unmappedPosRevenueMinor,
      },
    };
  }

  private buildRow(m: ProductMeta, source: ProductSalesRow['source']): ProductSalesRow {
    const quantity = source.cupQuantity + source.posQuantity;
    const revenueMinor = source.cupRevenueMinor + source.posRevenueMinor;
    // A cost counts only when Poster has a recipe AND the COGS sync produced a unit cost — same rule as FinancePnlService.
    // Missing cost stays null; it is never treated as zero, estimated, or taken from Poster's own profit fields.
    const unitCost = m.hasRecipe && m.theoreticalCostMinor !== null ? m.theoreticalCostMinor : null;
    const cogs = unitCost !== null ? unitCost * quantity : null;
    return {
      productId: m.id,
      posterProductId: m.posterProductId,
      productName: m.name,
      categoryId: m.categoryId,
      categoryName: m.categoryName,
      posterCategoryId: m.posterCategoryId,
      categoryActive: m.categoryActive,
      quantity,
      revenueMinor,
      averagePriceMinor: quantity > 0 ? Math.round(revenueMinor / quantity) : null,
      source,
      costing: {
        hasRecipe: unitCost !== null,
        theoreticalCostMinor: unitCost,
        theoreticalCOGSMinor: cogs,
        theoreticalGrossProfitMinor: cogs !== null ? revenueMinor - cogs : null,
      },
    };
  }
}
