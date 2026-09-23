import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CUSTOMER_METRICS_ORDER_STATUSES } from './customer-metrics-order-statuses';

@Injectable()
export class CustomerMetricsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // A single customer's own relevant order volume is naturally small (a coffee shop's repeat
  // customer, not a bulk import) — fetching the full set lets the caller compute orderCount/
  // totalSpentMinor/first-last-order/favoriteBranch/recentOrders in one pass, cheaper than
  // several separate aggregate queries for a single-customer detail view.
  findRelevantOrdersForCustomer(customerId: string) {
    return this.prisma.order.findMany({
      where: { customerId, status: { in: [...CUSTOMER_METRICS_ORDER_STATUSES] } },
      orderBy: { createdAt: 'desc' },
      include: { branch: true },
    });
  }

  // Phase 11.4: the newest few relevant orders only (Customer 360's compact recent list) — bounded, unlike
  // findRelevantOrdersForCustomer above which returns the customer's whole relevant history.
  findRecentRelevantOrdersForCustomer(customerId: string, take: number) {
    return this.prisma.order.findMany({
      where: { customerId, status: { in: [...CUSTOMER_METRICS_ORDER_STATUSES] } },
      orderBy: { createdAt: 'desc' },
      take,
      include: { branch: true },
    });
  }

  // Bulk, bounded aggregation for many customers at once (segment evaluation) — ONE query
  // regardless of customer count, never a per-customer loop. Scoped to `customerIds` when
  // provided (e.g. a specific page); omitted entirely computes it for every customer, which is
  // the deliberate, documented tradeoff for Phase 5's "evaluate against current data" design
  // (see segments.service.ts's comment on why this doesn't yet push conditions into SQL).
  aggregateOrderMetricsForCustomers(customerIds?: string[]) {
    return this.prisma.order.groupBy({
      by: ['customerId'],
      where: {
        status: { in: [...CUSTOMER_METRICS_ORDER_STATUSES] },
        ...(customerIds ? { customerId: { in: customerIds } } : {}),
      },
      _count: { _all: true },
      _sum: { totalMinor: true },
      _min: { createdAt: true },
      _max: { createdAt: true },
    });
  }

  // Grouped by (customerId, branchId) — reduced in-memory by the caller into "favorite branch
  // per customer" (highest count, ties broken by most recent order). Still one query.
  aggregateBranchCountsForCustomers(customerIds?: string[]) {
    return this.prisma.order.groupBy({
      by: ['customerId', 'branchId'],
      where: {
        status: { in: [...CUSTOMER_METRICS_ORDER_STATUSES] },
        branchId: { not: null },
        ...(customerIds ? { customerId: { in: customerIds } } : {}),
      },
      _count: { _all: true },
      _max: { createdAt: true },
    });
  }

  findAllBranchNames() {
    return this.prisma.branch.findMany({ select: { id: true, name: true } });
  }

  // Phase 26: the base "universe of customers" query for segment matching and promotion audience
  // selection (see SegmentsService, PromotionAudienceService) — isActive: true means a deactivated
  // customer can never be selected into a new segment/promotion/campaign audience, without needing
  // to touch the condition-evaluation logic itself downstream.
  findAllCustomerIds() {
    return this.prisma.customer.findMany({ where: { isActive: true }, select: { id: true } });
  }
}
