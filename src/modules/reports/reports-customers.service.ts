import { Injectable } from '@nestjs/common';
import { ConfigService } from '../../common/config/config.service';
import { AnalyticsRepository, QueryRange } from '../analytics/analytics.repository';
import { AnalyticsService, OverviewQuery } from '../analytics/analytics.service';
import { resolveAnalyticsRange } from '../analytics/analytics-period';
import { GrowthIntelligenceService } from '../growth-intelligence/growth-intelligence.service';
import { ReportsCustomersRepository } from './reports-customers.repository';

export type CustomerSortBy = 'revenue' | 'purchases' | 'units' | 'averageCheck' | 'lastPurchase' | 'firstPurchase';

export interface CustomersReportQuery extends OverviewQuery {
  search?: string;
  sortBy: CustomerSortBy;
  sortDirection: 'asc' | 'desc';
  page: number; // 1-based
  limit: number;
}

export interface ReportsCustomerRow {
  customerId: string;
  name: string | null;
  phone: string | null;
  isActive: boolean;
  purchases: number; // qualifying CUP orders + imported POS receipts — never order lines
  units: number;
  revenueMinor: number;
  averageCheckMinor: number; // revenue / purchases
  firstPurchaseAt: string; // first purchase INSIDE the selected period
  lastPurchaseAt: string; // last purchase INSIDE the selected period
  source: { cupPurchases: number; cupRevenueMinor: number; posPurchases: number; posRevenueMinor: number };
  currentLifecycle: string | null; // Growth Intelligence, as of today over its configured lookback — NOT period-local
  currentRfmScore: string | null; // same source, same "as of today" meaning
}

export interface ReportsCustomersOverview {
  period: { key: OverviewQuery['period']; startDate: string; endDate: string; timezoneOffsetMinutes: number };
  branch: { id: string; name: string } | null;
  filters: { branches: { id: string; name: string }[] };
  summary: {
    identifiedCustomers: number;
    identifiedPurchases: number;
    identifiedUnits: number;
    customerRevenueMinor: number;
    averageCustomerPurchaseMinor: number | null; // customerRevenue / identifiedPurchases (never / customer count)
    newCustomers: number; // Analytics' own definition, read from AnalyticsService
    returningCustomers: number;
    canonicalRevenueMinor: number; // AnalyticsService revenue for the same period/branch
    customerRevenueSharePercent: number | null; // customerRevenue / canonicalRevenue, 1 decimal; null when canonical is 0
  };
  anonymousPos: { purchases: number; units: number; revenueMinor: number; sharePercent: number | null };
  reconciliation: {
    canonicalRevenueMinor: number;
    customerRevenueMinor: number;
    anonymousPosRevenueMinor: number;
    unexplainedMinor: number; // canonical - customer - anonymous (0 when every source is attributed)
    analyticsCustomers: number; // AnalyticsService customers (new + returning)
    reportCustomers: number;
  };
  rows: ReportsCustomerRow[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

const pct1 = (part: number, whole: number) => (whole > 0 ? Math.round((part * 1000) / whole) / 10 : null);

// Reports Phase D1 — Customers. "Who buys, how much, how often" for IDENTIFIED customers only:
//   CUP: one qualifying Order = one purchase (canonical CUSTOMER_METRICS_ORDER_STATUSES, Order.branchId).
//   POS: one IMPORTED PosterImportedTransaction WITH customerId = one purchase (its own stored branchId).
// A customer-less POS receipt is never a customer row, never a customer count; it is reported only as the separate
// anonymous POS figure. Totals, New/Returning and the customer count come from AnalyticsService (unchanged), so this
// report cannot drift from Analytics; lifecycle/RFM come from GrowthIntelligenceService.getListIndicators (one batched
// query per page). No CRM logic, no segmentation, no new RFM.
@Injectable()
export class ReportsCustomersService {
  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly analyticsRepository: AnalyticsRepository,
    private readonly repository: ReportsCustomersRepository,
    private readonly growth: GrowthIntelligenceService,
    private readonly config: ConfigService,
  ) {}

  async getCustomers(query: CustomersReportQuery, now: Date = new Date()): Promise<ReportsCustomersOverview> {
    const offset = this.config.env.BUSINESS_TIMEZONE_OFFSET_MINUTES;
    const range = resolveAnalyticsRange(query, now, offset);
    // AnalyticsService validates the branch (400 "Unknown branch.") and supplies the canonical totals + new/returning.
    const overview = await this.analyticsService.getOverview(query, now);
    const q: QueryRange = { from: range.from, to: range.to, branchId: overview.branch ? overview.branch.id : null };

    const [cup, pos, units, anonymous, anonymousUnits] = await Promise.all([
      this.repository.cupByCustomer(q),
      this.repository.posByCustomer(q),
      this.repository.unitsByCustomer(q),
      this.analyticsRepository.posAnonymousTotals(q),
      this.repository.anonymousPosUnits(q),
    ]);

    type Agg = Omit<ReportsCustomerRow, 'name' | 'phone' | 'isActive' | 'currentLifecycle' | 'currentRfmScore'> & { firstMs: number; lastMs: number };
    const byId = new Map<string, Agg>();
    const entry = (id: string): Agg => {
      let a = byId.get(id);
      if (!a) {
        a = { customerId: id, purchases: 0, units: 0, revenueMinor: 0, averageCheckMinor: 0, firstPurchaseAt: '', lastPurchaseAt: '', firstMs: Infinity, lastMs: -Infinity, source: { cupPurchases: 0, cupRevenueMinor: 0, posPurchases: 0, posRevenueMinor: 0 } };
        byId.set(id, a);
      }
      return a;
    };
    for (const r of cup) {
      const a = entry(r.customerId);
      a.source.cupPurchases += r.purchases;
      a.source.cupRevenueMinor += r.revenue;
      if (r.first) a.firstMs = Math.min(a.firstMs, r.first.getTime());
      if (r.last) a.lastMs = Math.max(a.lastMs, r.last.getTime());
    }
    for (const r of pos) {
      const a = entry(r.customerId);
      a.source.posPurchases += r.purchases;
      a.source.posRevenueMinor += r.revenue;
      if (r.first) a.firstMs = Math.min(a.firstMs, r.first.getTime());
      if (r.last) a.lastMs = Math.max(a.lastMs, r.last.getTime());
    }
    let identifiedPurchases = 0;
    let identifiedUnits = 0;
    let customerRevenueMinor = 0;
    for (const a of byId.values()) {
      a.purchases = a.source.cupPurchases + a.source.posPurchases;
      a.revenueMinor = a.source.cupRevenueMinor + a.source.posRevenueMinor;
      a.units = units.get(a.customerId) ?? 0;
      a.averageCheckMinor = a.purchases > 0 ? Math.round(a.revenueMinor / a.purchases) : 0;
      a.firstPurchaseAt = new Date(a.firstMs).toISOString();
      a.lastPurchaseAt = new Date(a.lastMs).toISOString();
      identifiedPurchases += a.purchases;
      identifiedUnits += a.units;
      customerRevenueMinor += a.revenueMinor;
    }

    // Search (Customer 360's own rule) narrows the TABLE only; the summary always describes the whole period.
    let candidates = [...byId.values()];
    const search = query.search?.trim();
    if (search) {
      const matched = await this.repository.filterBySearch(candidates.map((c) => c.customerId), search);
      candidates = candidates.filter((c) => matched.has(c.customerId));
    }
    const sorted = sortCustomers(candidates, query.sortBy, query.sortDirection);
    const total = sorted.length;
    const totalPages = Math.max(1, Math.ceil(total / query.limit));
    const page = Math.min(query.page, totalPages);
    const pageRows = sorted.slice((page - 1) * query.limit, page * query.limit);

    const ids = pageRows.map((r) => r.customerId);
    const [identities, indicators] = await Promise.all([this.repository.identities(ids), ids.length > 0 ? this.growth.getListIndicators(ids, now) : Promise.resolve(new Map())]);
    const rows: ReportsCustomerRow[] = pageRows.map(({ firstMs: _f, lastMs: _l, ...r }) => {
      const who = identities.get(r.customerId);
      const ind = indicators.get(r.customerId);
      return { ...r, name: who?.name ?? null, phone: who?.phone ?? null, isActive: who?.isActive ?? true, currentLifecycle: ind?.lifecycleState ?? null, currentRfmScore: ind?.rfmScore ?? null };
    });

    const canonical = overview.revenue;
    return {
      period: overview.period,
      branch: overview.branch,
      filters: overview.filters,
      summary: {
        identifiedCustomers: byId.size,
        identifiedPurchases,
        identifiedUnits,
        customerRevenueMinor,
        averageCustomerPurchaseMinor: identifiedPurchases > 0 ? Math.round(customerRevenueMinor / identifiedPurchases) : null,
        newCustomers: overview.newCustomers,
        returningCustomers: overview.returningCustomers,
        canonicalRevenueMinor: canonical,
        customerRevenueSharePercent: pct1(customerRevenueMinor, canonical),
      },
      anonymousPos: { purchases: anonymous.count, units: anonymousUnits, revenueMinor: anonymous.revenue, sharePercent: pct1(anonymous.revenue, canonical) },
      reconciliation: {
        canonicalRevenueMinor: canonical,
        customerRevenueMinor,
        anonymousPosRevenueMinor: anonymous.revenue,
        unexplainedMinor: canonical - customerRevenueMinor - anonymous.revenue,
        analyticsCustomers: overview.customers,
        reportCustomers: byId.size,
      },
      rows,
      pagination: { page, limit: query.limit, total, totalPages },
    };
  }
}

type Sortable = { customerId: string; revenueMinor: number; purchases: number; units: number; averageCheckMinor: number; firstMs: number; lastMs: number };
const SORT_VALUE: Record<CustomerSortBy, (r: Sortable) => number> = {
  revenue: (r) => r.revenueMinor,
  purchases: (r) => r.purchases,
  units: (r) => r.units,
  averageCheck: (r) => r.averageCheckMinor,
  lastPurchase: (r) => r.lastMs,
  firstPurchase: (r) => r.firstMs,
};

// Deterministic: the chosen metric, then customerId ascending — never database order.
function sortCustomers<T extends Sortable>(rows: T[], by: CustomerSortBy, direction: 'asc' | 'desc'): T[] {
  const value = SORT_VALUE[by];
  const sign = direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => (value(a) - value(b)) * sign || (a.customerId < b.customerId ? -1 : a.customerId > b.customerId ? 1 : 0));
}
