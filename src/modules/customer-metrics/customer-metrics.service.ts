import { Injectable } from '@nestjs/common';
import { CustomerMetricsRepository } from './customer-metrics.repository';
import { CustomerFavoriteBranch, CustomerOrderMetrics } from './customer-metrics.types';

export interface CustomerDetailMetrics {
  metrics: CustomerOrderMetrics;
  favoriteBranch: CustomerFavoriteBranch | null;
  orders: Awaited<ReturnType<CustomerMetricsRepository['findRelevantOrdersForCustomer']>>;
}

export interface CustomerSummaryMetrics {
  metrics: CustomerOrderMetrics;
  branches: { branchId: string; count: number; mostRecentAt: Date }[];
  branchNameById: Record<string, string>;
}

export interface CustomerBulkMetrics {
  metrics: CustomerOrderMetrics;
  favoriteBranch: string | null;
}

// The ONE place order-derived customer metrics are computed (Phase 5's explicit "one canonical
// business definition" requirement) — Customer 360 (admin-customers) and segment matching
// (segments) both call this instead of each recomputing orderCount/totalSpentMinor/
// averageOrderMinor/first-last-order/favoriteBranch independently.
@Injectable()
export class CustomerMetricsService {
  constructor(private readonly repository: CustomerMetricsRepository) {}

  // Single-customer, detail-view shape — includes the full relevant-order list (Customer 360
  // needs it for recentOrders too, not just the aggregates).
  async getMetricsForCustomer(customerId: string): Promise<CustomerDetailMetrics> {
    const orders = await this.repository.findRelevantOrdersForCustomer(customerId);
    const orderCount = orders.length;
    const totalSpentMinor = orders.reduce((sum, order) => sum + order.totalMinor, 0);
    // Money stays integer: rounded to the nearest minor unit rather than ever returning a
    // float, consistent with this project's "no float money" rule everywhere else.
    const averageOrderMinor = orderCount > 0 ? Math.round(totalSpentMinor / orderCount) : 0;

    return {
      metrics: {
        orderCount,
        totalSpentMinor,
        averageOrderMinor,
        firstOrderAt: orderCount > 0 ? orders[orderCount - 1].createdAt : null,
        lastOrderAt: orderCount > 0 ? orders[0].createdAt : null,
      },
      favoriteBranch: computeFavoriteBranchFromOrders(orders),
      orders,
    };
  }

  // Phase 11.4: the SAME order-derived metrics as getMetricsForCustomer (same status rule, same aggregate queries as
  // getBulkMetrics) but bounded — three aggregate queries instead of loading the customer's whole order history — plus the
  // per-branch order counts a unified (CUP + POS) favorite branch needs. Customer 360 uses this; the shapes of
  // getMetricsForCustomer / getBulkMetrics are unchanged.
  async getSummaryForCustomer(customerId: string): Promise<CustomerSummaryMetrics> {
    const [aggregates, branchCounts, branches] = await Promise.all([
      this.repository.aggregateOrderMetricsForCustomers([customerId]),
      this.repository.aggregateBranchCountsForCustomers([customerId]),
      this.repository.findAllBranchNames(),
    ]);
    const row = aggregates[0];
    const orderCount = row ? row._count._all : 0;
    const totalSpentMinor = row ? (row._sum.totalMinor ?? 0) : 0;
    return {
      metrics: {
        orderCount,
        totalSpentMinor,
        averageOrderMinor: orderCount > 0 ? Math.round(totalSpentMinor / orderCount) : 0,
        firstOrderAt: row ? row._min.createdAt : null,
        lastOrderAt: row ? row._max.createdAt : null,
      },
      branches: branchCounts.filter((b) => b.branchId !== null).map((b) => ({ branchId: b.branchId as string, count: b._count._all, mostRecentAt: b._max.createdAt as Date })),
      branchNameById: Object.fromEntries(branches.map((b) => [b.id, b.name])),
    };
  }

  // Phase 11.4: bounded newest-first relevant orders (Customer 360's legacy `recentOrders` block).
  getRecentOrdersForCustomer(customerId: string, take: number) {
    return this.repository.findRecentRelevantOrdersForCustomer(customerId, take);
  }

  // Bulk shape for segment evaluation — ALWAYS returns one entry per requested customerId,
  // defaulting a customer with zero relevant orders to {orderCount:0, totalSpentMinor:0,
  // averageOrderMinor:0, firstOrderAt:null, lastOrderAt:null, favoriteBranch:null} rather than
  // omitting them, so a segment condition can still be evaluated (and correctly not match, per
  // the null-handling rule in segment-evaluator.ts) for a customer who has never ordered.
  async getBulkMetrics(customerIds: string[]): Promise<Map<string, CustomerBulkMetrics>> {
    const result = new Map<string, CustomerBulkMetrics>();
    for (const id of customerIds) {
      result.set(id, {
        metrics: { orderCount: 0, totalSpentMinor: 0, averageOrderMinor: 0, firstOrderAt: null, lastOrderAt: null },
        favoriteBranch: null,
      });
    }
    if (customerIds.length === 0) {
      return result;
    }

    const [orderAggregates, branchCounts, branches] = await Promise.all([
      this.repository.aggregateOrderMetricsForCustomers(customerIds),
      this.repository.aggregateBranchCountsForCustomers(customerIds),
      this.repository.findAllBranchNames(),
    ]);
    const branchNameById = new Map(branches.map((b) => [b.id, b.name]));

    // Reduce (customerId, branchId) counts into one favorite branch per customer: highest
    // count, ties broken by the most recently used branch.
    const favoriteByCustomer = new Map<string, { branchId: string; count: number; mostRecentAt: Date }>();
    for (const row of branchCounts) {
      if (!row.branchId) continue;
      const candidate = { branchId: row.branchId, count: row._count._all, mostRecentAt: row._max.createdAt! };
      const existing = favoriteByCustomer.get(row.customerId);
      if (!existing || candidate.count > existing.count || (candidate.count === existing.count && candidate.mostRecentAt > existing.mostRecentAt)) {
        favoriteByCustomer.set(row.customerId, candidate);
      }
    }

    for (const row of orderAggregates) {
      const orderCount = row._count._all;
      const totalSpentMinor = row._sum.totalMinor ?? 0;
      const favorite = favoriteByCustomer.get(row.customerId);
      result.set(row.customerId, {
        metrics: {
          orderCount,
          totalSpentMinor,
          averageOrderMinor: orderCount > 0 ? Math.round(totalSpentMinor / orderCount) : 0,
          firstOrderAt: row._min.createdAt,
          lastOrderAt: row._max.createdAt,
        },
        favoriteBranch: favorite ? (branchNameById.get(favorite.branchId) ?? null) : null,
      });
    }

    return result;
  }

  findAllCustomerIds(): Promise<{ id: string }[]> {
    return this.repository.findAllCustomerIds();
  }
}

interface OrderWithBranchForFavorite {
  branch: { id: string; name: string } | null;
  createdAt: Date;
}

// Highest order count per branch; ties broken by the most recently used branch. A single pass
// over the already-fetched, newest-first order list — no extra query. Never persisted.
function computeFavoriteBranchFromOrders(orders: OrderWithBranchForFavorite[]): CustomerFavoriteBranch | null {
  const byBranch = new Map<string, { name: string; count: number; mostRecentAt: Date }>();
  for (const order of orders) {
    if (!order.branch) continue;
    const existing = byBranch.get(order.branch.id);
    if (existing) {
      existing.count += 1;
      // orders are iterated newest-first, so the first time a branch is seen is already its
      // most recent order — no comparison needed on subsequent hits.
    } else {
      byBranch.set(order.branch.id, { name: order.branch.name, count: 1, mostRecentAt: order.createdAt });
    }
  }

  let best: { id: string; name: string; count: number; mostRecentAt: Date } | null = null;
  for (const [id, data] of byBranch) {
    if (!best || data.count > best.count || (data.count === best.count && data.mostRecentAt > best.mostRecentAt)) {
      best = { id, ...data };
    }
  }
  return best ? { id: best.id, name: best.name } : null;
}
