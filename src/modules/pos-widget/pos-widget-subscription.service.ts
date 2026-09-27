import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '../../common/config/config.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { isUniqueConstraintViolation } from '../../common/util/prisma-errors';
import { BranchRepository } from '../branches/branch.repository';
import { CatalogRepository } from '../catalog/catalog.repository';
import { CustomersRepository } from '../customers/customers.repository';
import { normalizeLoyaltyCode } from '../customers/loyalty-code';
import { SubscriptionActor, SubscriptionAuditService, SUBSCRIPTION_AUDIT } from '../subscriptions/subscription-audit.service';
import { CASH_PROVIDER, POSTER_ORDER_PROVIDER } from '../subscriptions/subscription-payments';
import { computeUsage, subscriptionIneligibility } from '../subscriptions/subscription-rules';
import { RedemptionStatus, SubscriptionRedemptionFailureReason, SubscriptionView } from '../subscriptions/subscription.types';
import { SubscriptionsRepository } from '../subscriptions/subscriptions.repository';
import { purchaseView, PurchaseView, SubscriptionsService } from '../subscriptions/subscriptions.service';
import { businessDateOf } from '../analytics/analytics-period';
import { PosterService } from '../poster/poster.service';
import { PosContext } from './pos-widget-signature';
import { PosterOrderMutationService } from './poster-order-mutation.service';
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

// A cash-sale request that cannot even be attributed to a customer — mirrors RedeemSubscriptionInputError above, its own (much smaller) reason set.
export class PurchaseSubscriptionInputError extends Error {
  constructor(readonly reason: 'CUSTOMER_NOT_FOUND') {
    super(reason);
  }
}

export interface PurchaseSubscriptionCashRequest {
  planId: string;
  customer: SubscriptionCustomerRef;
  employeeIdentifier: string | null;
}

// A business-level rejection (plan turned off since the widget last loaded it, a pending purchase already exists, ...) is a normal 200 result, exactly
// like RedeemSubscriptionResponse's FAILED/UNKNOWN — never an HTTP error. This is deliberate: Poster's makeRequest proxy (pos-widget/src/poster.ts)
// only distinguishes a handful of transport-level HTTP codes, so a 404/409 would reach the widget as an uninformative generic 'CUP vaqtincha mavjud
// emas' instead of a reason the cashier can act on. Only a request that cannot even be attributed to a customer (PurchaseSubscriptionInputError) or a
// truly unexpected error is allowed to throw.
export type PurchaseSubscriptionCashResult = { status: 'ACTIVATED'; purchase: PurchaseView; subscription: SubscriptionView } | { status: 'REJECTED'; reason: string };

export interface PurchaseSubscriptionPosterOrderRequest {
  planId: string;
  customer: SubscriptionCustomerRef;
  posterOrderId: string; // the widget's claim: orders.getActive().order.id — never trusted directly, resolved server-side like redemption
  employeeIdentifier: string | null;
}

// ADDED_TO_ORDER means the line was added and the purchase is still PENDING_PAYMENT — NOT activated yet (see docs/SUBSCRIPTIONS.md's real
// Poster order purchase section: there is no synchronous "is this paid" check, so activation happens later via checkPosterOrderPayment or
// the importer's reconciliation safety net). Same REJECTED-is-a-normal-200 convention as the cash-sale result above.
export type PurchaseSubscriptionPosterOrderResult = { status: 'ADDED_TO_ORDER'; purchase: PurchaseView; subscription: SubscriptionView } | { status: 'REJECTED'; reason: string };

export type CheckPosterOrderPaymentResult = { status: 'ACTIVATED'; purchase: PurchaseView; subscription: SubscriptionView } | { status: 'PENDING_PAYMENT' } | { status: 'REJECTED'; reason: string };

// NotFoundException / ConflictException from SubscriptionsService.createPurchase / confirmPaid are the only ones ever foreseeable here (plan
// deactivated concurrently, a pending purchase already open, a race on the same idempotency key) — everything else still throws, and becomes a real
// 500, never silently absorbed into a generic rejection.
function knownRejectionReason(err: unknown): string | null {
  if (err instanceof NotFoundException) return 'PLAN_NOT_FOUND';
  if (err instanceof ConflictException) {
    const body = err.getResponse();
    return body && typeof body === 'object' && 'reason' in body ? String((body as { reason: unknown }).reason) : 'CONFLICT';
  }
  return null;
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
    private readonly orderMutation: PosterOrderMutationService,
    private readonly poster: PosterService,
    private readonly audit: SubscriptionAuditService,
    private readonly config: ConfigService,
  ) {}

  private get offset() {
    return this.config.env.BUSINESS_TIMEZONE_OFFSET_MINUTES;
  }

  // ---- summary (read-only) ------------------------------------------------------------------------------------------------------------
  async summaryFor(customerId: string, now: Date = new Date()) {
    const [{ current, upcoming }, mappings, recent, plans] = await Promise.all([
      this.subscriptions.currentAndUpcoming(customerId, now),
      this.repository.listProductMappings(true),
      this.prisma.subscriptionRedemption.findMany({ where: { customerId, status: 'CONFIRMED' }, orderBy: { redeemedAt: 'desc' }, take: 5, select: { productName: true, portionCost: true, redeemedAt: true, branch: { select: { name: true } } } }),
      this.subscriptions.plans(true), // for the cash-sale panel (see purchaseCash): what a cashier can sell, always plan terms from the DB
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
      cashSale: { enabled: this.config.env.POS_SUBSCRIPTION_CASH_SALE_ENABLED },
      posterPurchase: { enabled: this.config.env.POS_SUBSCRIPTION_POSTER_PURCHASE_ENABLED },
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
      // Coffee Subscription cash sale — plan terms straight from the DB (never trusted from the widget), shown when the customer has nothing
      // usable to redeem (see App.tsx's SubscriptionCard: current === null renders the cash-sale panel instead).
      plans,
    };
  }

  async resolveCustomer(ref: SubscriptionCustomerRef) {
    if ('posterClientId' in ref) return this.customers.findByPosterClientId(ref.posterClientId);
    const code = normalizeLoyaltyCode(ref.code);
    return code ? this.customers.findByLoyaltyCode(code) : null;
  }

  // ---- cash sale ------------------------------------------------------------------------------------------------------------------------
  // A cashier sells a plan for cash, directly inside the POS widget (no online payment provider exists yet — see subscription-payments.ts). This is
  // NOT a Poster mutation of any kind (see docs/SUBSCRIPTIONS.md: a subscription purchase is a CUP financial event, the later coffee redemption is
  // the Poster operational event — the two never mix): it only creates a purchase and activates it, reusing the exact same domain path a future real
  // payment provider's webhook would call. Nothing here decides price, duration, portions or the customer: the plan is read from the DB
  // (SubscriptionsService.createPurchase) and the customer comes from the verified POS context, never from the request body.
  //   1. createPurchase (idempotent on idempotencyKey) — PENDING_PAYMENT, or replays an already-created one.
  //   2. confirmPaid with source: 'PAYMENT', provider: CASH — idempotent (a PAID purchase is returned as-is); runs under the customer lock, so a
  //      renewal bought while one subscription is already running is scheduled to start exactly when it ends (never overlapping), and two cashiers
  //      racing the same customer can never both win.
  // The "cashier" is whatever Poster's own users.getActiveUser() gave the widget (state.employee in pos-widget/src/store.ts) — a free identifier, not
  // a CUP Staff Panel account (this POS widget has never resolved one) — recorded as the actor for BOTH the audit trail and SubscriptionPurchase.activatedBy.
  async purchaseCash(ctx: PosContext, req: PurchaseSubscriptionCashRequest, idempotencyKey: string): Promise<PurchaseSubscriptionCashResult> {
    const customer = await this.resolveCustomer(req.customer);
    if (!customer) throw new PurchaseSubscriptionInputError('CUSTOMER_NOT_FOUND');
    const actor: SubscriptionActor = { type: 'POS_WIDGET', id: req.employeeIdentifier?.trim() || `poster:${ctx.account}:${ctx.spotId ?? '-'}:${ctx.tabletId ?? '-'}` };

    let created;
    try {
      created = await this.subscriptions.createPurchase(customer.id, req.planId, idempotencyKey, actor);
    } catch (err) {
      const reason = knownRejectionReason(err);
      if (reason === null) throw err;
      return { status: 'REJECTED', reason };
    }

    let confirmed;
    try {
      confirmed = await this.subscriptions.confirmPaid(created.id, { source: 'PAYMENT', provider: CASH_PROVIDER, providerPaymentId: null, amountMinor: created.amountMinor, actor, note: null });
    } catch (err) {
      const reason = knownRejectionReason(err);
      if (reason === null) throw err;
      return { status: 'REJECTED', reason };
    }

    const branch = ctx.spotId ? await this.branches.findByPosterSpotId(Number(ctx.spotId)) : null;
    await this.audit.record(actor, SUBSCRIPTION_AUDIT.CASH_PAYMENT_CONFIRMED, `${confirmed.purchase.planName}:${confirmed.purchase.amountMinor}`, customer.id, branch?.id ?? null);
    return { status: 'ACTIVATED', purchase: confirmed.purchase, subscription: confirmed.subscription };
  }

  // ---- real Poster order purchase ------------------------------------------------------------------------------------------------------
  // A cashier sells a plan as a real line item on the customer's actual Poster order — the customer pays through Poster itself (cash, card,
  // whatever the register already supports), CUP never implements a payment provider for this path. Two steps, deliberately never combined
  // into one: (1) add the mapped product to the order at its real price (this method) — the purchase stays PENDING_PAYMENT; Poster is
  // responsible for payment, not CUP; (2) confirm the order actually closed paid, separately, in checkPosterOrderPayment below (there is no
  // synchronous "is this paid" check — see docs/SUBSCRIPTIONS.md).
  //   1. Validate the plan is active AND mapped to an active product (never trusted from the widget — the widget only shows what
  //      summaryFor already filtered, but this re-validates server-side regardless, same discipline as redemption's product checks).
  //   2. createPurchase (idempotent on idempotencyKey) — PENDING_PAYMENT, exactly like the cash path; reuses the same non-overlapping-
  //      renewal scheduling once eventually confirmed.
  //   3. If this purchase already recorded a posterTransactionId (a retried/duplicate click), return its current state WITHOUT mutating
  //      Poster again — the line is never added twice.
  //   4. Otherwise resolve the order and add the line via PosterOrderMutationService, persisting the Poster linkage immediately regardless
  //      of outcome (a resolved transactionId matters even on an ambiguous result, so a retry or the importer can still find it).
  async purchasePosterOrder(ctx: PosContext, req: PurchaseSubscriptionPosterOrderRequest, idempotencyKey: string): Promise<PurchaseSubscriptionPosterOrderResult> {
    const customer = await this.resolveCustomer(req.customer);
    if (!customer) throw new PurchaseSubscriptionInputError('CUSTOMER_NOT_FOUND');

    const plan = await this.repository.findPlan(req.planId);
    if (!plan || !plan.isActive) return { status: 'REJECTED', reason: 'PLAN_NOT_FOUND' };
    if (!plan.product || !plan.product.isActive) return { status: 'REJECTED', reason: 'PLAN_NOT_MAPPED' };

    const actor: SubscriptionActor = { type: 'POS_WIDGET', id: req.employeeIdentifier?.trim() || `poster:${ctx.account}:${ctx.spotId ?? '-'}:${ctx.tabletId ?? '-'}` };
    let createdId: string;
    try {
      createdId = (await this.subscriptions.createPurchase(customer.id, req.planId, idempotencyKey, actor)).id;
    } catch (err) {
      const reason = knownRejectionReason(err);
      if (reason === null) throw err;
      return { status: 'REJECTED', reason };
    }

    const row = await this.repository.findPurchase(this.prisma, createdId);
    if (!row) throw new NotFoundException('Purchase not found.'); // unreachable: we just created it

    if (row.status === 'PAID' || row.posterTransactionId) {
      // Already added (or already paid) on a prior attempt that used this same idempotency key — never mutate Poster twice.
      const [subView] = await this.subscriptions.viewsFor([row.subscription], new Date());
      return { status: 'ADDED_TO_ORDER', purchase: purchaseView(row), subscription: subView };
    }

    const branch = ctx.spotId ? await this.branches.findByPosterSpotId(Number(ctx.spotId)) : null;
    const result = await this.orderMutation.applyToOrder({
      posterAccount: ctx.account,
      posterSpotId: ctx.spotId,
      posterTabletId: ctx.tabletId,
      posterOrderId: req.posterOrderId,
      posterProductId: plan.product.posterProductId,
      priceMinor: plan.priceMinor,
      expectedClient: { posterClientId: customer.posterClientId ?? null, allowNoClient: true },
    });

    // Persist the Poster linkage regardless of outcome — even 'ambiguous' resolves a real transactionId that a retry or the importer's
    // reconciliation safety net (poster-transaction-import.service.ts) must still be able to find.
    if (result.transactionId) {
      await this.prisma.subscriptionPurchase.update({
        where: { id: createdId },
        data: { posterAccount: ctx.account, posterSpotId: ctx.spotId, posterTabletId: ctx.tabletId, posterOrderId: req.posterOrderId, posterTransactionId: result.transactionId, posterTransactionProductId: result.transactionProductId ?? null },
      });
    }

    if (result.kind !== 'confirmed') {
      const reason = result.code ?? (result.kind === 'rejected' ? 'POSTER_MUTATION_FAILED' : 'POSTER_TRANSACTION_UNAVAILABLE');
      this.logger.warn(`Subscription order-purchase ${createdId} could not add the line: ${result.reason}`);
      await this.audit.record(actor, SUBSCRIPTION_AUDIT.POSTER_PURCHASE_REJECTED, reason, customer.id, branch?.id ?? null);
      return { status: 'REJECTED', reason };
    }

    await this.audit.record(actor, SUBSCRIPTION_AUDIT.POSTER_PURCHASE_ADDED, `${plan.name}:${plan.priceMinor}`, customer.id, branch?.id ?? null);
    const fresh = await this.repository.findPurchase(this.prisma, createdId);
    const [subView] = await this.subscriptions.viewsFor([fresh!.subscription], new Date());
    return { status: 'ADDED_TO_ORDER', purchase: purchaseView(fresh!), subscription: subView };
  }

  // The on-demand fast path: the widget calls this right after the customer pays, instead of waiting for the periodic importer. Light
  // authorization: a purchase's stored posterAccount (set the moment the line was added) must match the signed request's account, since
  // this endpoint carries no other per-purchase credential.
  async checkPosterOrderPayment(ctx: PosContext, purchaseId: string): Promise<CheckPosterOrderPaymentResult> {
    const row = await this.repository.findPurchase(this.prisma, purchaseId);
    if (!row) return { status: 'REJECTED', reason: 'PURCHASE_NOT_FOUND' };
    if (row.posterAccount && row.posterAccount !== ctx.account) return { status: 'REJECTED', reason: 'WRONG_ACCOUNT' };
    if (row.status === 'PAID') {
      const [subView] = await this.subscriptions.viewsFor([row.subscription], new Date());
      return { status: 'ACTIVATED', purchase: purchaseView(row), subscription: subView };
    }
    if (row.status !== 'PAYMENT_PENDING' || !row.posterTransactionId) return { status: 'PENDING_PAYMENT' };

    let tx;
    try {
      tx = await this.poster.getTransactionById(row.posterTransactionId);
    } catch {
      return { status: 'PENDING_PAYMENT' }; // a transient read failure is never a rejection — just "not confirmed yet", try again
    }
    // Documented meaning only (poster-transaction-import.service.ts uses the same interpretation): status 2 = closed; pay_type 0 = closed
    // without payment.
    if (!tx || tx.status !== '2' || tx.pay_type === '0') return { status: 'PENDING_PAYMENT' };

    const systemActor: SubscriptionActor = { type: 'SYSTEM', id: 'pos-widget-check-payment' };
    const { purchase, subscription } = await this.subscriptions.confirmPaid(purchaseId, { source: 'PAYMENT', provider: POSTER_ORDER_PROVIDER, providerPaymentId: row.posterTransactionId, amountMinor: row.amountMinor, actor: systemActor, note: null });
    const branch = row.posterSpotId ? await this.branches.findByPosterSpotId(Number(row.posterSpotId)) : null;
    await this.audit.record(systemActor, SUBSCRIPTION_AUDIT.POSTER_PAYMENT_CONFIRMED, `${purchase.planName}:${purchase.amountMinor}`, row.customerId, branch?.id ?? null);
    return { status: 'ACTIVATED', purchase, subscription };
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
