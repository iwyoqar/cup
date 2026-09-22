import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '../../common/config/config.service';
import { AnalyticsPeriod, enumerateDates, ResolvedRange, resolveAnalyticsRange } from './analytics-period';
import { AnalyticsRepository, ProductAggregate, QueryRange } from './analytics.repository';

// Whole-UZS integers everywhere (CUP canonical money). No division by 100; the Poster unit conversion already happened at the
// Poster boundary when a POS purchase was imported. The frontend performs NO business calculation on any of these numbers.
export interface AnalyticsOverview {
  period: { key: AnalyticsPeriod; startDate: string; endDate: string; timezoneOffsetMinutes: number };
  branch: { id: string; name: string } | null;
  filters: { branches: { id: string; name: string }[] };
  revenue: number;
  orders: number;
  customers: number;
  averageOrder: number;
  newCustomers: number;
  returningCustomers: number;
  revenueByDay: { date: string; revenue: number }[];
  sourceBreakdown: {
    cup: { orders: number; revenue: number };
    pos: { purchases: number; revenue: number; importedDataExists: boolean };
  };
  topProducts: { name: string; quantity: number; revenue: number }[];
}

export interface OverviewQuery {
  period: AnalyticsPeriod;
  startDate?: string;
  endDate?: string;
  branchId?: string;
}

const TOP_PRODUCTS = 5;

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly repository: AnalyticsRepository,
    private readonly config: ConfigService,
  ) {}

  async getOverview(query: OverviewQuery, now: Date = new Date()): Promise<AnalyticsOverview> {
    const offset = this.config.env.BUSINESS_TIMEZONE_OFFSET_MINUTES;
    const range = this.resolveRange(query, now, offset);

    const branch = query.branchId ? await this.repository.findBranch(query.branchId) : null;
    if (query.branchId && !branch) throw new BadRequestException('Unknown branch.');
    const q: QueryRange = { from: range.from, to: range.to, branchId: branch ? branch.id : null };

    // Independent aggregate queries, issued together (no dependency chain, no per-row loops).
    const [branches, importedDataExists, cup, pos, cupCustomers, posCustomers, cupDaily, posDaily, cupProducts, posProducts] = await Promise.all([
      this.repository.findActiveBranches(),
      this.repository.importedPosRowsExist(),
      this.repository.cupTotals(q),
      this.repository.posTotals(q),
      this.repository.cupCustomerIds(q),
      this.repository.posCustomerIds(q),
      this.repository.cupDailyRevenue(q, offset),
      this.repository.posDailyRevenue(q, offset),
      this.repository.cupProducts(q),
      this.repository.posProducts(q),
    ]);

    const revenue = cup.revenue + pos.revenue;
    const orders = cup.count + pos.count;

    // Customers: distinct across BOTH sources, so someone with a CUP order and a POS purchase counts once.
    const inPeriod = new Set([...cupCustomers, ...posCustomers]);
    const ids = [...inPeriod];
    const [cupBefore, posBefore] = await Promise.all([this.repository.cupCustomersWithSaleBefore(ids, range.from), this.repository.posCustomersWithSaleBefore(ids, range.from)]);
    const hadEarlierSale = new Set([...cupBefore, ...posBefore]);
    // Every customer in the period is in exactly one of the two groups, so new + returning === customers.
    const returningCustomers = ids.filter((id) => hadEarlierSale.has(id)).length;
    const newCustomers = ids.length - returningCustomers;

    const topProducts = await this.buildTopProducts(cupProducts, posProducts);

    return {
      period: { key: query.period, startDate: range.startDate, endDate: range.endDate, timezoneOffsetMinutes: offset },
      branch,
      filters: { branches },
      revenue,
      orders,
      customers: ids.length,
      averageOrder: orders > 0 ? Math.round(revenue / orders) : 0,
      newCustomers,
      returningCustomers,
      revenueByDay: this.fillDays(range, [...cupDaily, ...posDaily]),
      sourceBreakdown: {
        cup: { orders: cup.count, revenue: cup.revenue },
        pos: { purchases: pos.count, revenue: pos.revenue, importedDataExists: importedDataExists },
      },
      topProducts,
    };
  }

  private resolveRange(query: OverviewQuery, now: Date, offset: number): ResolvedRange {
    return resolveAnalyticsRange(query, now, offset);
  }

  // Zero-fill: every business day in the range appears, so the chart shows quiet days instead of hiding them.
  private fillDays(range: ResolvedRange, rows: { day: string; revenue: number }[]): { date: string; revenue: number }[] {
    const byDay = new Map<string, number>();
    for (const r of rows) byDay.set(r.day, (byDay.get(r.day) ?? 0) + r.revenue);
    return enumerateDates(range.startDate, range.endDate).map((date) => ({ date, revenue: byDay.get(date) ?? 0 }));
  }

  private async buildTopProducts(cup: ProductAggregate[], pos: ProductAggregate[]): Promise<AnalyticsOverview['topProducts']> {
    // Same CUP product across both sources is one product line (CUP-originated Poster receipts are never in the POS set, so
    // nothing is counted twice).
    const merged = new Map<string, { quantity: number; revenue: number }>();
    for (const row of [...cup, ...pos]) {
      const current = merged.get(row.productId) ?? { quantity: 0, revenue: 0 };
      merged.set(row.productId, { quantity: current.quantity + row.quantity, revenue: current.revenue + row.revenue });
    }
    const names = await this.repository.productNames([...merged.keys()]);
    return [...merged.entries()]
      .map(([id, v]) => ({ name: names.get(id) ?? '—', quantity: v.quantity, revenue: v.revenue }))
      .sort((a, b) => b.revenue - a.revenue || b.quantity - a.quantity || a.name.localeCompare(b.name))
      .slice(0, TOP_PRODUCTS);
  }
}
