import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

const CART_RELATIONS = {
  branch: true,
  items: { include: { product: true } },
} as const;

@Injectable()
export class CartRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByCustomerId(customerId: string) {
    return this.prisma.cart.findUnique({ where: { customerId }, include: CART_RELATIONS });
  }

  createEmptyForCustomer(customerId: string) {
    return this.prisma.cart.create({ data: { customerId }, include: CART_RELATIONS });
  }

  setBranch(cartId: string, branchId: string) {
    return this.prisma.cart.update({ where: { id: cartId }, data: { branchId }, include: CART_RELATIONS });
  }

  // Phase 8: the customer's current reward selection — a UX convenience only (see
  // schema.prisma's comment on Cart.rewardProgramId), never trusted as-is at checkout.
  setReward(cartId: string, rewardProgramId: string, productId: string) {
    return this.prisma.cart.update({
      where: { id: cartId },
      data: { rewardProgramId, rewardProductId: productId },
      include: CART_RELATIONS,
    });
  }

  clearReward(cartId: string) {
    return this.prisma.cart.update({
      where: { id: cartId },
      data: { rewardProgramId: null, rewardProductId: null },
      include: CART_RELATIONS,
    });
  }

  // Atomic add-or-increment: Prisma compiles this to a native upsert (SQLite supports
  // INSERT ... ON CONFLICT), so two concurrent "add this product" requests for the same cart
  // can't both pass a create-then-check and end up as two CartItem rows for the same product —
  // the same reasoning CatalogRepository/BranchRepository already rely on for their upserts.
  upsertItem(cartId: string, productId: string, quantity: number) {
    return this.prisma.cartItem.upsert({
      where: { cartId_productId: { cartId, productId } },
      create: { cartId, productId, quantity },
      update: { quantity: { increment: quantity } },
    });
  }

  updateItemQuantity(cartItemId: string, quantity: number) {
    return this.prisma.cartItem.update({ where: { id: cartItemId }, data: { quantity } });
  }

  deleteItem(cartItemId: string) {
    return this.prisma.cartItem.delete({ where: { id: cartItemId } });
  }

  deleteAllItems(cartId: string) {
    return this.prisma.cartItem.deleteMany({ where: { cartId } });
  }

  // Deletes only the SPECIFIC item rows captured at checkout time — not "whatever is in the
  // cart now" — so an item the customer adds WHILE a checkout is in flight (during the Poster
  // call) survives the post-checkout cleanup instead of being silently wiped out.
  deleteItemsByIds(cartItemIds: string[]) {
    return this.prisma.cartItem.deleteMany({ where: { id: { in: cartItemIds } } });
  }

  // Reads the raw lock state so the caller (CartService.acquireCheckoutLock) can decide
  // whether a stale lock is actually SAFE to reclaim — staleness alone is never sufficient,
  // see cart.service.ts for why. Deliberately not folded into a single atomic query: that
  // decision needs a cross-module status check (OrdersService.getIdempotencyStatus) that
  // can't happen inside a single SQL statement.
  getCheckoutLockState(cartId: string) {
    return this.prisma.cart.findUnique({
      where: { id: cartId },
      select: { checkoutLockedAt: true, checkoutIdempotencyKey: true },
    });
  }

  // Atomic claim of a currently-UNLOCKED cart. Two concurrent first-time checkout attempts
  // can't both win this (SQLite serializes the conditional UPDATE) — this is what stops two
  // DIFFERENT keys from both driving a real Poster order off the same cart concurrently, for
  // the common case where nothing is currently locked.
  async claimFreshLock(cartId: string, idempotencyKey: string): Promise<boolean> {
    const result = await this.prisma.cart.updateMany({
      where: { id: cartId, checkoutLockedAt: null },
      data: { checkoutLockedAt: new Date(), checkoutIdempotencyKey: idempotencyKey },
    });
    return result.count === 1;
  }

  // Atomic reclaim of a STALE lock, guarded by compare-and-swap on the exact previousLockedAt
  // value the caller read — so if two requests both see the same stale lock and both pass
  // CartService's safety check, only one of them actually wins the reclaim.
  async reclaimStaleLock(cartId: string, previousLockedAt: Date, idempotencyKey: string): Promise<boolean> {
    const result = await this.prisma.cart.updateMany({
      where: { id: cartId, checkoutLockedAt: previousLockedAt },
      data: { checkoutLockedAt: new Date(), checkoutIdempotencyKey: idempotencyKey },
    });
    return result.count === 1;
  }

  async releaseCheckoutLock(cartId: string): Promise<void> {
    await this.prisma.cart.update({
      where: { id: cartId },
      data: { checkoutLockedAt: null, checkoutIdempotencyKey: null },
    });
  }
}

export type CartWithRelations = NonNullable<Awaited<ReturnType<CartRepository['findByCustomerId']>>>;
