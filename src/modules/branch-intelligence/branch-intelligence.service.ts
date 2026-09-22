import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '../../common/config/config.service';
import { AnalyticsPeriod, enumerateDates, resolveAnalyticsRange, ResolvedRange } from '../analytics/analytics-period';
import { AnalyticsRepository, ProductAggregate, QueryRange } from '../analytics/analytics.repository';
import { AnalyticsService } from '../analytics/analytics.service';
import { GrowthIntelligenceService } from '../growth-intelligence/growth-intelligence.service';
import { RewardProgramsService } from '../rewards/reward-programs.service';
import { BranchIntelligenceRepository, BranchRow, RangeMs, TotalsRow } from './branch-intelligence.repository';

export interface BranchIntelligenceQuery {
  period: AnalyticsPeriod;
  startDate?: string;
  endDate?: string;
  branchId?: string;
}

const pct = (part: number, whole: number): number => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0); // one decimal; a description, never a score
const avg = (revenue: number, orders: number): number => (orders > 0 ? Math.round(revenue / orders) : 0);
const TOP = 5;

const EMPTY_ROW = (branchId: string): BranchRow => ({
  branchId,
  customers: 0,
  orders: 0,
  revenue: 0,
  cupOrders: 0,
  cupRevenue: 0,
  posOrders: 0,
  posRevenue: 0,
  cupCustomers: 0,
  posCustomers: 0,
  newCustomers: 0,
  customers2Plus: 0,
  customers3Plus: 0,
  repeatPurchases: 0,
  alsoOtherBranches: 0,
  latestHere: 0,
  arrivedFromOther: 0,
});

// The wording the Admin shows next to each figure. Kept server-side so the definitions live next to the code that implements them.
export const BRANCH_INTELLIGENCE_DEFINITIONS = {
  purchase: 'A qualifying purchase is a CUP order with status sent_to_poster / accepted / preparing / ready / completed, or an imported POS purchase (status IMPORTED) — the definition used by Analytics, Customer 360, Loyalty 2.0 and Growth Intelligence.',
  branchAttribution: 'A purchase belongs to the branch stored on it: Order.branchId for CUP, the branch mapped from the Poster spot at import time for POS. A purchase with no branch is counted in the all-branches totals only. Nothing is inferred from the customer, staff, product or time.',
  newCustomer: 'New customer: first qualifying purchase EVER (any branch, any source) happened at this branch inside the selected period ("new to CUP, first bought here").',
  returningCustomer: 'Returning customer: purchased at this branch in the period but is not new in the sense above — their first purchase ever was earlier, or in the period at another branch. New + returning = customers.',
  analyticsNew: 'Analytics V1 wording: customers with no qualifying sale anywhere before the period start ("new to the business in this period"). It can differ from the branch-level definition only for customers whose first purchase was at another branch inside the period.',
  crossBranch: 'Cross-branch purchasing is read from purchase records only (it says nothing about physical movement): customers with purchases at 2+ branches in the period; customers whose latest purchase in the period was here; customers with a purchase here that directly followed a purchase at another branch.',
  shares: 'Revenue and order shares are descriptive percentages of the mapped-branch totals; they are not scores or rankings. Branches are listed by name.',
  activeDays: 'Calendar days (business time, UTC+5) of the period with at least one qualifying purchase at the branch. Opening hours are not assumed.',
  growth: 'Lifecycle, RFM, signals and opportunities are the Phase 15 Growth Intelligence results computed from this branch\'s purchases only, as of today with the configured default lookback (they do not follow the period filter). They describe customers, not the branch.',
  loyaltyAttribution: 'Points, rewards and promotions are attributed only through the ORDER they were recorded on (or, for Loyalty 2.0 accruals and cashback, through the source purchase). Events with no order are shown as unattributed, never assigned to a branch.',
} as const;

// Phase 18 — Branch Intelligence: a DESCRIPTIVE, per-branch view of what already exists. Nothing here is a new definition: purchases are the canonical
// qualifying purchases, new / returning is derived from the customer's own purchase history, product figures use Analytics V1's item rules, lifecycle / RFM /
// signals / opportunities come straight from Growth Intelligence, and reward availability from the reward progress read model. There is no ranking,
// no score, no tier and no prediction: branches are listed by name and comparisons are figures side by side.
@Injectable()
export class BranchIntelligenceService {
  constructor(
    private readonly repository: BranchIntelligenceRepository,
    private readonly analyticsRepository: AnalyticsRepository,
    private readonly analytics: AnalyticsService,
    private readonly growth: GrowthIntelligenceService,
    private readonly rewardPrograms: RewardProgramsService,
    private readonly config: ConfigService,
  ) {}

  async getOverview(query: BranchIntelligenceQuery, now: Date = new Date()) {
    const offset = this.config.env.BUSINESS_TIMEZONE_OFFSET_MINUTES;
    const range = resolveAnalyticsRange(query, now, offset);
    const ms: RangeMs = { from: range.from.getTime(), to: range.to.getTime() };

    const allBranches = await this.repository.listBranches();
    const selected = query.branchId ? allBranches.find((b) => b.id === query.branchId) : undefined;
    if (query.branchId && !selected) throw new BadRequestException('Unknown branch.');

    // Four statements whatever the number of branches (each is a GROUP BY over the canonical purchases).
    const [rows, totals, activity, tops] = await Promise.all([
      this.repository.branchRows(ms),
      this.repository.totals(ms),
      this.repository.activity(ms, offset),
      this.repository.topProductPerBranch(ms),
    ]);
    const productInfo = await this.repository.productInfo([...new Set(tops.map((t) => t.productId))]);

    const rowById = new Map(rows.map((r) => [r.branchId, r]));
    const activityById = new Map(activity.map((a) => [a.branchId, a]));
    const topById = new Map(tops.map((t) => [t.branchId, t]));
    // Active branches always appear (zeros are information); a deactivated branch appears only when it has activity in the period (or is the selected one).
    const listed = allBranches.filter((b) => b.isActive || rowById.has(b.id) || b.id === query.branchId);

    const mappedRevenue = rows.reduce((n, r) => n + r.revenue, 0);
    const mappedOrders = rows.reduce((n, r) => n + r.orders, 0);

    const branches = listed.map((b) => {
      const r = rowById.get(b.id) ?? EMPTY_ROW(b.id);
      const a = activityById.get(b.id);
      const top = topById.get(b.id);
      const returning = r.customers - r.newCustomers;
      return {
        branchId: b.id,
        branchName: b.name,
        isActive: b.isActive,
        revenueMinor: r.revenue,
        orders: r.orders,
        customers: r.customers,
        averageOrderMinor: avg(r.revenue, r.orders),
        newCustomers: r.newCustomers,
        returningCustomers: returning,
        returningRatePercent: pct(returning, r.customers),
        revenueSharePercent: pct(r.revenue, mappedRevenue),
        orderSharePercent: pct(r.orders, mappedOrders),
        activeDays: a?.activeDays ?? 0,
        lastPurchaseAt: a ? new Date(a.lastAt).toISOString() : null,
        sources: {
          cup: { orders: r.cupOrders, revenueMinor: r.cupRevenue, customers: r.cupCustomers, revenueSharePercent: pct(r.cupRevenue, r.revenue), ordersSharePercent: pct(r.cupOrders, r.orders), customersSharePercent: pct(r.cupCustomers, r.customers) },
          pos: { orders: r.posOrders, revenueMinor: r.posRevenue, customers: r.posCustomers, revenueSharePercent: pct(r.posRevenue, r.revenue), ordersSharePercent: pct(r.posOrders, r.orders), customersSharePercent: pct(r.posCustomers, r.customers) },
        },
        repeatCustomerRatePercent: pct(r.customers2Plus, r.customers),
        topProduct: top ? { name: productInfo.get(top.productId)?.name ?? '—', quantity: top.quantity, revenueMinor: top.revenue } : null,
      };
    });

    const summary = {
      revenueMinor: totals.revenue,
      orders: totals.orders,
      customers: totals.customers,
      averageOrderMinor: avg(totals.revenue, totals.orders),
      newCustomers: totals.newCustomers,
      returningCustomers: totals.customers - totals.newCustomers,
      mapped: { revenueMinor: mappedRevenue, orders: mappedOrders, branchesWithActivity: rows.length },
      unmapped: { revenueMinor: totals.unmappedRevenue, orders: totals.unmappedOrders },
      sources: this.sourceMix(totals),
    };

    const detail = selected ? await this.buildDetail(selected, rowById.get(selected.id) ?? EMPTY_ROW(selected.id), branches.find((b) => b.branchId === selected.id)!, range, ms, offset, query, now) : null;

    return {
      period: { key: query.period, startDate: range.startDate, endDate: range.endDate, days: range.days, timezoneOffsetMinutes: offset },
      filters: { branches: allBranches.filter((b) => b.isActive || b.id === query.branchId).map((b) => ({ id: b.id, name: b.name, isActive: b.isActive })) },
      summary,
      branches,
      branch: selected ? { id: selected.id, name: selected.name, isActive: selected.isActive } : null,
      detail,
      definitions: BRANCH_INTELLIGENCE_DEFINITIONS,
    };
  }

  private sourceMix(t: TotalsRow) {
    return {
      cup: { orders: t.cupOrders, revenueMinor: t.cupRevenue, customers: t.cupCustomers, revenueSharePercent: pct(t.cupRevenue, t.revenue), ordersSharePercent: pct(t.cupOrders, t.orders) },
      pos: { orders: t.posOrders, revenueMinor: t.posRevenue, customers: t.posCustomers, revenueSharePercent: pct(t.posRevenue, t.revenue), ordersSharePercent: pct(t.posOrders, t.orders) },
    };
  }

  // ---------------------------------------------------------------------------------------------------------------- single-branch detail

  private async buildDetail(
    branch: { id: string; name: string; isActive: boolean },
    row: BranchRow,
    card: { revenueSharePercent: number; orderSharePercent: number; activeDays: number; lastPurchaseAt: string | null },
    range: ResolvedRange,
    ms: RangeMs,
    offset: number,
    query: BranchIntelligenceQuery,
    now: Date,
  ) {
    const q: QueryRange = { from: range.from, to: range.to, branchId: branch.id };
    const [daily, cupProducts, posProducts, atBranch, accountHolders, ledger, accruals, rewards, promotions, referrals, growth, v1] = await Promise.all([
      this.repository.dailySeries(ms, offset, branch.id),
      this.analyticsRepository.cupProducts(q),
      this.analyticsRepository.posProducts(q),
      this.repository.customerIdsAtBranch(ms, branch.id),
      this.repository.customersWithLoyaltyAccount(ms, branch.id),
      this.repository.pointsLedger(ms, branch.id),
      this.repository.loyalty2Accruals(ms, branch.id),
      this.repository.rewardRedemptions(ms, branch.id),
      this.repository.promotionRedemptions(ms, branch.id),
      this.repository.referrals(ms, branch.id),
      // Phase 15, branch-scoped: same rules, same thresholds, as of today with the configured default lookback.
      this.growth.overview({ branchId: branch.id, allowInactiveBranch: true, now }),
      // Analytics V1 for the same period and branch — exposed so the two views can be compared side by side.
      this.analytics.getOverview({ period: query.period, startDate: query.startDate, endDate: query.endDate, branchId: branch.id }, now),
    ]);

    const rewardAvailability = await this.rewardPrograms.availableRewardsForCustomers(atBranch);
    const products = await this.buildProducts(cupProducts, posProducts);

    const series = this.fillDays(range, daily);
    const returning = row.customers - row.newCustomers;

    const topCategory = products.categories[0] ?? null;
    const topProduct = products.topByQuantity[0] ?? null;

    return {
      revenue: { revenueMinor: row.revenue, revenueSharePercent: card.revenueSharePercent, byDay: series.map((d) => ({ date: d.date, value: d.revenue })) },
      orders: { orders: row.orders, averageOrderMinor: avg(row.revenue, row.orders), orderSharePercent: card.orderSharePercent, byDay: series.map((d) => ({ date: d.date, value: d.orders })) },
      customers: {
        unique: row.customers,
        new: row.newCustomers,
        returning,
        byDay: series.map((d) => ({ date: d.date, value: d.customers })),
        // The two definitions side by side (see `definitions`): the branch-level split above, and Analytics V1's "no sale anywhere before the period".
        analyticsV1: { customers: v1.customers, newCustomers: v1.newCustomers, returningCustomers: v1.returningCustomers, revenueMinor: v1.revenue, orders: v1.orders },
      },
      activity: { activeDays: card.activeDays, periodDays: range.days, lastPurchaseAt: card.lastPurchaseAt },
      retention: {
        returningRatePercent: pct(returning, row.customers),
        repeatPurchases: row.repeatPurchases, // purchases at this branch beyond each customer's first one in the period
        customersWith2PlusPurchases: row.customers2Plus,
        customersWith3PlusPurchases: row.customers3Plus,
        repeatCustomerRatePercent: pct(row.customers2Plus, row.customers),
      },
      crossBranch: {
        purchasedOnlyHere: row.customers - row.alsoOtherBranches,
        purchasedAtTwoOrMoreBranches: row.alsoOtherBranches,
        latestPurchaseWasHere: row.latestHere,
        purchaseDirectlyFollowedAnotherBranch: row.arrivedFromOther,
      },
      sources: {
        cup: { orders: row.cupOrders, revenueMinor: row.cupRevenue, customers: row.cupCustomers, revenueSharePercent: pct(row.cupRevenue, row.revenue), ordersSharePercent: pct(row.cupOrders, row.orders), customersSharePercent: pct(row.cupCustomers, row.customers) },
        pos: { orders: row.posOrders, revenueMinor: row.posRevenue, customers: row.posCustomers, revenueSharePercent: pct(row.posRevenue, row.revenue), ordersSharePercent: pct(row.posOrders, row.orders), customersSharePercent: pct(row.posCustomers, row.customers) },
      },
      products,
      loyalty: {
        customersWithLoyaltyAccount: accountHolders,
        loyalty2: { purchasesAccrued: accruals.purchases, members: accruals.members, pointsAwarded: accruals.pointsAwarded, cashbackEarnedMinor: accruals.cashbackEarned },
        pointsLedger: ledger, // attributed = ledger rows recorded on an order at this branch; unattributed = rows with no order (all branches, not this branch's)
      },
      rewards: {
        customersWithRewardAvailable: rewardAvailability.size, // customer-level progress of this branch's customers, not something the branch earned
        rewardsAvailable: [...rewardAvailability.values()].reduce((n, list) => n + list.reduce((m, p) => m + p.available, 0), 0),
        redemptionsAtBranch: rewards.byProgram.reduce((n, p) => n + p.count, 0),
        redemptionsByProgram: rewards.byProgram,
        unattributedRedemptions: rewards.unattributed,
      },
      promotions: {
        redemptionsAtBranch: promotions.byPromotion.reduce((n, p) => n + p.count, 0),
        redemptionsByPromotion: promotions.byPromotion.slice().sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, TOP),
        unattributedRedemptions: promotions.unattributed,
      },
      referrals: { qualifiedAtBranch: referrals.qualifiedHere, rewardedAtBranch: referrals.rewardedHere, qualifiedElsewhereOrUnattributed: referrals.qualifiedTotal - referrals.qualifiedHere },
      growth: {
        asOf: growth.asOf,
        lookbackDays: growth.range.days,
        lifecycle: growth.lifecycle,
        rfm: growth.rfm,
        signals: growth.signals.counts,
        opportunities: { counts: growth.opportunities.counts, top: growth.opportunities.top },
      },
      overview: {
        // A factual snapshot — no score, no label.
        revenueMinor: row.revenue,
        orders: row.orders,
        customers: row.customers,
        averageOrderMinor: avg(row.revenue, row.orders),
        returningRatePercent: pct(returning, row.customers),
        cupRevenueSharePercent: pct(row.cupRevenue, row.revenue),
        posRevenueSharePercent: pct(row.posRevenue, row.revenue),
        topCategory: topCategory ? { name: topCategory.name, revenueMinor: topCategory.revenueMinor } : null,
        topProduct: topProduct ? { name: topProduct.name, quantity: topProduct.quantity } : null,
        lifecycle: growth.lifecycle.counts,
        opportunityCount: Object.values(growth.opportunities.counts).reduce((n, c) => n + c.total, 0),
      },
    };
  }

  // Products / categories at one branch from Analytics V1's own item aggregates (paid CUP units + imported POS lines with a mapped product; names come from the
  // stored product rows, never from Poster). "Combined" merges by product id exactly as Analytics V1 does. Sorting is presentation only.
  private async buildProducts(cup: ProductAggregate[], pos: ProductAggregate[]) {
    const ids = [...new Set([...cup, ...pos].map((p) => p.productId))];
    const info = await this.repository.productInfo(ids);
    const merge = (lists: ProductAggregate[][]) => {
      const m = new Map<string, { quantity: number; revenueMinor: number }>();
      for (const row of lists.flat()) {
        const cur = m.get(row.productId) ?? { quantity: 0, revenueMinor: 0 };
        m.set(row.productId, { quantity: cur.quantity + row.quantity, revenueMinor: cur.revenueMinor + row.revenue });
      }
      return [...m.entries()].map(([id, v]) => ({ id, name: info.get(id)?.name ?? '—', category: info.get(id)?.categoryName ?? '—', ...v }));
    };
    const byQty = (a: { quantity: number; revenueMinor: number; name: string }, b: typeof a) => b.quantity - a.quantity || b.revenueMinor - a.revenueMinor || a.name.localeCompare(b.name);
    const byRev = (a: { quantity: number; revenueMinor: number; name: string }, b: typeof a) => b.revenueMinor - a.revenueMinor || b.quantity - a.quantity || a.name.localeCompare(b.name);
    const view = (p: { name: string; category: string; quantity: number; revenueMinor: number }) => ({ name: p.name, category: p.category, quantity: p.quantity, revenueMinor: p.revenueMinor });

    const combined = merge([cup, pos]);
    const categories = new Map<string, { name: string; quantity: number; revenueMinor: number }>();
    for (const p of combined) {
      const key = info.get(p.id)?.categoryId ?? 'none';
      const cur = categories.get(key) ?? { name: p.category, quantity: 0, revenueMinor: 0 };
      categories.set(key, { name: cur.name, quantity: cur.quantity + p.quantity, revenueMinor: cur.revenueMinor + p.revenueMinor });
    }
    const totalRevenue = combined.reduce((n, p) => n + p.revenueMinor, 0);
    return {
      topByQuantity: combined.slice().sort(byQty).slice(0, TOP).map(view),
      topByRevenue: combined.slice().sort(byRev).slice(0, TOP).map(view),
      bySource: { cup: { topByQuantity: merge([cup]).sort(byQty).slice(0, TOP).map(view) }, pos: { topByQuantity: merge([pos]).sort(byQty).slice(0, TOP).map(view) } },
      categories: [...categories.values()].sort(byRev).map((c) => ({ ...c, revenueSharePercent: pct(c.revenueMinor, totalRevenue) })),
    };
  }

  // Zero-fill every business day of the period, exactly like Analytics V1.
  private fillDays(range: ResolvedRange, rows: { day: string; orders: number; revenue: number; customers: number }[]) {
    const byDay = new Map(rows.map((r) => [r.day, r]));
    return enumerateDates(range.startDate, range.endDate).map((date) => ({ date, orders: byDay.get(date)?.orders ?? 0, revenue: byDay.get(date)?.revenue ?? 0, customers: byDay.get(date)?.customers ?? 0 }));
  }
}
