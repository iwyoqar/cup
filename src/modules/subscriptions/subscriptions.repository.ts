import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Db, PrismaService } from '../../common/prisma/prisma.service';
import { COUNTED_REDEMPTION_STATUSES } from './subscription.types';

// Coffee Subscription — every database read/write of the domain. Services never touch Prisma directly (Phase 0 repository boundary).
// Methods taking `tx` are meant to run inside PrismaService.runTransaction (the lock-then-validate-then-write claims).

export const REDEMPTION_USAGE_SELECT = { status: true, portionCost: true, businessDate: true, requestedAt: true, redeemedAt: true } satisfies Prisma.SubscriptionRedemptionSelect;

export interface PlanInput {
  name: string;
  description: string | null;
  priceMinor: number;
  durationDays: number;
  totalPortions: number;
  dailyPortionLimit: number;
  cooldownMinutes: number;
  isActive: boolean;
  sortOrder: number;
}

@Injectable()
export class SubscriptionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ---- plans ------------------------------------------------------------------------------------------------------------------------
  listPlans(onlyActive: boolean) {
    return this.prisma.subscriptionPlan.findMany({ where: onlyActive ? { isActive: true } : {}, orderBy: [{ sortOrder: 'asc' }, { priceMinor: 'asc' }] });
  }
  findPlan(id: string) {
    return this.prisma.subscriptionPlan.findUnique({ where: { id } });
  }
  countPlans() {
    return this.prisma.subscriptionPlan.count();
  }
  createPlan(data: PlanInput, actor: string | null) {
    return this.prisma.subscriptionPlan.create({ data: { ...data, createdBy: actor, updatedBy: actor } });
  }
  updatePlan(id: string, data: Partial<PlanInput>, actor: string | null) {
    return this.prisma.subscriptionPlan.update({ where: { id }, data: { ...data, updatedBy: actor } });
  }

  // ---- product mappings -------------------------------------------------------------------------------------------------------------
  listProductMappings(onlyUsable: boolean) {
    return this.prisma.subscriptionProduct.findMany({
      where: onlyUsable ? { isActive: true, product: { isActive: true } } : {},
      include: { product: { select: { id: true, name: true, posterProductId: true, isActive: true, priceMinor: true, hasRecipe: true, theoreticalCostMinor: true, category: { select: { name: true } } } } },
      orderBy: [{ portionCost: 'asc' }, { sortOrder: 'asc' }, { product: { name: 'asc' } }],
    });
  }
  findMappingByProductId(productId: string) {
    return this.prisma.subscriptionProduct.findUnique({ where: { productId }, include: { product: true } });
  }
  findMapping(id: string) {
    return this.prisma.subscriptionProduct.findUnique({ where: { id } });
  }
  createMapping(data: { productId: string; portionCost: number; isActive: boolean; sortOrder: number }, actor: string | null) {
    return this.prisma.subscriptionProduct.create({ data: { ...data, createdBy: actor, updatedBy: actor } });
  }
  updateMapping(id: string, data: { portionCost?: number; isActive?: boolean; sortOrder?: number }, actor: string | null) {
    return this.prisma.subscriptionProduct.update({ where: { id }, data: { ...data, updatedBy: actor } });
  }
  findProduct(productId: string) {
    return this.prisma.product.findUnique({ where: { id: productId }, select: { id: true, name: true, isActive: true, posterProductId: true } });
  }

  // ---- subscriptions ----------------------------------------------------------------------------------------------------------------
  // The customer's paid subscriptions that are not over: the running one and any queued renewal. Ordered by start.
  findLiveForCustomer(db: Db, customerId: string, now: Date) {
    return db.subscription.findMany({ where: { customerId, status: { in: ['ACTIVE', 'PAUSED'] }, endsAt: { gt: now } }, orderBy: { startsAt: 'asc' } });
  }
  // The latest end of any paid subscription (running or queued) — where the next one must start.
  async latestPaidEnd(tx: Db, customerId: string): Promise<Date | null> {
    const r = await tx.subscription.aggregate({ where: { customerId, status: { in: ['ACTIVE', 'PAUSED'] } }, _max: { endsAt: true } });
    return r._max.endsAt;
  }
  findSubscription(db: Db, id: string) {
    return db.subscription.findUnique({ where: { id } });
  }
  listForCustomer(customerId: string) {
    return this.prisma.subscription.findMany({ where: { customerId }, orderBy: { createdAt: 'desc' }, include: { purchase: true }, take: 100 });
  }
  countedRedemptions(db: Db, subscriptionIds: string[]) {
    if (subscriptionIds.length === 0) return Promise.resolve([]);
    return db.subscriptionRedemption.findMany({ where: { subscriptionId: { in: subscriptionIds }, status: { in: COUNTED_REDEMPTION_STATUSES } }, select: { ...REDEMPTION_USAGE_SELECT, subscriptionId: true } });
  }

  // The row lock for redemption claims: an atomic UPDATE on the subscription row. On PostgreSQL this holds a row lock until the
  // transaction commits, so a second concurrent claim WAITS here and then reads the first one's committed redemption; SQLite serializes
  // writers globally. Returns the new usageVersion, used as the claim's unique claimSequence.
  async lockSubscriptionTx(tx: Db, subscriptionId: string): Promise<number> {
    const row = await tx.subscription.update({ where: { id: subscriptionId }, data: { usageVersion: { increment: 1 } }, select: { usageVersion: true } });
    return row.usageVersion;
  }
  // Same idea for activation: serializes everything that decides a customer's subscription periods.
  async lockCustomerTx(tx: Db, customerId: string): Promise<void> {
    await tx.customer.update({ where: { id: customerId }, data: { subscriptionLockVersion: { increment: 1 } }, select: { id: true } });
  }

  expireDue(now: Date) {
    return this.prisma.$transaction(async (tx) => {
      const due = await tx.subscription.findMany({ where: { status: 'ACTIVE', endsAt: { lte: now } }, select: { id: true, customerId: true } });
      if (due.length === 0) return [];
      await tx.subscription.updateMany({ where: { id: { in: due.map((d) => d.id) }, status: 'ACTIVE' }, data: { status: 'EXPIRED', expiredAt: now } });
      return due;
    });
  }

  // ---- purchases --------------------------------------------------------------------------------------------------------------------
  findPurchaseByIdempotencyKey(key: string) {
    return this.prisma.subscriptionPurchase.findUnique({ where: { idempotencyKey: key }, include: { subscription: true, plan: true } });
  }
  findPurchase(db: Db, id: string) {
    return db.subscriptionPurchase.findUnique({ where: { id }, include: { subscription: true, plan: true } });
  }
  findOpenPurchaseForCustomer(customerId: string) {
    return this.prisma.subscriptionPurchase.findFirst({ where: { customerId, status: { in: ['CREATED', 'PAYMENT_PENDING'] } }, include: { subscription: true, plan: true }, orderBy: { createdAt: 'desc' } });
  }
  listPurchasesForCustomer(customerId: string) {
    return this.prisma.subscriptionPurchase.findMany({ where: { customerId }, include: { plan: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 50 });
  }

  // ---- redemptions (customer history) -----------------------------------------------------------------------------------------------
  // Newest first, keyset cursor on (requestedAt, id). Only what a customer should see as history: consumed or still-open attempts,
  // never FAILED noise.
  customerRedemptionPage(customerId: string, cursor: { at: Date; id: string } | null, take: number) {
    return this.prisma.subscriptionRedemption.findMany({
      where: {
        customerId,
        status: { in: ['CONFIRMED', 'UNKNOWN', 'POSTER_MUTATING', 'REQUESTED'] },
        ...(cursor ? { OR: [{ requestedAt: { lt: cursor.at } }, { requestedAt: cursor.at, id: { lt: cursor.id } }] } : {}),
      },
      orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      select: { id: true, status: true, productName: true, portionCost: true, requestedAt: true, redeemedAt: true, subscription: { select: { planName: true } }, branch: { select: { name: true } } },
    });
  }
}
