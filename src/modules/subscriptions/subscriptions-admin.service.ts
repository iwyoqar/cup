import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ConfigService } from '../../common/config/config.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { isUniqueConstraintViolation } from '../../common/util/prisma-errors';
import { AnalyticsPeriod, businessDateOf, enumerateDates, resolveAnalyticsRange, ResolvedRange } from '../analytics/analytics-period';
import { SubscriptionAuditService, SUBSCRIPTION_AUDIT } from './subscription-audit.service';
import { computeUsage, effectiveStatus } from './subscription-rules';
import { COUNTED_REDEMPTION_STATUSES, RedemptionStatus } from './subscription.types';
import { SubscriptionsRepository } from './subscriptions.repository';
import { purchaseView, SubscriptionsService } from './subscriptions.service';

export interface PeriodQuery {
  period?: string;
  startDate?: string;
  endDate?: string;
}

const PERIODS: AnalyticsPeriod[] = ['today', 'yesterday', 'last7', 'last30', 'custom'];
const PAGE = 50;

// Coffee Subscription — Admin read models. Every period goes through resolveAnalyticsRange (the canonical UTC+5 business-day range), so a
// subscription figure and an Analytics figure for "last7" always cover exactly the same instants. Every list is bounded and built with a
// fixed number of queries (no per-row query).
//
// Semantics (docs/SUBSCRIPTIONS.md §Reporting):
//   subscription revenue  = amountMinor of purchases PAID through a payment provider (activationSource PAYMENT), by paidAt. Manual (admin)
//                           activations are shown separately and are NOT revenue.
//   portions sold         = totalPortions of subscriptions activated in the period (split by source); portions consumed = CONFIRMED
//                           redemptions' portionCost by redeemedAt. A redemption is never revenue.
@Injectable()
export class SubscriptionsAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: SubscriptionsRepository,
    private readonly subscriptions: SubscriptionsService,
    private readonly audit: SubscriptionAuditService,
    private readonly config: ConfigService,
  ) {}

  private get offset() {
    return this.config.env.BUSINESS_TIMEZONE_OFFSET_MINUTES;
  }

  range(q: PeriodQuery, now = new Date()): ResolvedRange {
    const period = (q.period ?? 'last30') as AnalyticsPeriod;
    if (!PERIODS.includes(period)) throw new BadRequestException('Unknown period.');
    return resolveAnalyticsRange({ period, startDate: q.startDate, endDate: q.endDate }, now, this.offset);
  }

  // ---- overview ---------------------------------------------------------------------------------------------------------------------
  async overview(q: PeriodQuery, now = new Date()) {
    const r = this.range(q, now);
    const inRange = { gte: r.from, lt: r.to };
    const [runningNow, scheduledNow, activated, cancelled, ended, consumed, customersNow, customersEver, daily] = await Promise.all([
      this.prisma.subscription.count({ where: { status: 'ACTIVE', startsAt: { lte: now }, endsAt: { gt: now } } }),
      this.prisma.subscription.count({ where: { status: 'ACTIVE', startsAt: { gt: now } } }),
      this.prisma.subscriptionPurchase.findMany({ where: { status: 'PAID', paidAt: inRange }, select: { kind: true, amountMinor: true, activationSource: true, subscription: { select: { totalPortions: true } } } }),
      this.prisma.subscription.count({ where: { status: 'CANCELLED', activatedAt: { not: null }, cancelledAt: inRange } }),
      this.prisma.subscription.findMany({ where: { status: { in: ['ACTIVE', 'EXPIRED'] }, endsAt: { gte: r.from, lt: r.to, lte: now } }, select: { id: true, totalPortions: true } }),
      this.prisma.subscriptionRedemption.aggregate({ where: { status: 'CONFIRMED', redeemedAt: inRange }, _sum: { portionCost: true }, _count: { _all: true } }),
      this.prisma.subscription.findMany({ where: { status: 'ACTIVE', startsAt: { lte: now }, endsAt: { gt: now } }, select: { customerId: true }, distinct: ['customerId'] }),
      this.prisma.subscription.findMany({ where: { activatedAt: { not: null } }, select: { customerId: true }, distinct: ['customerId'] }),
      this.dailyRedemptions(r),
    ]);
    const endedConsumed = await this.consumedBySubscription(ended.map((e) => e.id));
    const unused = ended.reduce((s, e) => s + Math.max(0, e.totalPortions - (endedConsumed.get(e.id) ?? 0)), 0);
    const paid = activated.filter((a) => a.activationSource === 'PAYMENT');
    const manual = activated.filter((a) => a.activationSource === 'ADMIN_MANUAL');
    return {
      period: { startDate: r.startDate, endDate: r.endDate },
      activeSubscriptions: runningNow,
      scheduledSubscriptions: scheduledNow,
      newSubscriptions: activated.filter((a) => a.kind === 'NEW').length,
      renewals: activated.filter((a) => a.kind === 'RENEWAL').length,
      expiredSubscriptions: ended.length,
      cancelledSubscriptions: cancelled,
      subscriptionRevenueMinor: paid.reduce((s, a) => s + a.amountMinor, 0),
      manualActivations: { count: manual.length, nominalMinor: manual.reduce((s, a) => s + a.amountMinor, 0) },
      portionsSold: paid.reduce((s, a) => s + a.subscription.totalPortions, 0),
      portionsIssuedManually: manual.reduce((s, a) => s + a.subscription.totalPortions, 0),
      portionsConsumed: consumed._sum.portionCost ?? 0,
      unusedExpiredPortions: unused,
      redemptionCount: consumed._count._all,
      customersWithActiveSubscription: customersNow.length,
      customersEver: customersEver.length,
      daily,
    };
  }

  private async consumedBySubscription(ids: string[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.subscriptionRedemption.groupBy({ by: ['subscriptionId'], where: { subscriptionId: { in: ids }, status: 'CONFIRMED' }, _sum: { portionCost: true } });
    return new Map(rows.map((x) => [x.subscriptionId, x._sum.portionCost ?? 0]));
  }

  private async dailyRedemptions(r: ResolvedRange) {
    const [reds, paid] = await Promise.all([
      this.prisma.subscriptionRedemption.findMany({ where: { status: 'CONFIRMED', redeemedAt: { gte: r.from, lt: r.to } }, select: { businessDate: true, portionCost: true } }),
      this.prisma.subscriptionPurchase.findMany({ where: { status: 'PAID', activationSource: 'PAYMENT', paidAt: { gte: r.from, lt: r.to } }, select: { paidAt: true, amountMinor: true } }),
    ]);
    const byDay = new Map(enumerateDates(r.startDate, r.endDate).map((d) => [d, { date: d, portions: 0, redemptions: 0, revenueMinor: 0, sales: 0 }]));
    for (const x of reds) {
      const row = byDay.get(x.businessDate);
      if (row) {
        row.portions += x.portionCost;
        row.redemptions += 1;
      }
    }
    for (const p of paid) {
      const row = byDay.get(businessDateOf(p.paidAt!, this.offset));
      if (row) {
        row.revenueMinor += p.amountMinor;
        row.sales += 1;
      }
    }
    return [...byDay.values()];
  }

  // ---- active -----------------------------------------------------------------------------------------------------------------------
  async active(q: { q?: string; planId?: string; status?: string; page?: string }, now = new Date()) {
    const page = Math.max(1, Number(q.page) || 1);
    // status filter: RUNNING (usable period now), SCHEDULED (paid renewal not started yet), PAUSED, or everything not yet over.
    const statusWhere: Prisma.SubscriptionWhereInput =
      q.status === 'RUNNING' ? { status: 'ACTIVE', startsAt: { lte: now } } : q.status === 'SCHEDULED' ? { status: 'ACTIVE', startsAt: { gt: now } } : q.status === 'PAUSED' ? { status: 'PAUSED' } : { status: { in: ['ACTIVE', 'PAUSED'] } };
    const where: Prisma.SubscriptionWhereInput = {
      ...statusWhere,
      endsAt: { gt: now },
      ...(q.planId ? { planId: q.planId } : {}),
      ...(q.q ? { customer: customerSearch(q.q) } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.subscription.count({ where }),
      this.prisma.subscription.findMany({ where, orderBy: { endsAt: 'asc' }, skip: (page - 1) * PAGE, take: PAGE, include: { customer: { select: { id: true, displayName: true, phone: true, loyaltyCode: true } } } }),
    ]);
    const views = await this.subscriptions.viewsFor(rows, now);
    return {
      page,
      pages: Math.max(1, Math.ceil(total / PAGE)),
      total,
      items: rows.map((row, i) => ({ ...views[i], customer: customerRef(row.customer) })),
    };
  }

  // ---- redemptions ------------------------------------------------------------------------------------------------------------------
  async redemptions(q: PeriodQuery & { q?: string; planId?: string; branchId?: string; productId?: string; status?: string; page?: string }, now = new Date()) {
    const r = this.range(q, now);
    const page = Math.max(1, Number(q.page) || 1);
    const statuses: RedemptionStatus[] = ['REQUESTED', 'POSTER_MUTATING', 'CONFIRMED', 'FAILED', 'UNKNOWN'];
    if (q.status && !statuses.includes(q.status as RedemptionStatus)) throw new BadRequestException('Unknown status.');
    const where: Prisma.SubscriptionRedemptionWhereInput = {
      requestedAt: { gte: r.from, lt: r.to },
      ...(q.status ? { status: q.status } : {}),
      ...(q.planId ? { subscription: { planId: q.planId } } : {}),
      ...(q.branchId ? { branchId: q.branchId } : {}),
      ...(q.productId ? { productId: q.productId } : {}),
      ...(q.q ? { customer: customerSearch(q.q) } : {}),
    };
    const [total, sums, rows, branches, products, plans] = await Promise.all([
      this.prisma.subscriptionRedemption.count({ where }),
      this.prisma.subscriptionRedemption.groupBy({ by: ['status'], where, _sum: { portionCost: true }, _count: { _all: true } }),
      this.prisma.subscriptionRedemption.findMany({
        where,
        orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * PAGE,
        take: PAGE,
        include: { customer: { select: { id: true, displayName: true, phone: true, loyaltyCode: true } }, branch: { select: { name: true } }, subscription: { select: { planName: true, id: true } } },
      }),
      this.prisma.branch.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      this.prisma.subscriptionProduct.findMany({ select: { product: { select: { id: true, name: true } } } }),
      this.prisma.subscriptionPlan.findMany({ select: { id: true, name: true }, orderBy: { sortOrder: 'asc' } }),
    ]);
    return {
      period: { startDate: r.startDate, endDate: r.endDate },
      filters: { branches, products: products.map((p) => p.product), plans },
      page,
      pages: Math.max(1, Math.ceil(total / PAGE)),
      total,
      byStatus: sums.map((s) => ({ status: s.status, count: s._count._all, portions: s._sum.portionCost ?? 0 })),
      items: rows.map((x) => redemptionRow(x)),
    };
  }

  async redemptionDetail(id: string) {
    const x = await this.prisma.subscriptionRedemption.findUnique({
      where: { id },
      include: { customer: { select: { id: true, displayName: true, phone: true, loyaltyCode: true } }, branch: { select: { name: true } }, subscription: { select: { id: true, planName: true, startBusinessDate: true, endBusinessDate: true, status: true } }, product: { select: { name: true, isActive: true } } },
    });
    if (!x) throw new NotFoundException('Redemption not found.');
    return {
      ...redemptionRow(x),
      attemptId: x.attemptId,
      productId: x.productId,
      posterProductId: x.posterProductId,
      posterAccount: x.posterAccount,
      posterSpotId: x.posterSpotId,
      posterTabletId: x.posterTabletId,
      posterOrderId: x.posterOrderId,
      posterTransactionProductId: x.posterTransactionProductId,
      employeeIdentifier: x.employeeIdentifier,
      claimSequence: x.claimSequence,
      businessDate: x.businessDate,
      reconciledAt: x.reconciledAt?.toISOString() ?? null,
      resolvedBy: x.resolvedBy,
      resolutionNote: x.resolutionNote,
      subscription: { ...x.subscription },
      createdAt: x.createdAt.toISOString(),
      updatedAt: x.updatedAt.toISOString(),
    };
  }

  // An UNKNOWN redemption (ambiguous Poster result) is resolved by a human who checked the receipt: CONFIRMED consumes the held portions,
  // FAILED releases them. Runs under the subscription lock; nothing else is ever resolvable by hand.
  async resolveRedemption(id: string, outcome: 'CONFIRMED' | 'FAILED', note: string, adminId: string) {
    const row = await this.prisma.subscriptionRedemption.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Redemption not found.');
    if (row.status !== 'UNKNOWN') throw new ConflictException('Only an UNKNOWN redemption can be resolved by hand.');
    try {
      await this.prisma.runTransaction(async (tx) => {
        await this.repository.lockSubscriptionTx(tx, row.subscriptionId);
        const n = await tx.subscriptionRedemption.updateMany({
          where: { id, status: 'UNKNOWN' },
          data:
            outcome === 'CONFIRMED'
              ? { status: 'CONFIRMED', redeemedAt: row.requestedAt, redeemedForPosterOrderId: row.posterOrderId, resolvedBy: adminId, resolutionNote: note }
              : { status: 'FAILED', failureReason: 'RESOLVED_BY_ADMIN', resolvedBy: adminId, resolutionNote: note },
        });
        if (n.count === 0) throw new ConflictException('The redemption changed state; reload it.');
      });
    } catch (err) {
      if (isUniqueConstraintViolation(err)) throw new ConflictException('This Poster order already has a confirmed subscription redemption.');
      throw err;
    }
    await this.audit.record({ type: 'ADMIN', id: adminId }, SUBSCRIPTION_AUDIT.REDEMPTION_RESOLVED, outcome, row.customerId, row.branchId);
    return this.redemptionDetail(id);
  }

  // ---- customers --------------------------------------------------------------------------------------------------------------------
  async customers(q: { q?: string; page?: string }, now = new Date()) {
    const page = Math.max(1, Number(q.page) || 1);
    const where: Prisma.CustomerWhereInput = { subscriptions: { some: { activatedAt: { not: null } } }, ...(q.q ? customerSearch(q.q) : {}) };
    const [total, customers] = await Promise.all([
      this.prisma.customer.count({ where }),
      this.prisma.customer.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * PAGE, take: PAGE, select: { id: true, displayName: true, phone: true, loyaltyCode: true } }),
    ]);
    const ids = customers.map((c) => c.id);
    const [subs, reds] = await Promise.all([
      this.prisma.subscription.findMany({ where: { customerId: { in: ids }, activatedAt: { not: null } }, select: { id: true, customerId: true, planName: true, status: true, startsAt: true, endsAt: true, totalPortions: true, dailyPortionLimit: true, cooldownMinutes: true } }),
      this.prisma.subscriptionRedemption.findMany({ where: { customerId: { in: ids }, status: { in: COUNTED_REDEMPTION_STATUSES } }, select: { subscriptionId: true, customerId: true, status: true, portionCost: true, businessDate: true, requestedAt: true, redeemedAt: true } }),
    ]);
    return {
      page,
      pages: Math.max(1, Math.ceil(total / PAGE)),
      total,
      items: customers.map((c) => {
        const own = subs.filter((s) => s.customerId === c.id);
        const ownReds = reds.filter((x) => x.customerId === c.id);
        const current = own.find((s) => effectiveStatus(s, now) === 'ACTIVE') ?? null;
        const currentUsage = current ? computeUsage(current, ownReds.filter((x) => x.subscriptionId === current.id), now, this.offset) : null;
        const consumed = ownReds.filter((x) => x.status === 'CONFIRMED').reduce((s, x) => s + x.portionCost, 0);
        const unused = own
          .filter((s) => s.endsAt && s.endsAt <= now)
          .reduce((sum, s) => sum + Math.max(0, s.totalPortions - ownReds.filter((x) => x.subscriptionId === s.id && x.status === 'CONFIRMED').reduce((a, x) => a + x.portionCost, 0)), 0);
        const lastConfirmed = ownReds.filter((x) => x.status === 'CONFIRMED').map((x) => x.redeemedAt ?? x.requestedAt).sort((a, b) => b.getTime() - a.getTime())[0];
        return {
          customer: customerRef(c),
          currentPlan: current?.planName ?? null,
          currentRemaining: currentUsage?.remainingPortions ?? null,
          nextAvailableAt: currentUsage?.nextAvailableAt ?? null,
          totalSubscriptions: own.length,
          portionsPurchased: own.reduce((s, x) => s + x.totalPortions, 0),
          portionsConsumed: consumed,
          unusedExpiredPortions: unused,
          redemptionCount: ownReds.filter((x) => x.status === 'CONFIRMED').length,
          lastRedemptionAt: lastConfirmed ? lastConfirmed.toISOString() : null,
        };
      }),
    };
  }

  async customerDetail(customerId: string, now = new Date()) {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId }, select: { id: true, displayName: true, phone: true, loyaltyCode: true, isActive: true } });
    if (!customer) throw new NotFoundException('Customer not found.');
    const [summary, history, purchases, redemptions] = await Promise.all([
      this.subscriptions.customerSummary(customerId, now),
      this.subscriptions.customerHistory(customerId, now),
      this.repository.listPurchasesForCustomer(customerId),
      this.prisma.subscriptionRedemption.findMany({
        where: { customerId },
        orderBy: { requestedAt: 'desc' },
        take: 50,
        include: { customer: { select: { id: true, displayName: true, phone: true, loyaltyCode: true } }, branch: { select: { name: true } }, subscription: { select: { planName: true, id: true } } },
      }),
    ]);
    return {
      customer: { ...customerRef(customer), isActive: customer.isActive },
      current: summary.current,
      upcoming: summary.upcoming,
      pendingPurchase: summary.pendingPurchase,
      subscriptions: history.subscriptions,
      purchases: purchases.map((p) => ({ id: p.id, kind: p.kind, status: p.status, planName: p.plan.name, amountMinor: p.amountMinor, activationSource: p.activationSource, provider: p.provider, createdAt: p.createdAt.toISOString(), paidAt: p.paidAt?.toISOString() ?? null, subscriptionId: p.subscriptionId })),
      redemptions: redemptions.map((x) => redemptionRow(x)),
    };
  }

  // ---- revenue ----------------------------------------------------------------------------------------------------------------------
  async revenue(q: PeriodQuery, now = new Date()) {
    const r = this.range(q, now);
    const [paid, runningNow] = await Promise.all([
      this.prisma.subscriptionPurchase.findMany({ where: { status: 'PAID', paidAt: { gte: r.from, lt: r.to } }, select: { kind: true, amountMinor: true, activationSource: true, paidAt: true, planId: true, plan: { select: { name: true } } } }),
      this.prisma.subscription.count({ where: { status: 'ACTIVE', startsAt: { lte: now }, endsAt: { gt: now } } }),
    ]);
    const viaPayment = paid.filter((p) => p.activationSource === 'PAYMENT');
    const manual = paid.filter((p) => p.activationSource === 'ADMIN_MANUAL');
    const byPlan = new Map<string, { planId: string; planName: string; count: number; revenueMinor: number; manualCount: number }>();
    for (const p of paid) {
      const row = byPlan.get(p.planId) ?? { planId: p.planId, planName: p.plan.name, count: 0, revenueMinor: 0, manualCount: 0 };
      if (p.activationSource === 'PAYMENT') {
        row.count += 1;
        row.revenueMinor += p.amountMinor;
      } else row.manualCount += 1;
      byPlan.set(p.planId, row);
    }
    const byDay = new Map(enumerateDates(r.startDate, r.endDate).map((d) => [d, { date: d, count: 0, revenueMinor: 0 }]));
    for (const p of viaPayment) {
      const row = byDay.get(businessDateOf(p.paidAt!, this.offset));
      if (row) {
        row.count += 1;
        row.revenueMinor += p.amountMinor;
      }
    }
    return {
      period: { startDate: r.startDate, endDate: r.endDate },
      subscriptionSalesMinor: viaPayment.reduce((s, p) => s + p.amountMinor, 0),
      subscriptionsSold: viaPayment.length,
      newSubscriptions: viaPayment.filter((p) => p.kind === 'NEW').length,
      renewals: viaPayment.filter((p) => p.kind === 'RENEWAL').length,
      activeSubscriptions: runningNow,
      manualActivations: { count: manual.length, nominalMinor: manual.reduce((s, p) => s + p.amountMinor, 0) },
      byPlan: [...byPlan.values()].sort((a, b) => b.revenueMinor - a.revenueMinor),
      byDay: [...byDay.values()],
      paymentProvidersIntegrated: false,
      notes: [
        'Subscription revenue counts only purchases confirmed PAID by a payment provider. No provider is integrated yet, so this is 0 until one is.',
        'Manual (admin) activations are listed separately and are never revenue.',
        'Redeeming subscription coffee is consumption, not a sale: it adds no revenue anywhere in CUP.',
        'Revenue is shown when paid (cash basis). Deferred recognition over the subscription period is not supported by CUP Finance yet.',
      ],
    };
  }

  // Admin-initiated purchase for a customer (e.g. a counter sale that will be activated manually). Same purchase path as the Mini App.
  async createPurchaseFor(customerId: string, planId: string, idempotencyKey: string, adminId: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId }, select: { id: true, isActive: true } });
    if (!customer || !customer.isActive) throw new NotFoundException('Customer not found or inactive.');
    return this.subscriptions.createPurchase(customerId, planId, idempotencyKey, { type: 'ADMIN', id: adminId });
  }

  async purchase(id: string) {
    const p = await this.repository.findPurchase(this.prisma, id);
    if (!p) throw new NotFoundException('Purchase not found.');
    return { ...purchaseView(p), activationSource: p.activationSource, provider: p.provider, activationNote: p.activationNote, customerId: p.customerId };
  }
}

function customerSearch(raw: string): Prisma.CustomerWhereInput {
  const q = raw.trim().slice(0, 64);
  const digits = q.replace(/\D/g, '');
  return { OR: [{ displayName: { contains: q } }, { loyaltyCode: { contains: q.toUpperCase() } }, ...(digits.length >= 4 ? [{ phone: { contains: digits } }] : [])] };
}

function customerRef(c: { id: string; displayName: string | null; phone: string | null; loyaltyCode: string | null }) {
  return { id: c.id, name: c.displayName, phone: c.phone, code: c.loyaltyCode };
}

function redemptionRow(x: {
  id: string;
  status: string;
  failureReason: string | null;
  productName: string;
  portionCost: number;
  requestedAt: Date;
  redeemedAt: Date | null;
  posterTransactionId: string | null;
  reconciliationStatus: string | null;
  customer: { id: string; displayName: string | null; phone: string | null; loyaltyCode: string | null };
  branch: { name: string } | null;
  subscription: { planName: string; id: string };
}) {
  return {
    id: x.id,
    status: x.status,
    failureReason: x.failureReason,
    at: (x.redeemedAt ?? x.requestedAt).toISOString(),
    requestedAt: x.requestedAt.toISOString(),
    redeemedAt: x.redeemedAt?.toISOString() ?? null,
    customer: customerRef(x.customer),
    subscriptionId: x.subscription.id,
    planName: x.subscription.planName,
    productName: x.productName,
    portionCost: x.portionCost,
    branchName: x.branch?.name ?? null,
    posterTransactionId: x.posterTransactionId,
    reconciliationStatus: x.reconciliationStatus,
  };
}
