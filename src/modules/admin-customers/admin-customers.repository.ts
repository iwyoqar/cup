import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CUSTOMER_METRICS_ORDER_STATUSES } from '../customer-metrics/customer-metrics-order-statuses';

export interface CustomerListMetrics {
  orderCount: number;
  totalSpentMinor: number;
  lastOrderAt: Date | null;
}

@Injectable()
export class AdminCustomersRepository {
  constructor(private readonly prisma: PrismaService) {}

  // Two bounded queries regardless of page size (spec Part 13's N+1 avoidance): one for the
  // customer page itself, one aggregated groupBy for just that page's metrics — never a
  // per-customer query loop. This is a page-scoped variant of the same aggregation shape
  // CustomerMetricsService uses for its own bulk case — kept here rather than routed through
  // that shared service because it's scoped by a specific page of customer IDs (from the
  // search+pagination query just above it), a genuinely different access pattern from "compute
  // for a known list of customers" (Customer 360) or "compute for every customer" (segments).
  // Phase 26: isActive: true excludes deactivated customers from the normal Admin list/search by
  // default — findCustomerById (Customer 360 detail) below is deliberately NOT filtered, so a
  // deactivated customer's historical profile stays reachable by direct id (e.g. from an audit
  // event or a Poster confirmation), just not discoverable through the ordinary list anymore.
  async findManyWithMetrics(options: { search?: string; cursor?: string; take: number }) {
    const customers = await this.prisma.customer.findMany({
      where: { isActive: true, ...buildSearchWhere(options.search) },
      orderBy: { createdAt: 'desc' },
      take: options.take,
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
      include: { telegramAccount: { select: { username: true } } },
    });

    if (customers.length === 0) {
      return { customers, metricsByCustomerId: new Map<string, CustomerListMetrics>() };
    }

    const customerIds = customers.map((c) => c.id);
    const grouped = await this.prisma.order.groupBy({
      by: ['customerId'],
      where: { customerId: { in: customerIds }, status: { in: [...CUSTOMER_METRICS_ORDER_STATUSES] } },
      _count: { _all: true },
      _sum: { totalMinor: true },
      _max: { createdAt: true },
    });

    const metricsByCustomerId = new Map<string, CustomerListMetrics>(
      grouped.map((g) => [
        g.customerId,
        { orderCount: g._count._all, totalSpentMinor: g._sum.totalMinor ?? 0, lastOrderAt: g._max.createdAt },
      ]),
    );

    return { customers, metricsByCustomerId };
  }

  findCustomerById(customerId: string) {
    return this.prisma.customer.findUnique({
      where: { id: customerId },
      include: { telegramAccount: { select: { username: true } } },
    });
  }
}

// Exported (Reports Phase D1) so the Customers report searches by exactly the same rule; logic unchanged.
// Search is server-side only (spec Part 10) — no arbitrary query capability is ever exposed
// to the Admin frontend, just a plain-text term matched against displayName/phone/username.
export function buildSearchWhere(search: string | undefined): Prisma.CustomerWhereInput {
  const trimmed = search?.trim();
  if (!trimmed) {
    return {};
  }
  const digitsOnly = trimmed.replace(/\D/g, '');
  const conditions: Prisma.CustomerWhereInput[] = [
    { displayName: { contains: trimmed } },
    { telegramAccount: { username: { contains: trimmed } } },
  ];
  // Matches the existing normalizeTelegramPhone convention ("+998912090511" — leading "+",
  // digits only): stripping the search term to digits and matching as a substring works
  // whether the admin types with a "+", spaces, dashes, or a partial number.
  if (digitsOnly.length > 0) {
    conditions.push({ phone: { contains: digitsOnly } });
  }
  return { OR: conditions };
}
