import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../../common/config/config.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { isUniqueConstraintViolation } from '../../common/util/prisma-errors';
import { BranchRepository } from '../branches/branch.repository';
import { CatalogRepository } from '../catalog/catalog.repository';
import { CustomersRepository } from '../customers/customers.repository';
import { normalizeLoyaltyCode } from '../customers/loyalty-code';
import { SubscriptionActor, SubscriptionAuditService, SUBSCRIPTION_AUDIT } from '../subscriptions/subscription-audit.service';
import { computeUsage, subscriptionIneligibility } from '../subscriptions/subscription-rules';
import { RedemptionStatus, SubscriptionRedemptionFailureReason } from '../subscriptions/subscription.types';
import { SubscriptionsRepository } from '../subscriptions/subscriptions.repository';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { businessDateOf } from '../analytics/analytics-period';
import { PosContext } from './pos-widget-signature';
import { PosterRewardMutationService } from './poster-reward-mutation.service';

export type SubscriptionCustomerRef = { posterClientId: string } | { code: string };

export interface RedeemSubscriptionRequest {
  attemptId: string;
  customer: SubscriptionCustomerRef;
  posterOrderId: string;
  posterProductId: string;
  employeeIdentifier: string | null;
}

export interface RedeemSubscriptionResponse {
  attemptId: string;
  status: RedemptionStatus;
  failureReason: SubscriptionRedemptionFailureReason | null;
  productName: string | null;
  portionCost: number | null;
  after: { remainingPortions: number; totalPortions: number; todayRemainingPortions: number; nextAvailableAt: string | null } | null;
}

// A request that cannot even be attributed to a customer / product (stale widget state) — no row is written, same as rewards.
export class RedeemSubscriptionInputError extends Error {
  constructor(readonly reason: SubscriptionRedemptionFailureReason) {
    super(reason);
  }
}

const UNRESOLVED: RedemptionStatus[] = ['REQUESTED', 'POSTER_MUTATING'];

// Coffee Subscription at the register. The summary is READ-ONLY. The redemption is the only write and follows the proven Phase 22 shape:
//   A. a SHORT transaction that first takes the subscription row lock (atomic UPDATE of usageVersion), then re-reads the subscription and
//      its redemptions and re-runs EVERY rule (status, dates, balance, daily limit, cooldown, product mapping, one-per-order, in-flight
//      conflict) against that fresh state, and only then inserts the redemption as POSTER_MUTATING (holding its portions). Two concurrent
//      requests are serialized by the lock, so the second one always sees the first one's held portions: the last portion, the last daily
//      portion and the cooldown can never be taken twice.
//   B. OUTSIDE any transaction: the verified addTransactionProduct price-0 mutation (PosterRewardMutationService — the same code rewards use),
//      which also refuses, before mutating, an order whose Poster client is not this customer.
//   C. a SECOND short transaction commits the outcome: CONFIRMED (consumed), FAILED (released — only when Poster provably was not changed or
//      explicitly rejected) or UNKNOWN (ambiguous — portions stay held, never auto-retried; resolved from the closed receipt or by an admin).
// The widget decides nothing: it sends which customer, which open order and which product; the backend decides everything else.
@Injectable()
export class PosWidgetSubscriptionService {
  private readonly logger = new Logger(PosWidgetSubscriptionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: SubscriptionsRepository,
    private readonly subscriptions: SubscriptionsService,
    private readonly customers: CustomersRepository,
    private readonly catalog: CatalogRepository,
    private readonly branches: BranchRepository,
    private readonly mutation: PosterRewardMutationService,
    private readonly audit: SubscriptionAuditService,
    private readonly config: ConfigService,
  ) {}

  private get offset() {
    return this.config.env.BUSINESS_TIMEZONE_OFFSET_MINUTES;
  }

  // ---- summary (read-only) ------------------------------------------------------------------------------------------------------------
  async summaryFor(customerId: string, now: Date = new Date()) {
    const [{ current, upcoming }, mappings, recent] = await Promise.all([
      this.subscriptions.currentAndUpcoming(customerId, now),
      this.repository.listProductMappings(true),
      this.prisma.subscriptionRedemption.findMany({ where: { customerId, status: 'CONFIRMED' }, orderBy: { redeemedAt: 'desc' }, take: 5, select: { productName: true, portionCost: true, redeemedAt: true, branch: { select: { name: true } } } }),
    ]);
    let blockedReason: string | null = null;
    let products: { posterProductId: string; name: string; portionCost: number; eligible: boolean; reason: string | null }[] = [];
    if (current) {
      const sub = await this.repository.findSubscription(this.prisma, current.id);
      const reds = await this.repository.countedRedemptions(this.prisma, [current.id]);
      blockedReason = subscriptionIneligibility(sub, reds, 1, now, this.offset);
      products = mappings.map((m) => {
        const reason = subscriptionIneligibility(sub, reds, m.portionCost, now, this.offset);
        return { posterProductId: m.product.posterProductId, name: m.product.name, portionCost: m.portionCost, eligible: reason === null, reason };
      });
    } else {
      blockedReason = upcoming.length > 0 ? 'SUBSCRIPTION_NOT_STARTED' : 'NO_ACTIVE_SUBSCRIPTION';
    }
    return {
      redemption: { enabled: this.config.env.POS_SUBSCRIPTION_REDEMPTION_ENABLED },
      current: current
        ? {
            planName: current.planName,
            status: current.effectiveStatus,
            endBusinessDate: current.endBusinessDate,
            ...current.usage,
          }
        : null,
      upcoming: upcoming.map((u) => ({ planName: u.planName, startBusinessDate: u.startBusinessDate, endBusinessDate: u.endBusinessDate })),
      blockedReason,
      products,
      recent: recent.map((r) => ({ productName: r.productName, portionCost: r.portionCost, at: r.redeemedAt?.toISOString() ?? null, branchName: r.branch?.name ?? null })),
    };
  }

  async resolveCustomer(ref: SubscriptionCustomerRef) {
    if ('posterClientId' in ref) return this.customers.findByPosterClientId(ref.posterClientId);
    const code = normalizeLoyaltyCode(ref.code);
    return code ? this.customers.findByLoyaltyCode(code) : null;
  }

  // ---- redemption ---------------------------------------------------------------------------------------------------------------------
  async redeem(ctx: PosContext, req: RedeemSubscriptionRequest): Promise<RedeemSubscriptionResponse> {
    const actor: SubscriptionActor = { type: 'POS_WIDGET', id: `poster:${ctx.account}:${ctx.spotId ?? '-'}:${ctx.tabletId ?? '-'}` };
    const customer = await this.resolveCustomer(req.customer);
    if (!customer) throw new RedeemSubscriptionInputError('CUSTOMER_NOT_FOUND');
    const product = await this.catalog.findProductByPosterProductId(req.posterProductId);
    if (!product) throw new RedeemSubscriptionInputError('PRODUCT_NOT_FOUND');

    // Idempotent replay: the SAME attemptId returns its already-decided state, untouched.
    const replay = await this.prisma.subscriptionRedemption.findUnique({ where: { attemptId: req.attemptId } });
    if (replay) {
      if (replay.customerId !== customer.id) throw new RedeemSubscriptionInputError('REDEMPTION_CONFLICT');
      return this.response(replay);
    }

    const now = new Date();
    const { current } = await this.subscriptions.currentAndUpcoming(customer.id, now);
    if (!current) {
      // Nothing to attribute a row to — report the precise reason, write only the audit line.
      const { upcoming } = await this.subscriptions.currentAndUpcoming(customer.id, now);
      const reason: SubscriptionRedemptionFailureReason = upcoming.length > 0 ? 'SUBSCRIPTION_NOT_STARTED' : 'NO_ACTIVE_SUBSCRIPTION';
      await this.audit.record(actor, SUBSCRIPTION_AUDIT.REDEMPTION_FAILED, reason, customer.id);
      return { attemptId: req.attemptId, status: 'FAILED', failureReason: reason, productName: product.name, portionCost: null, after: null };
    }
    const branch = ctx.spotId ? await this.branches.findByPosterSpotId(Number(ctx.spotId)) : null;
    const mapping = await this.repository.findMappingByProductId(product.id);
    const portionCost = mapping?.portionCost ?? 1;

    // ---- A. lock, re-validate on fresh state, claim.
    type Claim = { row: Awaited<ReturnType<PosWidgetSubscriptionService['createRow']>>; claimed: boolean };
    let claim: Claim;
    try {
      claim = await this.prisma.runTransaction(async (tx) => {
        const seq = await this.repository.lockSubscriptionTx(tx, current.id);
        const sub = await this.repository.findSubscription(tx, current.id);
        const reds = await this.repository.countedRedemptions(tx, [current.id]);
        const fail = (reason: SubscriptionRedemptionFailureReason) => this.createRow(tx, { req, ctx, customerId: customer.id, subscriptionId: current.id, product, portionCost, branchId: branch?.id ?? null, now, status: 'FAILED', failureReason: reason, claimSequence: null }).then((row) => ({ row, claimed: false }));

        // (an inactive customer never resolves: findByPosterClientId / findByLoyaltyCode only return active customers)
        if (!mapping || !mapping.isActive) return fail('PRODUCT_NOT_ALLOWED');
        if (!product.isActive) return fail('PRODUCT_INACTIVE');
        if (reds.some((r) => UNRESOLVED.includes(r.status as RedemptionStatus))) return fail('REDEMPTION_CONFLICT');
        const orderRows = await tx.subscriptionRedemption.findMany({ where: { posterOrderId: req.posterOrderId, status: { in: ['CONFIRMED', 'REQUESTED', 'POSTER_MUTATING', 'UNKNOWN'] } }, select: { status: true } });
        if (orderRows.some((r) => r.status === 'CONFIRMED')) return fail('ALREADY_REDEEMED_FOR_ORDER');
        if (orderRows.length > 0) return fail('REDEMPTION_CONFLICT');
        const reason = subscriptionIneligibility(sub, reds, portionCost, now, this.offset);
        if (reason) return fail(reason);

        const row = await this.createRow(tx, { req, ctx, customerId: customer.id, subscriptionId: current.id, product, portionCost, branchId: branch?.id ?? null, now, status: 'POSTER_MUTATING', failureReason: null, claimSequence: seq });
        return { row, claimed: true };
      });
    } catch (err) {
      if (isUniqueConstraintViolation(err)) {
        const again = await this.prisma.subscriptionRedemption.findUnique({ where: { attemptId: req.attemptId } });
        if (again) return this.response(again);
      }
      throw err;
    }

    await this.audit.record(actor, SUBSCRIPTION_AUDIT.REDEMPTION_REQUESTED, `${product.posterProductId}x${portionCost}`, customer.id, branch?.id ?? null);
    if (!claim.claimed) {
      await this.audit.record(actor, SUBSCRIPTION_AUDIT.REDEMPTION_FAILED, claim.row.failureReason ?? 'FAILED', customer.id, branch?.id ?? null);
      return this.response(claim.row);
    }

    // ---- B. the real Poster mutation, outside any transaction. A QR-identified customer may redeem on an order with no Poster client;
    // an order that HAS a client must be this customer's.
    const result = await this.mutation.applyToOrder({
      posterAccount: ctx.account,
      posterSpotId: ctx.spotId,
      posterTabletId: ctx.tabletId,
      posterOrderId: req.posterOrderId,
      posterProductId: product.posterProductId,
      expectedClient: { posterClientId: customer.posterClientId ?? null, allowNoClient: true },
    });

    // ---- C. commit the outcome.
    const rowId = claim.row.id;
    const outcome = await this.prisma.runTransaction(async (tx) => {
      const base = { posterTransactionId: result.transactionId ?? null, posterTransactionProductId: result.transactionProductId ?? null };
      if (result.kind === 'confirmed') {
        try {
          return await tx.subscriptionRedemption.update({ where: { id: rowId }, data: { ...base, status: 'CONFIRMED', redeemedAt: new Date(), redeemedForPosterOrderId: req.posterOrderId } });
        } catch (err) {
          if (!isUniqueConstraintViolation(err)) throw err;
          // Unreachable while the claim's one-per-order check holds; if it ever is reached, never double-consume silently.
          return tx.subscriptionRedemption.update({ where: { id: rowId }, data: { ...base, status: 'UNKNOWN', failureReason: 'ALREADY_REDEEMED_FOR_ORDER' } });
        }
      }
      if (result.kind === 'rejected') {
        const failureReason: SubscriptionRedemptionFailureReason = result.code === 'CLIENT_MISMATCH' ? 'CUSTOMER_MISMATCH' : 'POSTER_MUTATION_FAILED';
        return tx.subscriptionRedemption.update({ where: { id: rowId }, data: { ...base, status: 'FAILED', failureReason } });
      }
      if (result.mutationAttempted === false) {
        return tx.subscriptionRedemption.update({ where: { id: rowId }, data: { ...base, status: 'FAILED', failureReason: 'POSTER_TRANSACTION_UNAVAILABLE' } });
      }
      return tx.subscriptionRedemption.update({ where: { id: rowId }, data: { ...base, status: 'UNKNOWN' } });
    });
    if (outcome.status !== 'CONFIRMED') this.logger.warn(`Subscription redemption ${rowId} ended ${outcome.status}: ${result.reason}`);

    const action = outcome.status === 'CONFIRMED' ? SUBSCRIPTION_AUDIT.REDEMPTION_CONFIRMED : outcome.status === 'UNKNOWN' ? SUBSCRIPTION_AUDIT.REDEMPTION_UNKNOWN : SUBSCRIPTION_AUDIT.REDEMPTION_FAILED;
    await this.audit.record(actor, action, outcome.failureReason ?? outcome.status, customer.id, branch?.id ?? null);
    return this.response(outcome);
  }

  private createRow(
    tx: Parameters<Parameters<PrismaService['runTransaction']>[0]>[0],
    a: {
      req: RedeemSubscriptionRequest;
      ctx: PosContext;
      customerId: string;
      subscriptionId: string;
      product: { id: string; name: string; posterProductId: string };
      portionCost: number;
      branchId: string | null;
      now: Date;
      status: RedemptionStatus;
      failureReason: SubscriptionRedemptionFailureReason | null;
      claimSequence: number | null;
    },
  ) {
    return tx.subscriptionRedemption.create({
      data: {
        attemptId: a.req.attemptId,
        subscriptionId: a.subscriptionId,
        customerId: a.customerId,
        productId: a.product.id,
        posterProductId: a.product.posterProductId,
        productName: a.product.name,
        portionCost: a.portionCost,
        branchId: a.branchId,
        posterAccount: a.ctx.account,
        posterSpotId: a.ctx.spotId,
        posterTabletId: a.ctx.tabletId,
        posterOrderId: a.req.posterOrderId,
        employeeIdentifier: a.req.employeeIdentifier,
        status: a.status,
        failureReason: a.failureReason,
        claimSequence: a.claimSequence,
        businessDate: businessDateOf(a.now, this.offset),
        requestedAt: a.now,
      },
    });
  }

  private async response(row: { attemptId: string; status: string; failureReason: string | null; productName: string; portionCost: number; subscriptionId: string }): Promise<RedeemSubscriptionResponse> {
    const sub = await this.repository.findSubscription(this.prisma, row.subscriptionId);
    const reds = await this.repository.countedRedemptions(this.prisma, [row.subscriptionId]);
    const usage = sub ? computeUsage(sub, reds, new Date(), this.offset) : null;
    return {
      attemptId: row.attemptId,
      status: row.status as RedemptionStatus,
      failureReason: (row.failureReason as SubscriptionRedemptionFailureReason | null) ?? null,
      productName: row.productName,
      portionCost: row.portionCost,
      after: usage ? { remainingPortions: usage.remainingPortions, totalPortions: usage.totalPortions, todayRemainingPortions: usage.todayRemainingPortions, nextAvailableAt: usage.nextAvailableAt } : null,
    };
  }
}
