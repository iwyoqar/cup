import { Injectable } from '@nestjs/common';
import { ConfigService } from '../../common/config/config.service';
import { AnalyticsOverview, AnalyticsService, OverviewQuery } from '../analytics/analytics.service';
import { AnalyticsRepository, QueryRange } from '../analytics/analytics.repository';
import { enumerateDates, resolveAnalyticsRange } from '../analytics/analytics-period';

// Reports Phase A — Overview and Sales share one computation (both routes call getOverview()); the two frontend
// pages render the same payload two ways, mirroring AnalyticsPage's own existing sales/analytics dual view. Every
// figure here is either read verbatim from AnalyticsService.getOverview() (the canonical CUP+POS revenue source) or
// derived from AnalyticsRepository's own already-deduped queries — nothing here re-sums CUP or POS revenue.
export interface ReportsOverview {
  period: AnalyticsOverview['period'];
  branch: AnalyticsOverview['branch'];
  filters: AnalyticsOverview['filters'];
  revenue: number;
  orders: number;
  customers: number;
  newCustomers: number;
  returningCustomers: number;
  averageOrder: number;
  revenueByDay: AnalyticsOverview['revenueByDay'];
  ordersByDay: { date: string; orders: number }[];
  sourceBreakdown: {
    cupOriginated: { orders: number; revenue: number };
    independentPos: { purchases: number; revenue: number };
    anonymousPos: { purchases: number; revenue: number };
    importedDataExists: boolean;
  };
  topProducts: AnalyticsOverview['topProducts'];
  notes: string[];
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly analyticsRepository: AnalyticsRepository,
    private readonly config: ConfigService,
  ) {}

  async getOverview(query: OverviewQuery, now: Date = new Date()): Promise<ReportsOverview> {
    const offset = this.config.env.BUSINESS_TIMEZONE_OFFSET_MINUTES;
    // Same canonical resolver Analytics/Branch Intelligence/Finance already call independently — not a new date rule.
    const range = resolveAnalyticsRange(query, now, offset);
    const branch = query.branchId ? await this.analyticsRepository.findBranch(query.branchId) : null;
    const q: QueryRange = { from: range.from, to: range.to, branchId: branch ? branch.id : null };

    const [overview, posAnonymous, cupDaily, posDaily] = await Promise.all([
      this.analyticsService.getOverview(query, now),
      this.analyticsRepository.posAnonymousTotals(q),
      this.analyticsRepository.cupDailyRevenue(q, offset),
      this.analyticsRepository.posDailyRevenue(q, offset),
    ]);

    const independentPosPurchases = overview.sourceBreakdown.pos.purchases - posAnonymous.count;
    const independentPosRevenue = overview.sourceBreakdown.pos.revenue - posAnonymous.revenue;

    const ordersByDay = this.fillOrdersByDay(range.startDate, range.endDate, [...cupDaily, ...posDaily]);

    const notes: string[] = [];
    if (posAnonymous.count > 0) notes.push('Revenue includes customer-less POS sales; Customers/New/Returning count only identified buyers.');

    return {
      period: overview.period,
      branch: overview.branch,
      filters: overview.filters,
      revenue: overview.revenue,
      orders: overview.orders,
      customers: overview.customers,
      newCustomers: overview.newCustomers,
      returningCustomers: overview.returningCustomers,
      averageOrder: overview.averageOrder,
      revenueByDay: overview.revenueByDay,
      ordersByDay,
      sourceBreakdown: {
        cupOriginated: { orders: overview.sourceBreakdown.cup.orders, revenue: overview.sourceBreakdown.cup.revenue },
        independentPos: { purchases: independentPosPurchases, revenue: independentPosRevenue },
        anonymousPos: { purchases: posAnonymous.count, revenue: posAnonymous.revenue },
        importedDataExists: overview.sourceBreakdown.pos.importedDataExists,
      },
      topProducts: overview.topProducts,
      notes,
    };
  }

  private fillOrdersByDay(startDate: string, endDate: string, rows: { day: string; orders: number }[]): { date: string; orders: number }[] {
    const byDay = new Map<string, number>();
    for (const r of rows) byDay.set(r.day, (byDay.get(r.day) ?? 0) + r.orders);
    return enumerateDates(startDate, endDate).map((date) => ({ date, orders: byDay.get(date) ?? 0 }));
  }
}
