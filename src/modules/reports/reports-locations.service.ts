import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '../../common/config/config.service';
import { AnalyticsRepository } from '../analytics/analytics.repository';
import { enumerateDates, resolveAnalyticsRange } from '../analytics/analytics-period';
import { BranchIntelligenceQuery, BranchIntelligenceService } from '../branch-intelligence/branch-intelligence.service';
import { BranchIntelligenceRepository, RangeMs } from '../branch-intelligence/branch-intelligence.repository';
import { PosterLocationReference, PosterReportsService } from './poster-reports.service';

export interface ReportsLocationsSummary {
  revenue: number;
  orders: number;
  customers: number;
  newCustomers: number;
  returningCustomers: number;
  averageReceipt: number;
  cupRevenue: number;
  posRevenue: number; // identified + anonymous combined — see anonymousPosRevenue below (a SUBSET, not additive)
  anonymousPosRevenue: number;
  unattributedRevenue: number;
  unattributedOrders: number;
}

export interface ReportsLocationsBranchRow {
  branchId: string;
  branchName: string;
  revenue: number;
  orders: number;
  customers: number;
  newCustomers: number;
  returningCustomers: number;
  averageReceipt: number;
  cupRevenue: number;
  posRevenue: number; // identified + anonymous combined, same hierarchy as the summary field above
  anonymousPosRevenue: number;
}

export interface ReportsLocationsOverview {
  period: { key: BranchIntelligenceQuery['period']; startDate: string; endDate: string; timezoneOffsetMinutes: number };
  branch: { id: string; name: string } | null;
  filters: { branches: { id: string; name: string }[] };
  summary: ReportsLocationsSummary;
  branches: ReportsLocationsBranchRow[];
  trend: { date: string; revenue: number; orders: number }[];
  detail: {
    customers: { new: number; returning: number };
  } | null;
  posterReference: PosterLocationReference;
  notes: string[];
}

// Reports Phase B1 — Locations composes THREE already-canonical sources and adds nothing new to branch attribution
// or revenue math: BranchIntelligenceService (per-branch revenue/orders/customers/CUP-vs-POS, unmapped totals —
// the one place branch attribution logic lives), ReportsService (Phase A's revenue/orders-by-day trend), and
// PosterReportsService (Poster's own report, kept as a separate reference figure, never merged into a CUP total).
// The only genuinely new figures here are the anonymous-POS split (a subset breakout of BranchIntelligence's own
// posRevenue, via AnalyticsRepository.posAnonymousTotals / BranchIntelligenceRepository.posAnonymousByBranch).
@Injectable()
export class ReportsLocationsService {
  constructor(
    private readonly branchIntelligence: BranchIntelligenceService,
    private readonly branchIntelligenceRepository: BranchIntelligenceRepository,
    private readonly analyticsRepository: AnalyticsRepository,
    private readonly posterReports: PosterReportsService,
    private readonly config: ConfigService,
  ) {}

  async getLocations(query: BranchIntelligenceQuery, now: Date = new Date()): Promise<ReportsLocationsOverview> {
    const offset = this.config.env.BUSINESS_TIMEZONE_OFFSET_MINUTES;
    const range = resolveAnalyticsRange(query, now, offset);
    const ms: RangeMs = { from: range.from.getTime(), to: range.to.getTime() };
    const dateFromYmd = range.startDate.replace(/-/g, '');
    const dateToYmd = range.endDate.replace(/-/g, '');

    // BranchIntelligenceService itself throws BadRequestException for an unknown branchId — reused, not re-checked.
    // Phase H: the trend is read straight from the two daily aggregates Reports Overview's revenueByDay/ordersByDay are
    // built from (AnalyticsRepository.cupDailyRevenue + posDailyRevenue, zero-filled over the same business days), instead
    // of running the whole Overview (and the full Analytics overview inside it) just for this series. Same numbers.
    const trendRange = { from: range.from, to: range.to, branchId: query.branchId ?? null };
    const [overview, cupDaily, posDaily] = await Promise.all([
      this.branchIntelligence.getOverview(query, now),
      this.analyticsRepository.cupDailyRevenue(trendRange, offset),
      this.analyticsRepository.posDailyRevenue(trendRange, offset),
    ]);
    const byDay = new Map<string, { revenue: number; orders: number }>();
    for (const r of [...cupDaily, ...posDaily]) {
      const d = byDay.get(r.day) ?? { revenue: 0, orders: 0 };
      byDay.set(r.day, { revenue: d.revenue + r.revenue, orders: d.orders + r.orders });
    }
    const trend = enumerateDates(range.startDate, range.endDate).map((date) => ({ date, revenue: byDay.get(date)?.revenue ?? 0, orders: byDay.get(date)?.orders ?? 0 }));

    if (query.branchId) {
      const branches = await this.branchIntelligenceRepository.listBranches();
      const branch = branches.find((b) => b.id === query.branchId);
      if (!branch || !overview.branch) throw new BadRequestException('Unknown branch.');
      const card = overview.branches.find((b) => b.branchId === query.branchId)!;

      const [anonymous, posterReference] = await Promise.all([
        this.analyticsRepository.posAnonymousTotals({ from: range.from, to: range.to, branchId: query.branchId }),
        this.posterReports.getReference(dateFromYmd, dateToYmd, String(branch.posterSpotId)),
      ]);

      const notes: string[] = [];
      if (anonymous.count > 0) notes.push('Revenue includes customer-less POS sales at this branch; Customers/New/Returning count only identified buyers.');

      return {
        period: { key: query.period, startDate: range.startDate, endDate: range.endDate, timezoneOffsetMinutes: offset },
        branch: overview.branch,
        filters: { branches: overview.filters.branches.map((b) => ({ id: b.id, name: b.name })) },
        summary: {
          revenue: card.revenueMinor,
          orders: card.orders,
          customers: card.customers,
          newCustomers: card.newCustomers,
          returningCustomers: card.returningCustomers,
          averageReceipt: card.averageOrderMinor,
          cupRevenue: card.sources.cup.revenueMinor,
          posRevenue: card.sources.pos.revenueMinor,
          anonymousPosRevenue: anonymous.revenue,
          unattributedRevenue: 0, // a selected branch's own figures are, by definition, fully attributed to it
          unattributedOrders: 0,
        },
        branches: [],
        trend,
        detail: { customers: { new: card.newCustomers, returning: card.returningCustomers } },
        posterReference,
        notes,
      };
    }

    const [anonymousByBranch, anonymousTotal, posterReference] = await Promise.all([
      this.branchIntelligenceRepository.posAnonymousByBranch(ms),
      this.analyticsRepository.posAnonymousTotals({ from: range.from, to: range.to, branchId: null }),
      this.posterReports.getReference(dateFromYmd, dateToYmd),
    ]);
    const anonymousById = new Map(anonymousByBranch.map((a) => [a.branchId, a.revenue]));

    const notes: string[] = [];
    if (anonymousTotal.count > 0) notes.push('Revenue includes customer-less POS sales; Customers/New/Returning count only identified buyers.');
    if (overview.summary.unmapped.orders > 0) notes.push('Sales without an explicit branch mapping are included in total revenue but are not assigned to a branch.');

    return {
      period: { key: query.period, startDate: range.startDate, endDate: range.endDate, timezoneOffsetMinutes: offset },
      branch: null,
      filters: { branches: overview.filters.branches.map((b) => ({ id: b.id, name: b.name })) },
      summary: {
        revenue: overview.summary.revenueMinor,
        orders: overview.summary.orders,
        customers: overview.summary.customers,
        newCustomers: overview.summary.newCustomers,
        returningCustomers: overview.summary.returningCustomers,
        averageReceipt: overview.summary.averageOrderMinor,
        cupRevenue: overview.summary.sources.cup.revenueMinor,
        posRevenue: overview.summary.sources.pos.revenueMinor,
        anonymousPosRevenue: anonymousTotal.revenue,
        unattributedRevenue: overview.summary.unmapped.revenueMinor,
        unattributedOrders: overview.summary.unmapped.orders,
      },
      branches: overview.branches.map((b) => ({
        branchId: b.branchId,
        branchName: b.branchName,
        revenue: b.revenueMinor,
        orders: b.orders,
        customers: b.customers,
        newCustomers: b.newCustomers,
        returningCustomers: b.returningCustomers,
        averageReceipt: b.averageOrderMinor,
        cupRevenue: b.sources.cup.revenueMinor,
        posRevenue: b.sources.pos.revenueMinor,
        anonymousPosRevenue: anonymousById.get(b.branchId) ?? 0,
      })),
      trend,
      detail: null,
      posterReference,
      notes,
    };
  }
}
