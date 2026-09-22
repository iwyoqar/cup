import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '../../common/config/config.service';
import { IdempotencyStatus } from '../../common/enums/idempotency-status';
import { isUniqueConstraintViolation } from '../../common/util/prisma-errors';
import { BranchRepository } from '../branches/branch.repository';
import { CatalogRepository } from '../catalog/catalog.repository';
import { IdempotencyPayloadMismatchError, OrderCreationFailedError } from '../orders/orders.errors';
import { OrdersService } from '../orders/orders.service';
import { RewardRedemptionService } from '../rewards/reward-redemption.service';
import { CartWithRelations, CartRepository } from './cart.repository';
import {
  BranchInactiveError,
  BranchNotFoundError,
  CartBranchChangeBlockedError,
  CartExpiredError,
  CartHasNoBranchError,
  CartItemNotFoundError,
  CheckoutAlreadyInProgressError,
  CheckoutRequiresManualReconciliationError,
  EmptyCartError,
  ProductInactiveError,
  RewardCheckoutUnavailableError,
  RewardOnlyOrderNotAllowedError,
  ProductNotFoundError,
} from './cart.errors';

export interface CartItemView {
  id: string;
  product: { id: string; name: string; priceMinor: number };
  quantity: number;
  lineTotalMinor: number;
}

// Phase 8: shown as its own line (never merged into an existing CartItemView), matching the
// spec's cart-UI mockup ("Coffee reward: Cappuccino -30,000" as a distinct line). Re-resolved
// live on every GET /cart — if the stored selection is no longer eligible, this is simply null
// in the response (the stored selection itself is left alone, so it can reappear if eligibility
// comes back, e.g. an admin briefly deactivated the program by mistake).
export interface CartRewardView {
  programId: string;
  programName: string;
  productId: string;
  productName: string;
  discountMinor: number;
}

export interface CartView {
  id: string;
  branch: { id: string; name: string; address: string | null } | null;
  items: CartItemView[];
  reward: CartRewardView | null;
  totalMinor: number;
}

export interface CheckoutOrderView {
  id: string;
  status: string;
  branch: { id: string; name: string; address: string | null } | null;
  items: { product: { id: string; name: string; priceMinor: number }; quantity: number; lineTotalMinor: number }[];
  totalMinor: number;
}

export interface CheckoutResponse {
  order: CheckoutOrderView;
}

// Shape returned by OrdersRepository.findById() as of Phase 1.5 (items.product + branch
// included). Declared here structurally rather than imported, to avoid CartService reaching
// into OrdersRepository's internals — it only ever talks to OrdersService.
interface OrderWithCheckoutDetails {
  id: string;
  status: string;
  totalMinor: number;
  branch: { id: string; name: string; address: string | null } | null;
  items: {
    quantity: number;
    unitPriceMinor: number;
    totalPriceMinor: number;
    product: { id: string; name: string };
  }[];
}

// One persistent Cart per Customer (Phase 1.1 schema: Cart.customerId is unique) — mutated in
// place, never a history of past carts. No price is ever read from client input; every price
// in a response comes from the current Product record at read time. Cart currently never
// calls PosterService directly — see docs/PHASE-1-DESIGN.md's architecture principle.
@Injectable()
export class CartService {
  constructor(
    private readonly cartRepository: CartRepository,
    private readonly catalogRepository: CatalogRepository,
    private readonly branchRepository: BranchRepository,
    private readonly ordersService: OrdersService,
    private readonly config: ConfigService,
    private readonly rewardRedemptionService: RewardRedemptionService,
  ) {}

  async getCart(customerId: string): Promise<CartView> {
    const cart = await this.getOrCreateCart(customerId);
    return this.serializeCart(cart);
  }

  // Phase 8: explicit reward selection (spec's "Cart API" section — the customer must
  // explicitly choose which qualifying product receives the reward; checkout never
  // auto-selects one). Re-validated independently server-side regardless of what the Mini App
  // UI already restricted — active program, active/qualifying product, and at least one
  // available reward, all checked fresh via RewardEligibilityService.
  async selectReward(customerId: string, rewardProgramId: string, productId: string): Promise<CartView> {
    if (!this.config.env.REWARD_CHECKOUT_ENABLED) {
      throw new RewardCheckoutUnavailableError();
    }
    await this.rewardRedemptionService.validateSelection(rewardProgramId, customerId, productId);
    const cart = await this.getOrCreateCart(customerId);
    const updated = await this.cartRepository.setReward(cart.id, rewardProgramId, productId);
    return this.serializeCart(updated);
  }

  async clearReward(customerId: string): Promise<CartView> {
    const cart = await this.getOrCreateCart(customerId);
    const updated = await this.cartRepository.clearReward(cart.id);
    return this.serializeCart(updated);
  }

  async setBranch(customerId: string, branchId: string): Promise<CartView> {
    const branch = await this.branchRepository.findById(branchId);
    if (!branch) {
      throw new BranchNotFoundError();
    }
    if (!branch.isActive) {
      throw new BranchInactiveError();
    }

    const cart = await this.getOrCreateCart(customerId);
    if (cart.items.length > 0 && cart.branchId !== branchId) {
      // Prefer rejecting over silently clearing or mixing branches — an accidental branch
      // switch must never silently discard what the customer already picked.
      throw new CartBranchChangeBlockedError();
    }

    const updated = await this.cartRepository.setBranch(cart.id, branchId);
    return await this.serializeCart(updated);
  }

  async addItem(customerId: string, productId: string, quantity: number): Promise<CartView> {
    const product = await this.catalogRepository.findProductById(productId);
    if (!product) {
      throw new ProductNotFoundError();
    }
    if (!product.isActive) {
      throw new ProductInactiveError();
    }

    const cart = await this.getOrCreateCart(customerId);
    if (!cart.branchId) {
      throw new CartHasNoBranchError();
    }

    await this.cartRepository.upsertItem(cart.id, productId, quantity);
    return await this.serializeCart(await this.reloadCart(customerId));
  }

  async updateItemQuantity(customerId: string, cartItemId: string, quantity: number): Promise<CartView> {
    const cart = await this.getOrCreateCart(customerId);
    this.requireOwnedItem(cart, cartItemId);

    await this.cartRepository.updateItemQuantity(cartItemId, quantity);
    return await this.serializeCart(await this.reloadCart(customerId));
  }

  async removeItem(customerId: string, cartItemId: string): Promise<CartView> {
    const cart = await this.getOrCreateCart(customerId);
    this.requireOwnedItem(cart, cartItemId);

    await this.cartRepository.deleteItem(cartItemId);
    return await this.serializeCart(await this.reloadCart(customerId));
  }

  async clearCart(customerId: string): Promise<CartView> {
    const cart = await this.getOrCreateCart(customerId);
    await this.cartRepository.deleteAllItems(cart.id);
    return await this.serializeCart(await this.reloadCart(customerId));
  }

  // Turns the authenticated customer's cart into exactly one CUP Order and one Poster
  // incoming order, reusing OrdersService's existing idempotency machinery unchanged (see
  // docs/PHASE-0-PLAN.md section 8). This method's own job is everything BEFORE and AFTER
  // that call: cart validation, the cross-key checkout lock, and cart cleanup — never Poster
  // communication itself, which stays entirely inside OrdersService/PosterService.
  async checkout(customerId: string, idempotencyKey: string): Promise<CheckoutResponse> {
    const cart = await this.getOrCreateCart(customerId);
    // Phase 8.1: cheap synchronous pre-checks, all BEFORE the checkout lock and before Poster.
    // (1) A reward-only cart is rejected (validateCartForCheckout) — Poster cannot be shown to
    // represent a zero-total order. (2) While the REWARD_CHECKOUT_ENABLED gate is off, a cart that
    // still carries a reward selection cannot be checked out; the customer must remove it first.
    // Whether a selection is still ELIGIBLE is not decided here — that is re-verified fresh
    // below, inside the lock, and never trusted from this flag.
    const hasPendingRewardSelection = Boolean(cart.rewardProgramId && cart.rewardProductId);
    this.validateCartForCheckout(cart, hasPendingRewardSelection);
    if (hasPendingRewardSelection && !this.config.env.REWARD_CHECKOUT_ENABLED) {
      throw new RewardCheckoutUnavailableError();
    }

    // The cross-key race guard: two DIFFERENT Idempotency-Keys checking out this SAME cart at
    // the same time must not both reach Poster. Phase 0's idempotency machinery alone can't
    // catch this — it only protects a single key against itself. Acquired AFTER validation
    // (cheap, read-only checks shouldn't need the lock) and BEFORE OrdersService is ever
    // called (the lock must be held for the entire external-call window).
    await this.acquireCheckoutLock(cart.id, idempotencyKey);

    // Phase 8: resolved fresh, INSIDE the lock — never trusts hasPendingRewardSelection above,
    // which only checked "something was selected," not "it's still valid." See
    // reward-redemption.service.ts's module comment for the full safety analysis this depends
    // on (why it is safe for this to be a plain read with no CAS/retry loop of its own: it only
    // ever runs from here, already serialized per-customer by this exact lock).
    const rewardContext = await this.rewardRedemptionService.resolveForCheckout(customerId, cart.rewardProgramId, cart.rewardProductId);

    // Captured now, before the (possibly slow) Poster call — deleting by these specific ids
    // afterward means an item added to the cart WHILE checkout is in flight survives, instead
    // of being wiped out by a blanket "clear the cart" once the order succeeds.
    const orderedItemIds = cart.items.map((item) => item.id);

    try {
      const result = await this.ordersService.createOrder(idempotencyKey, {
        customerId,
        items: cart.items.map((item) => ({ productId: item.productId, quantity: item.quantity })),
        branchId: cart.branchId!,
        posterSpotId: cart.branch!.posterSpotId,
        rewardContext: rewardContext ?? undefined,
      });

      // A replay must never touch the cart — the customer may have added new items since the
      // ORIGINAL successful checkout already cleared it. Only a fresh success clears anything.
      if (!result.replayed) {
        await this.cartRepository.deleteItemsByIds(orderedItemIds);
        await this.cartRepository.clearReward(cart.id);
      }
      await this.cartRepository.releaseCheckoutLock(cart.id);

      const order = await this.ordersService.findById(result.orderId);
      if (!order) {
        // Should be unreachable — createOrder() just confirmed this order exists — but a
        // silent null-cast into serializeOrderForCheckout would crash confusingly rather than
        // failing clearly, so guard it explicitly.
        throw new Error(`Order ${result.orderId} not found immediately after checkout succeeded.`);
      }
      return { order: this.serializeOrderForCheckout(order as OrderWithCheckoutDetails) };
    } catch (err) {
      // IMPORTANT (fixed after the initial 1.5 checkpoint — see the analysis in
      // docs/... / this session): only release the lock for outcomes we can POSITIVELY
      // confirm mean "Poster was never contacted, or was contacted and definitely rejected."
      // Everything else — including a completely unexpected/unknown error, which is exactly
      // what a crash between a confirmed Poster success and recording that success would
      // look like — must leave the lock held. The previous version of this code released the
      // lock for ANY non-uncertain error, including unknown ones, which silently reopened the
      // cart for a fresh checkout attempt even when Poster's own outcome was never confirmed.
      // Whitelisting the safe cases (rather than blacklisting the unsafe ones) is deliberate:
      // an error type this code doesn't yet know about must default to "unsafe," not "safe."
      if (this.isSafeToReleaseLockImmediately(err)) {
        await this.cartRepository.releaseCheckoutLock(cart.id);
      }
      throw err;
    }
  }

  // OrderCreationFailedError (definite_failure) CONFIRMS Poster explicitly rejected the
  // request and created nothing. BadRequestException and IdempotencyPayloadMismatchError are
  // both thrown BEFORE any Order/IdempotencyKey row is created at all (customer-identity /
  // product resolution, or a key-reuse-with-different-payload check) — Poster is
  // structurally unreachable on those paths. All three are safe to release immediately.
  // Everything else — IdempotencyKeyUncertainError, IdempotencyKeyInProgressError, and any
  // UNKNOWN error type — must default to "unresolved" and leave the lock held, since an
  // unrecognized error is exactly what a crash between a confirmed Poster success and
  // recording that success would look like from here.
  private isSafeToReleaseLockImmediately(err: unknown): boolean {
    return err instanceof OrderCreationFailedError || err instanceof BadRequestException || err instanceof IdempotencyPayloadMismatchError;
  }

  // Fixed after the initial Phase 1.5 checkpoint: a time-only self-heal on the checkout lock
  // (claim it once its age exceeds a threshold, no other check) was found to let a brand-new
  // Idempotency-Key silently drive a second real Poster order for a cart whose FIRST checkout
  // attempt was still "uncertain" — Phase 0's per-key idempotency machinery has no cross-key
  // memory, so nothing else would have caught this. Staleness alone must never be sufficient;
  // the previous attempt's ACTUAL resolution has to be checked before any reclaim.
  private async acquireCheckoutLock(cartId: string, idempotencyKey: string): Promise<void> {
    if (await this.cartRepository.claimFreshLock(cartId, idempotencyKey)) {
      return;
    }

    const state = await this.cartRepository.getCheckoutLockState(cartId);
    if (!state || !state.checkoutLockedAt) {
      // Raced with a concurrent release between our failed claim and this read — one more
      // attempt at a fresh claim; if that also loses, someone else is now legitimately in.
      if (await this.cartRepository.claimFreshLock(cartId, idempotencyKey)) {
        return;
      }
      throw new CheckoutAlreadyInProgressError();
    }

    const ageMs = Date.now() - state.checkoutLockedAt.getTime();
    if (ageMs < this.config.env.IDEMPOTENCY_STALE_IN_PROGRESS_MS) {
      throw new CheckoutAlreadyInProgressError();
    }

    // Stale by time — but time is NOT the authority here. Ask what actually happened to the
    // key that was holding this lock. claimFreshLock/reclaimStaleLock always set
    // checkoutLockedAt and checkoutIdempotencyKey together, so a locked cart with no key on
    // record should never happen under this code — but if it somehow does (e.g. orphaned data
    // from before this fix existed), fail safe rather than silently permissive.
    if (!state.checkoutIdempotencyKey) {
      throw new CheckoutRequiresManualReconciliationError();
    }
    const previousStatus = await this.ordersService.getIdempotencyStatus(state.checkoutIdempotencyKey);
    if (this.isUnresolved(previousStatus)) {
      // UNCERTAIN = do not automatically retry an external Poster operation — this applies
      // exactly as much to a DIFFERENT new key as to retrying the same one. The whole point
      // of this check is that a new key gets no special exemption from that rule.
      throw new CheckoutRequiresManualReconciliationError();
    }
    // 'completed', 'failed', or no record at all (meaning the previous attempt crashed before
    // ever reserving an idempotency key — i.e. before Poster could possibly have been
    // contacted, see attemptFreshCreate) — all genuinely safe to reclaim.

    const reclaimed = await this.cartRepository.reclaimStaleLock(cartId, state.checkoutLockedAt, idempotencyKey);
    if (!reclaimed) {
      // Someone else reclaimed (or renewed) it between our read and this write.
      throw new CheckoutAlreadyInProgressError();
    }
  }

  private isUnresolved(status: IdempotencyStatus | null): boolean {
    return status === 'uncertain' || status === 'in_progress';
  }

  // Ownership boundary: cartItemId is only ever looked up within the CALLER's own cart's
  // items (loaded via customerId, never via a client-supplied cart id), so there is no input
  // that lets one customer reference another customer's cart item.
  private requireOwnedItem(cart: CartWithRelations, cartItemId: string): void {
    const found = cart.items.some((item) => item.id === cartItemId);
    if (!found) {
      throw new CartItemNotFoundError();
    }
  }

  private async reloadCart(customerId: string): Promise<CartWithRelations> {
    const cart = await this.cartRepository.findByCustomerId(customerId);
    if (!cart) {
      throw new CartItemNotFoundError();
    }
    return cart;
  }

  // Read-then-create, with the database's unique constraint on Cart.customerId as the final
  // word if two requests for a brand-new customer race — same pattern already established for
  // OrdersService's idempotency keys and AuthService's first-login TelegramAccount creation.
  private async getOrCreateCart(customerId: string): Promise<CartWithRelations> {
    const existing = await this.cartRepository.findByCustomerId(customerId);
    if (existing) {
      return existing;
    }
    try {
      return await this.cartRepository.createEmptyForCustomer(customerId);
    } catch (err) {
      if (isUniqueConstraintViolation(err)) {
        const raceWinner = await this.cartRepository.findByCustomerId(customerId);
        if (raceWinner) {
          return raceWinner;
        }
      }
      throw err;
    }
  }

  // All of Section 6's pre-Poster checks that are genuinely CartService's job (product/branch
  // re-validation happens here using the ALREADY-loaded cart relations — no need for a fresh
  // DB round trip, since nothing else can have changed them in the same moment). Existence of
  // the product itself is guaranteed by the CartItem->Product foreign key and Phase 0's
  // soft-delete-only policy, so "product not found" cannot actually occur here — only
  // "inactive" is reachable via this path, unlike the product-add endpoint where a client
  // could supply a bogus productId (see ProductNotFoundError there).
  private validateCartForCheckout(cart: CartWithRelations, hasPendingRewardSelection: boolean): void {
    // Phase 8.1: an empty cart is always rejected. If it is empty BUT carries a reward selection,
    // the more specific reward-only error is used (Phase 8 had allowed this; reverted because a
    // zero-total Poster order is unverified). Branch/product-active/expiry checks follow.
    if (cart.items.length === 0) {
      throw hasPendingRewardSelection ? new RewardOnlyOrderNotAllowedError() : new EmptyCartError();
    }
    if (!cart.branchId || !cart.branch) {
      throw new CartHasNoBranchError();
    }
    if (!cart.branch.isActive) {
      throw new BranchInactiveError();
    }
    for (const item of cart.items) {
      if (!item.product.isActive) {
        throw new ProductInactiveError();
      }
    }
    this.assertCartNotExpired(cart);
  }

  // "Last activity" isn't a single existing column: Cart.updatedAt only bumps on a direct
  // write to the Cart row itself (e.g. setBranch), NOT when a related CartItem is added,
  // updated, or removed — so it alone would understate how recently the cart was actually
  // touched. Using max(Cart.updatedAt, every CartItem.addedAt) is a correct, honest proxy
  // built entirely from Phase 1.1's existing timestamps (no schema change, no background
  // job) — its one known gap is that a quantity-only PATCH with no new item added doesn't
  // move this forward, since CartItem has no updatedAt of its own.
  private assertCartNotExpired(cart: CartWithRelations): void {
    const lastActivityAt = cart.items.reduce(
      (latest, item) => (item.addedAt > latest ? item.addedAt : latest),
      cart.updatedAt,
    );
    const ageMs = Date.now() - lastActivityAt.getTime();
    if (ageMs > this.config.env.CART_EXPIRY_MS) {
      throw new CartExpiredError();
    }
  }

  // Built from the PERSISTED Order/OrderItem records, never from the pre-checkout cart
  // snapshot — this is what makes it correct for a replay too (the cart may already be empty,
  // or hold different items, by the time a retry lands). unitPriceMinor/totalPriceMinor are
  // OrderItem's own historical, immutable record of what was actually charged — never current
  // live Product pricing, which is exactly the distinction an order confirmation needs.
  private serializeOrderForCheckout(order: OrderWithCheckoutDetails): CheckoutOrderView {
    return {
      id: order.id,
      status: order.status,
      branch: order.branch,
      items: order.items.map((item) => ({
        product: { id: item.product.id, name: item.product.name, priceMinor: item.unitPriceMinor },
        quantity: item.quantity,
        lineTotalMinor: item.totalPriceMinor,
      })),
      totalMinor: order.totalMinor,
    };
  }

  // Phase 8: also resolves the cart's reward selection (if any) LIVE on every call — the stored
  // Cart.rewardProgramId/rewardProductId is never trusted as-is for display purposes either,
  // consistent with never trusting it at checkout. If it's no longer eligible, `reward` is
  // simply null here; the stored selection itself is left untouched (see CartRewardView's
  // comment).
  private async serializeCart(cart: CartWithRelations): Promise<CartView> {
    const items: CartItemView[] = cart.items.map((item) => ({
      id: item.id,
      product: { id: item.product.id, name: item.product.name, priceMinor: item.product.priceMinor },
      quantity: item.quantity,
      lineTotalMinor: item.product.priceMinor * item.quantity,
    }));
    const itemsTotalMinor = items.reduce((sum, item) => sum + item.lineTotalMinor, 0);

    let reward: CartRewardView | null = null;
    if (cart.rewardProgramId && cart.rewardProductId) {
      const resolved = await this.rewardRedemptionService.resolveForCheckout(cart.customerId, cart.rewardProgramId, cart.rewardProductId);
      if (resolved) {
        // The reward is an ADDITIONAL free unit, not a discount applied to an existing paid
        // line (see schema.prisma's comment on Cart.rewardProgramId and checkout()'s comment
        // for why) — so it never reduces itemsTotalMinor below. discountMinor here is display
        // value only: what the free unit(s) would otherwise have cost, priced via the SAME
        // live Product lookup checkout itself uses, never duplicated pricing logic.
        const rewardProduct = await this.catalogRepository.findProductById(resolved.productId);
        reward = {
          programId: resolved.programId,
          programName: resolved.programName,
          productId: resolved.productId,
          productName: resolved.productName,
          discountMinor: (rewardProduct?.priceMinor ?? 0) * resolved.quantity,
        };
      }
    }

    const totalMinor = itemsTotalMinor;

    return {
      id: cart.id,
      branch: cart.branch ? { id: cart.branch.id, name: cart.branch.name, address: cart.branch.address } : null,
      items,
      reward,
      totalMinor,
    };
  }
}
