import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '../../common/config/config.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { isUniqueConstraintViolation } from '../../common/util/prisma-errors';
import { SubscriptionActor, SubscriptionAuditService, SUBSCRIPTION_AUDIT } from './subscription-audit.service';
import { SubscriptionPaymentRegistry } from './subscription-payments';
import { computeUsage, effectiveStatus, nextStartBusinessDate, periodFor, RedemptionLike, termsOf } from './subscription-rules';
import { ActivationSource, PurchaseKind, PurchaseStatus, SubscriptionStatus, SubscriptionView } from './subscription.types';
import { SubscriptionsRepository } from './subscriptions.repository';

type SubscriptionRow = NonNullable<Awaited<ReturnType<SubscriptionsRepository['findSubscription']>>>;
type PurchaseRow = NonNullable<Awaited<ReturnType<SubscriptionsRepository['findPurchaseByIdempotencyKey']>>>;

export interface PlanView {
  id: string;
  name: string;
  description: string | null;
  priceMinor: number;
  durationDays: number;
  totalPortions: number;
  dailyPortionLimit: number;
  cooldownMinutes: number;
  isActive: boolean;
}

export interface PurchaseView {
  id: string;
  kind: PurchaseKind;
  status: PurchaseStatus;
  planId: string;
  planName: string;
  amountMinor: number;
  currency: string;
  createdAt: string;
  paidAt: string | null;
  subscriptionId: string;
}

// The business policy, stated once and returned to every client (Mini App shows it; Admin documents it). Not configurable by design.
export const SUBSCRIPTION_POLICY = { autoRenew: false, refunds: false, rollover: false, cashValue: false } as const;

const OPEN_PURCHASE: PurchaseStatus[] = ['CREATED', 'PAYMENT_PENDING'];

// Coffee Subscription — the lifecycle: summary, purchase (pending payment), activation (idempotent, non-overlapping), cancellation and
// expiry. Redemption (the POS path) lives in the POS widget module and reuses subscription-rules.ts + this module's repository.
@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    private readonly repository: SubscriptionsRepository,
    private readonly prisma: PrismaService,
    private readonly audit: SubscriptionAuditService,
    private readonly payments: SubscriptionPaymentRegistry,
    private readonly config: ConfigService,
  ) {}

  private get offset(): number {
    return this.config.env.BUSINESS_TIMEZONE_OFFSET_MINUTES;
  }

  toView(sub: SubscriptionRow, redemptions: RedemptionLike[], now: Date): SubscriptionView {
    return {
      id: sub.id,
      planId: sub.planId,
      planName: sub.planName,
      status: sub.status as SubscriptionStatus,
      effectiveStatus: effectiveStatus(sub, now),
      priceMinor: sub.priceMinor,
      durationDays: sub.durationDays,
      startBusinessDate: sub.startBusinessDate,
      endBusinessDate: sub.endBusinessDate,
      startsAt: sub.startsAt?.toISOString() ?? null,
      endsAt: sub.endsAt?.toISOString() ?? null,
      activatedAt: sub.activatedAt?.toISOString() ?? null,
      usage: computeUsage(sub, redemptions, now, this.offset),
    };
  }

  // Views for many subscriptions with ONE redemption query (no N+1).
  async viewsFor(subs: SubscriptionRow[], now: Date): Promise<SubscriptionView[]> {
    const reds = await this.repository.countedRedemptions(this.prisma, subs.map((s) => s.id));
    const bySub = new Map<string, RedemptionLike[]>();
    for (const r of reds) bySub.set(r.subscriptionId, [...(bySub.get(r.subscriptionId) ?? []), r]);
    return subs.map((s) => this.toView(s, bySub.get(s.id) ?? [], now));
  }

  // The customer's running subscription (if any) and any queued renewal. At most one is running at a time (periods never overlap).
  async currentAndUpcoming(customerId: string, now: Date = new Date()): Promise<{ current: SubscriptionView | null; upcoming: SubscriptionView[] }> {
    const live = await this.repository.findLiveForCustomer(this.prisma, customerId, now);
    const views = await this.viewsFor(live, now);
    const current = views.find((v) => v.effectiveStatus === 'ACTIVE' || v.effectiveStatus === 'PAUSED') ?? null;
    return { current, upcoming: views.filter((v) => v.effectiveStatus === 'SCHEDULED') };
  }

  async plans(onlyActive = true): Promise<PlanView[]> {
    return (await this.repository.listPlans(onlyActive)).map(planView);
  }

  async customerSummary(customerId: string, now: Date = new Date()) {
    const [{ current, upcoming }, open, plans] = await Promise.all([this.currentAndUpcoming(customerId, now), this.repository.findOpenPurchaseForCustomer(customerId), this.plans(true)]);
    return {
      current,
      upcoming,
      pendingPurchase: open ? purchaseView(open) : null,
      plans,
      canRenew: current !== null || upcoming.length > 0,
      payment: { providers: this.payments.available(), available: this.payments.available().length > 0 },
      policy: SUBSCRIPTION_POLICY,
    };
  }

  // ---- purchase -----------------------------------------------------------------------------------------------------------------------
  // Creates a PENDING_PAYMENT subscription + its purchase. NEVER activates anything and never charges: a payment provider (future) or the
  // flagged admin manual activation does that through confirmPaid(). Idempotent on the Idempotency-Key. `expectRenewal` is only used to
  // reject a "renew" press when there is nothing to renew.
  async createPurchase(customerId: string, planId: string, idempotencyKey: string, actor: SubscriptionActor, expectRenewal = false): Promise<PurchaseView> {
    const replay = await this.repository.findPurchaseByIdempotencyKey(idempotencyKey);
    if (replay) {
      if (replay.customerId !== customerId) throw new ConflictException('This Idempotency-Key was already used.');
      return purchaseView(replay);
    }
    const plan = await this.repository.findPlan(planId);
    if (!plan || !plan.isActive) throw new NotFoundException('Subscription plan not found or not available.');

    const now = new Date();
    const live = await this.repository.findLiveForCustomer(this.prisma, customerId, now);
    const kind: PurchaseKind = live.length > 0 ? 'RENEWAL' : 'NEW';
    if (expectRenewal && kind !== 'RENEWAL') throw new BadRequestException({ reason: 'NOTHING_TO_RENEW', message: 'There is no current subscription to renew.' });

    const open = await this.repository.findOpenPurchaseForCustomer(customerId);
    if (open) {
      if (open.planId === planId) return purchaseView(open); // pressing "buy" twice for the same plan is the same pending purchase
      throw new ConflictException({ reason: 'PENDING_PURCHASE_EXISTS', message: 'Another subscription purchase is waiting for payment. Cancel it first.', purchaseId: open.id });
    }

    let created: PurchaseRow;
    try {
      created = await this.prisma.runTransaction(async (tx) => {
        const terms = termsOf(plan);
        const sub = await tx.subscription.create({ data: { customerId, planId, status: 'PENDING_PAYMENT' satisfies SubscriptionStatus, ...terms } });
        const purchase = await tx.subscriptionPurchase.create({
          data: { customerId, planId, subscriptionId: sub.id, kind, status: 'PAYMENT_PENDING' satisfies PurchaseStatus, amountMinor: plan.priceMinor, currency: 'UZS', idempotencyKey },
          include: { subscription: true, plan: true },
        });
        return purchase;
      });
    } catch (err) {
      if (isUniqueConstraintViolation(err)) {
        const again = await this.repository.findPurchaseByIdempotencyKey(idempotencyKey);
        if (again && again.customerId === customerId) return purchaseView(again);
      }
      throw err;
    }
    await this.audit.record(actor, SUBSCRIPTION_AUDIT.CREATED, `${kind}:${plan.name}`, customerId);
    if (kind === 'RENEWAL') await this.audit.record(actor, SUBSCRIPTION_AUDIT.RENEW_REQUESTED, plan.name, customerId);
    return purchaseView(created);
  }

  async cancelPurchase(purchaseId: string, actor: SubscriptionActor, ownerCustomerId: string | null): Promise<PurchaseView> {
    const purchase = await this.repository.findPurchase(this.prisma, purchaseId);
    if (!purchase || (ownerCustomerId && purchase.customerId !== ownerCustomerId)) throw new NotFoundException('Purchase not found.');
    if (purchase.status === 'CANCELLED') return purchaseView(purchase);
    if (!OPEN_PURCHASE.includes(purchase.status as PurchaseStatus)) throw new ConflictException('Only a purchase that is still waiting for payment can be cancelled (no refunds).');
    const now = new Date();
    const updated = await this.prisma.runTransaction(async (tx) => {
      // Conditional on still being open: a payment confirmed concurrently wins and this becomes a no-op conflict.
      const r = await tx.subscriptionPurchase.updateMany({ where: { id: purchaseId, status: { in: OPEN_PURCHASE } }, data: { status: 'CANCELLED', cancelledAt: now } });
      if (r.count === 0) throw new ConflictException('The purchase changed state; reload it.');
      await tx.subscription.updateMany({ where: { id: purchase.subscriptionId, status: 'PENDING_PAYMENT' }, data: { status: 'CANCELLED', cancelledAt: now, cancelReason: 'PURCHASE_CANCELLED' } });
      return tx.subscriptionPurchase.findUniqueOrThrow({ where: { id: purchaseId }, include: { subscription: true, plan: true } });
    });
    await this.audit.record(actor, SUBSCRIPTION_AUDIT.PURCHASE_CANCELLED, purchase.plan.name, purchase.customerId);
    return purchaseView(updated);
  }

  // ---- activation ---------------------------------------------------------------------------------------------------------------------
  // The ONE way a subscription becomes ACTIVE. Idempotent (an already-PAID purchase returns as-is). Runs under the customer lock, so the
  // start date is computed against every other paid subscription of this customer: a renewal bought while one is running starts exactly
  // when the last one ends — periods never overlap.
  async confirmPaid(
    purchaseId: string,
    input: { source: ActivationSource; provider?: string | null; providerPaymentId?: string | null; amountMinor?: number; actor: SubscriptionActor; note?: string | null },
    now: Date = new Date(),
  ): Promise<{ purchase: PurchaseView; subscription: SubscriptionView }> {
    const head = await this.repository.findPurchase(this.prisma, purchaseId);
    if (!head) throw new NotFoundException('Purchase not found.');

    const result = await this.prisma.runTransaction(async (tx) => {
      await this.repository.lockCustomerTx(tx, head.customerId);
      const purchase = await this.repository.findPurchase(tx, purchaseId);
      if (!purchase) throw new NotFoundException('Purchase not found.');
      if (purchase.status === 'PAID') return { purchase, changed: false };
      if (!OPEN_PURCHASE.includes(purchase.status as PurchaseStatus)) throw new ConflictException(`A ${purchase.status} purchase cannot be activated.`);
      if (input.source === 'PAYMENT' && input.amountMinor !== purchase.amountMinor) throw new ConflictException('Paid amount does not match the purchase amount; not activated.');

      const latestEnd = await this.repository.latestPaidEnd(tx, purchase.customerId);
      const start = nextStartBusinessDate(now, latestEnd, this.offset);
      const period = periodFor(start, purchase.subscription.durationDays, this.offset);
      await tx.subscription.update({ where: { id: purchase.subscriptionId }, data: { status: 'ACTIVE', activatedAt: now, ...period } });
      await tx.subscriptionPurchase.update({
        where: { id: purchase.id },
        data: {
          status: 'PAID',
          paidAt: now,
          activationSource: input.source,
          provider: input.provider ?? null,
          providerPaymentId: input.providerPaymentId ?? null,
          activatedBy: input.actor.id,
          activationNote: input.note ?? null,
        },
      });
      const fresh = await this.repository.findPurchase(tx, purchaseId);
      return { purchase: fresh!, changed: true };
    });

    if (result.changed) {
      const s = result.purchase.subscription;
      await this.audit.record(input.actor, SUBSCRIPTION_AUDIT.ACTIVATED, `${input.source}:${s.startBusinessDate}..${s.endBusinessDate}`, result.purchase.customerId);
    }
    const [view] = await this.viewsFor([result.purchase.subscription], now);
    return { purchase: purchaseView(result.purchase), subscription: view };
  }

  // Development / manual initialization ONLY (no payment provider exists yet). Double-gated: the env interlock AND an ADMIN-role account
  // (checked by the controller). Recorded as activationSource ADMIN_MANUAL — never counted as subscription revenue.
  async manualActivate(purchaseId: string, adminId: string, note: string | null) {
    if (!this.config.env.SUBSCRIPTIONS_MANUAL_ACTIVATION_ENABLED) throw new ForbiddenException({ reason: 'MANUAL_ACTIVATION_DISABLED', message: 'Manual activation is disabled (SUBSCRIPTIONS_MANUAL_ACTIVATION_ENABLED).' });
    return this.confirmPaid(purchaseId, { source: 'ADMIN_MANUAL', actor: { type: 'ADMIN', id: adminId }, note });
  }

  // No refund is recorded or implied (no-refund policy): cancelling only stops future use; consumed portions stay consumed.
  async cancelSubscription(subscriptionId: string, actor: SubscriptionActor, reason: string) {
    const now = new Date();
    const sub = await this.repository.findSubscription(this.prisma, subscriptionId);
    if (!sub) throw new NotFoundException('Subscription not found.');
    if (sub.status === 'CANCELLED' || sub.status === 'EXPIRED') throw new ConflictException(`This subscription is already ${sub.status}.`);
    await this.prisma.runTransaction(async (tx) => {
      await this.repository.lockSubscriptionTx(tx, sub.id); // waits for any in-flight redemption claim on this subscription
      await tx.subscription.update({ where: { id: sub.id }, data: { status: 'CANCELLED', cancelledAt: now, cancelReason: reason.slice(0, 200) } });
      await tx.subscriptionPurchase.updateMany({ where: { subscriptionId: sub.id, status: { in: OPEN_PURCHASE } }, data: { status: 'CANCELLED', cancelledAt: now } });
    });
    await this.audit.record(actor, SUBSCRIPTION_AUDIT.CANCELLED, reason.slice(0, 80), sub.customerId);
    const fresh = await this.repository.findSubscription(this.prisma, sub.id);
    const [view] = await this.viewsFor([fresh!], now);
    return view;
  }

  // Housekeeping only: flips stored status ACTIVE -> EXPIRED after endsAt. Redemption never depends on this having run (it checks the
  // dates itself), so a missed tick can never let an expired subscription be used.
  async expireDue(now: Date = new Date()): Promise<number> {
    const due = await this.repository.expireDue(now);
    for (const d of due) await this.audit.record({ type: 'SYSTEM', id: 'subscription-expiry' }, SUBSCRIPTION_AUDIT.EXPIRED, 'EXPIRED', d.customerId);
    if (due.length) this.logger.log(`Expired ${due.length} subscription(s).`);
    return due.length;
  }

  // ---- customer history ---------------------------------------------------------------------------------------------------------------
  async customerRedemptions(customerId: string, rawCursor: string | undefined, limit: number) {
    const cursor = decodeCursor(rawCursor);
    const rows = await this.repository.customerRedemptionPage(customerId, cursor, limit);
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map((r) => ({
        id: r.id,
        kind: 'SUBSCRIPTION_REDEMPTION' as const,
        status: r.status,
        at: (r.redeemedAt ?? r.requestedAt).toISOString(),
        productName: r.productName,
        portionCost: r.portionCost,
        planName: r.subscription.planName,
        branchName: r.branch?.name ?? null,
      })),
      nextCursor: rows.length > limit && last ? encodeCursor(last.requestedAt, last.id) : null,
    };
  }

  async customerHistory(customerId: string, now: Date = new Date()) {
    const subs = await this.repository.listForCustomer(customerId);
    const views = await this.viewsFor(subs.filter((s) => s.status !== 'PENDING_PAYMENT'), now);
    return { subscriptions: views };
  }
}

export function planView(p: { id: string; name: string; description: string | null; priceMinor: number; durationDays: number; totalPortions: number; dailyPortionLimit: number; cooldownMinutes: number; isActive: boolean }): PlanView {
  return { id: p.id, name: p.name, description: p.description, priceMinor: p.priceMinor, durationDays: p.durationDays, totalPortions: p.totalPortions, dailyPortionLimit: p.dailyPortionLimit, cooldownMinutes: p.cooldownMinutes, isActive: p.isActive };
}

export function purchaseView(p: PurchaseRow): PurchaseView {
  return {
    id: p.id,
    kind: p.kind as PurchaseKind,
    status: p.status as PurchaseStatus,
    planId: p.planId,
    planName: p.plan.name,
    amountMinor: p.amountMinor,
    currency: p.currency,
    createdAt: p.createdAt.toISOString(),
    paidAt: p.paidAt?.toISOString() ?? null,
    subscriptionId: p.subscriptionId,
  };
}

function encodeCursor(at: Date, id: string): string {
  return Buffer.from(`${at.getTime()}:${id}`).toString('base64url');
}

function decodeCursor(raw: string | undefined): { at: Date; id: string } | null {
  if (!raw) return null;
  try {
    const [ms, id] = Buffer.from(raw, 'base64url').toString('utf8').split(':');
    const at = new Date(Number(ms));
    if (!id || Number.isNaN(at.getTime())) throw new Error('bad');
    return { at, id };
  } catch {
    throw new BadRequestException('Invalid cursor.');
  }
}
