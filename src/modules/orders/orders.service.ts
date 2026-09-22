import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../../common/config/config.service';
import { IdempotencyStatus } from '../../common/enums/idempotency-status';
import { OrderStatus, POLLABLE_ORDER_STATUSES } from '../../common/enums/order-status';
import { PrismaService } from '../../common/prisma/prisma.service';
import { isUniqueConstraintViolation } from '../../common/util/prisma-errors';
import { hashPayload } from '../../common/util/stable-hash';
import { CatalogRepository } from '../catalog/catalog.repository';
import { CustomersRepository } from '../customers/customers.repository';
import { mapPosterStatus } from '../poster/poster-status-map';
import { UnmappedPosterStatusError } from '../poster/poster.errors';
import { PosterService } from '../poster/poster.service';
import { ResolvedCheckoutReward, RewardRedemptionService } from '../rewards/reward-redemption.service';
import { CreateOrderInput } from './create-order.dto';
import { IdempotencyRepository } from './idempotency.repository';
import {
  IdempotencyKeyInProgressError,
  IdempotencyKeyUncertainError,
  IdempotencyPayloadMismatchError,
  OrderCreationFailedError,
} from './orders.errors';
import { OrdersRepository, ResolvedOrderItem } from './orders.repository';
import { cupUzsToPosterPrice } from '../poster/poster-money';

const IDEMPOTENCY_SCOPE = 'order.create';

// Phase 1.9: what OrdersService.refreshStatus() reports when it actually observes and persists
// a status change, so OrderStatusSyncService/OrderNotificationService can act on it without
// re-deriving it or reaching into OrdersRepository themselves.
export interface OrderStatusTransition {
  orderId: string;
  customerId: string;
  branchName: string | null;
  previousStatus: OrderStatus;
  newStatus: OrderStatus;
}

// Phase 2 order history — a deliberately lighter view than CreateOrderResponse/the detail view
// below: no items, no Poster ids, no idempotencyKey. See orders.repository.ts's
// findManyByCustomer for why items aren't included here.
export interface OrderSummaryView {
  id: string;
  status: OrderStatus;
  totalMinor: number;
  branch: { id: string; name: string } | null;
  createdAt: string;
}

export interface OrderListPage {
  items: OrderSummaryView[];
  nextCursor: string | null;
}

export interface CreateOrderResponse {
  orderId: string;
  status: OrderStatus;
  posterIncomingOrderId: string;
  // True when this response came from a stored idempotent snapshot (a replay), false when it
  // came from a fresh Poster call just now. Phase 1.5's checkout uses this to decide whether
  // it's safe to clear the cart — a replay must never touch the cart, since the customer may
  // have added new items to it since the original successful checkout. See cart.service.ts.
  replayed: boolean;
}

// Extends the HTTP-facing CreateOrderInput (customerId + items only, per create-order.dto.ts)
// with fields only an in-process caller (CartService, not the public POST /orders HTTP
// endpoint) ever supplies. A plain CreateOrderInput is still structurally assignable here
// since both are optional — OrdersController's existing call is unaffected, and OrdersService
// gains no new constructor dependency: the caller (CartService) already has the Branch object
// in hand (it just validated it's active) and resolves posterSpotId itself, rather than
// OrdersService doing a second lookup.
export interface CreateOrderServiceInput extends CreateOrderInput {
  branchId?: string;
  posterSpotId?: number;
  // Phase 8: set only by CartService, only after it has freshly re-validated reward eligibility
  // inside the checkout lock (see cart.service.ts and reward-redemption.service.ts's module
  // comment on the exact safety ordering this depends on). Never accepted from the public POST
  // /orders body — CreateOrderInput/create-order.dto.ts is untouched.
  rewardContext?: ResolvedCheckoutReward;
}

// An order is logically a SET of (productId, quantity) line items — the array position they
// arrive in is an artifact of client-side serialization, not part of the request's identity.
// Sorting before hashing means two requests with the same items in a different array order
// are recognized as the same request, instead of falsely tripping IdempotencyPayloadMismatchError.
function normalizeItemsForHash(items: CreateOrderInput['items']): CreateOrderInput['items'] {
  return [...items].sort((a, b) => a.productId.localeCompare(b.productId));
}

// Phase 8: the reward selection is part of this request's identity for idempotency purposes —
// a replay under the same Idempotency-Key with a DIFFERENT (or now-missing) reward must be
// caught as a payload mismatch, the same protection normalizeItemsForHash already gives regular
// cart items, rather than silently completing with a different total. See orders.service.ts's
// createOrder for the resulting, narrow, documented edge case this implies.
function rewardContextForHash(rewardContext: ResolvedCheckoutReward | undefined): unknown {
  if (!rewardContext) return null;
  return { programId: rewardContext.programId, productId: rewardContext.productId, quantity: rewardContext.quantity };
}

type PosterClientIdentity = { client_id: number } | { phone: string };

// Per Poster's official docs (github.com/joinposter/docs, confirmed 2026-09-17):
// incomingOrders.createIncomingOrder requires either client_id or phone. Prefer client_id
// when the local Customer is already linked to a real Poster client; otherwise fall back to
// phone. Throws (400) rather than sending a request we already know Poster will reject.
function buildClientIdentity(customer: { posterClientId: string | null; phone: string | null }): PosterClientIdentity {
  if (customer.posterClientId) {
    return { client_id: Number(customer.posterClientId) };
  }
  if (customer.phone) {
    return { phone: customer.phone };
  }
  throw new BadRequestException(
    'Customer has neither a linked Poster client nor a phone number on file — Poster requires one to create an order.',
  );
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly ordersRepository: OrdersRepository,
    private readonly idempotencyRepository: IdempotencyRepository,
    private readonly catalogRepository: CatalogRepository,
    private readonly customersRepository: CustomersRepository,
    private readonly poster: PosterService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    // Optional (not required) so existing test fixtures that construct OrdersService directly
    // with the pre-Phase-8 constructor arity still type-check unmodified — NestJS's real DI
    // container always provides it regardless; every call site below guards with `?.` anyway.
    private readonly rewardRedemptionService?: RewardRedemptionService,
  ) {}

  // See docs/PHASE-0-PLAN.md section 8 for the full state machine this implements.
  async createOrder(idempotencyKey: string, input: CreateOrderServiceInput): Promise<CreateOrderResponse> {
    // Items are order-independent for request-identity purposes: the same logical order
    // submitted with its line items in a different array order must hash the same, or a
    // harmless client-side reordering would falsely trigger IdempotencyPayloadMismatchError.
    // Phase 8.1 FIX: `rewardContext` is included in the hash ONLY when a reward is actually
    // present. Phase 8 added `rewardContext: null` for every order, which silently changed the
    // hash of every NON-reward request — so replaying an idempotency key stored before Phase 8
    // would have failed with IdempotencyPayloadMismatchError instead of returning its stored
    // response. A non-reward request now hashes byte-identically to the pre-Phase-8 format.
    const requestHash = hashPayload({
      customerId: input.customerId,
      items: normalizeItemsForHash(input.items),
      ...(input.rewardContext ? { rewardContext: rewardContextForHash(input.rewardContext) } : {}),
    });
    const existing = await this.idempotencyRepository.findByKey(idempotencyKey);

    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new IdempotencyPayloadMismatchError();
      }
      switch (existing.status) {
        case 'completed': {
          if (!existing.responseSnapshot) {
            throw new OrderCreationFailedError('Idempotency record marked completed but has no stored response.');
          }
          const stored = JSON.parse(existing.responseSnapshot) as CreateOrderResponse;
          // Always set explicitly here, regardless of what the stored snapshot itself
          // contains — this is a replay by definition, whatever the original response said.
          return { ...stored, replayed: true };
        }
        case 'in_progress': {
          const ageMs = Date.now() - existing.updatedAt.getTime();
          if (ageMs < this.config.env.IDEMPOTENCY_STALE_IN_PROGRESS_MS) {
            throw new IdempotencyKeyInProgressError();
          }
          // Stale: something (a crash, a lost DB write) left this key reserved without ever
          // recording a definite outcome. We still do NOT know whether Poster was called —
          // never retried automatically, only downgraded to the existing "uncertain" state,
          // which itself blocks further auto-retry. See docs/PHASE-0-PLAN.md section 8.
          return this.markStaleInProgressAsUncertain(existing.key, existing.orderId);
        }
        case 'uncertain':
          throw new IdempotencyKeyUncertainError(
            'Previous attempt did not receive a definite response from Poster before this request replayed the same key.',
          );
        case 'failed':
          return this.retryFailedAttempt(existing.key, existing.orderId, input);
        default:
          throw new OrderCreationFailedError(`Unknown idempotency record status "${existing.status}".`);
      }
    }

    const customer = await this.customersRepository.findById(input.customerId);
    if (!customer) {
      throw new BadRequestException(`Unknown customerId: ${input.customerId}`);
    }
    const clientIdentity = buildClientIdentity(customer);

    return this.attemptFreshCreate(idempotencyKey, requestHash, input, clientIdentity);
  }

  async findById(orderId: string) {
    return this.ordersRepository.findById(orderId);
  }

  // Phase 2 order history. Cursor is an opaque order id (spec section 3): the caller passes
  // back whatever `nextCursor` this returned, never a page number or offset. `limit` is
  // expected to already be clamped by the controller — this trusts its caller the same way
  // every other service method in this codebase trusts its own controller's validation.
  async listForCustomer(customerId: string, options: { cursor?: string; limit: number }): Promise<OrderListPage> {
    const rows = await this.ordersRepository.findManyByCustomer(customerId, {
      cursor: options.cursor,
      take: options.limit + 1,
    });
    const hasMore = rows.length > options.limit;
    const pageRows = hasMore ? rows.slice(0, options.limit) : rows;
    return {
      items: pageRows.map((order) => ({
        id: order.id,
        status: order.status as OrderStatus,
        totalMinor: order.totalMinor,
        branch: order.branch ? { id: order.branch.id, name: order.branch.name } : null,
        createdAt: order.createdAt.toISOString(),
      })),
      nextCursor: hasMore ? pageRows[pageRows.length - 1].id : null,
    };
  }

  // Added when fixing Phase 1.5's cart checkout lock: a time-only self-heal on that lock
  // cannot tell "the previous attempt is definitely resolved" from "we just haven't heard
  // back yet" — it needs to ask OrdersService what actually happened to a specific key,
  // without reaching past this service into IdempotencyRepository directly. Returns null if
  // no record exists for the key at all (which — given the key is always reserved BEFORE any
  // Poster call is ever made, see attemptFreshCreate — safely means Poster was never
  // contacted under that key).
  async getIdempotencyStatus(idempotencyKey: string): Promise<IdempotencyStatus | null> {
    const record = await this.idempotencyRepository.findByKey(idempotencyKey);
    return record ? (record.status as IdempotencyStatus) : null;
  }

  async findPollableOrders() {
    return this.ordersRepository.findPollable(POLLABLE_ORDER_STATUSES);
  }

  // Phase 1.9: return type extended from `void` to a transition descriptor (or null when
  // nothing changed) so OrderStatusSyncService can decide whether a status-change notification
  // is warranted — the ONLY existing caller (OrderStatusPollJob, now OrderStatusSyncService)
  // never used the return value, so this is not a breaking change to anything. The Poster-call
  // and mapping logic itself is untouched from Phase 0/1.5.
  async refreshStatus(orderId: string): Promise<OrderStatusTransition | null> {
    const order = await this.ordersRepository.findById(orderId);
    if (!order || !order.posterIncomingOrderId) {
      return null;
    }

    const posterOrder = await this.poster.getOrderStatus(order.posterIncomingOrderId);
    if (!posterOrder) {
      this.logger.warn(
        `Poster returned no order for incoming_order_id=${order.posterIncomingOrderId} (CUP order ${order.id})`,
      );
      return null;
    }

    let mappedStatus: OrderStatus;
    try {
      mappedStatus = mapPosterStatus(posterOrder.status);
    } catch (err) {
      if (err instanceof UnmappedPosterStatusError) {
        // Per the Phase 0 rule against guessing: an unrecognized Poster status code is
        // logged loudly and the order is left exactly as it was, not silently advanced.
        this.logger.error(
          `Order ${order.id}: ${err.message} Leaving CUP status unchanged at "${order.status}".`,
        );
        return null;
      }
      throw err;
    }

    if (mappedStatus === order.status) {
      return null;
    }

    // Poster "0" maps to 'pending', but an order only reaches this point once it has a
    // posterIncomingOrderId, i.e. it is already past CUP's own 'pending' (= not yet sent to
    // Poster). Poster "0" for it just means "sent, not accepted yet" — exactly 'sent_to_poster',
    // which it already is. Writing 'pending' would be a downgrade that drops the order out of
    // POLLABLE_ORDER_STATUSES (so it is never polled again and never reaches 'accepted') and out
    // of CUSTOMER_METRICS_ORDER_STATUSES.
    if (mappedStatus === 'pending') {
      return null;
    }

    const previousStatus = order.status as OrderStatus;
    await this.ordersRepository.updateStatus(this.prisma, order.id, mappedStatus);
    this.logger.log(`Order ${order.id}: ${previousStatus} -> ${mappedStatus}`);
    return {
      orderId: order.id,
      customerId: order.customerId,
      branchName: order.branch?.name ?? null,
      previousStatus,
      newStatus: mappedStatus,
    };
  }

  // Always throws — downgrades a stale "in_progress" record to "uncertain" (see createOrder
  // above) without ever contacting Poster. Return type is `never` so callers can `return` it
  // directly from a function whose declared return type is CreateOrderResponse.
  private async markStaleInProgressAsUncertain(idempotencyKey: string, orderId: string | null): Promise<never> {
    await this.prisma.runTransaction(async (tx) => {
      if (orderId) {
        await this.ordersRepository.updateStatus(tx, orderId, 'uncertain');
      }
      await this.idempotencyRepository.markUncertain(tx, idempotencyKey);
    });
    throw new IdempotencyKeyUncertainError(
      'A previous request with this Idempotency-Key was left "in progress" past the staleness ' +
        'threshold and never recorded a definite outcome (likely a crash or failure between ' +
        'reserving the request and recording its result). Treated as uncertain rather than retried.',
    );
  }

  // Phase 8.1 defense in depth (CartService is the primary gate): an order carrying a reward may
  // never reach Poster while REWARD_CHECKOUT_ENABLED is off. Thrown BEFORE any Order/Idempotency
  // row exists on both the fresh and retry paths, so it is a BadRequestException — one of the
  // outcomes CartService already treats as safe to release the checkout lock for. Deliberately NOT
  // applied to the replay-of-a-completed-order path (a stored response is returned untouched).
  private assertRewardCheckoutEnabled(input: CreateOrderServiceInput): void {
    if (input.rewardContext && !this.config.env.REWARD_CHECKOUT_ENABLED) {
      throw new BadRequestException('Reward checkout is not enabled.');
    }
  }

  // rewardContext (Phase 8), when present, is resolved into ONE ADDITIONAL line item priced at
  // 0 — never a discount applied to an existing line. This is deliberate: the customer's paid
  // items must always reflect their true catalog price (never silently reduced), and the free
  // reward is a genuinely separate unit they're receiving, matching how CartService represents
  // it (a distinct cart-level selection, not a modification to an existing CartItem's
  // quantity/price — see schema.prisma's comment on Cart.rewardProgramId).
  private async resolveItems(items: CreateOrderInput['items'], rewardContext?: ResolvedCheckoutReward): Promise<ResolvedOrderItem[]> {
    const resolved: ResolvedOrderItem[] = [];
    for (const item of items) {
      const product = await this.catalogRepository.findProductById(item.productId);
      if (!product || !product.isActive) {
        throw new BadRequestException(`Unknown or inactive product: ${item.productId}`);
      }
      resolved.push({
        productId: product.id,
        posterProductId: product.posterProductId,
        quantity: item.quantity,
        unitPriceMinor: product.priceMinor,
        totalPriceMinor: product.priceMinor * item.quantity,
        isRewardItem: false,
      });
    }
    if (rewardContext) {
      const rewardProduct = await this.catalogRepository.findProductById(rewardContext.productId);
      if (!rewardProduct || !rewardProduct.isActive) {
        // Re-validated here defensively — CartService already confirmed this via
        // RewardEligibilityService immediately before calling in, but this service never trusts
        // a caller-supplied product without its own independent check (same rule every other
        // productId in `items` above is held to).
        throw new BadRequestException(`Reward product is no longer available: ${rewardContext.productId}`);
      }
      resolved.push({
        productId: rewardProduct.id,
        posterProductId: rewardProduct.posterProductId,
        quantity: rewardContext.quantity,
        unitPriceMinor: 0,
        totalPriceMinor: 0,
        isRewardItem: true,
      });
    }
    return resolved;
  }

  private async attemptFreshCreate(
    idempotencyKey: string,
    requestHash: string,
    input: CreateOrderServiceInput,
    clientIdentity: PosterClientIdentity,
  ): Promise<CreateOrderResponse> {
    this.assertRewardCheckoutEnabled(input);
    const resolvedItems = await this.resolveItems(input.items, input.rewardContext);
    const totalMinor = resolvedItems.reduce((sum, i) => sum + i.totalPriceMinor, 0);
    const { spotId, branchId } = this.resolveSpotForBranch(input);

    let orderId: string;
    try {
      // The idempotency record is reserved in the SAME transaction as the pending order,
      // and BEFORE Poster is ever called — this is what makes a concurrent duplicate
      // request race into a clean 409 instead of two Poster orders.
      const created = await this.prisma.runTransaction(async (tx) => {
        const order = await this.ordersRepository.createPendingWithItems(tx, {
          customerId: input.customerId,
          posterSpotId: spotId,
          branchId,
          idempotencyKey,
          totalMinor,
          items: resolvedItems,
        });
        await this.idempotencyRepository.create(tx, {
          key: idempotencyKey,
          scope: IDEMPOTENCY_SCOPE,
          requestHash,
          orderId: order.id,
        });
        return order;
      });
      orderId = created.id;
    } catch (err) {
      if (isUniqueConstraintViolation(err)) {
        // Lost a race with a concurrent request using the same key.
        throw new IdempotencyKeyInProgressError();
      }
      throw err;
    }

    return this.sendToPoster(orderId, idempotencyKey, spotId, resolvedItems, clientIdentity, input.customerId, input.rewardContext);
  }

  private async retryFailedAttempt(
    idempotencyKey: string,
    orderId: string | null,
    input: CreateOrderServiceInput,
  ): Promise<CreateOrderResponse> {
    this.assertRewardCheckoutEnabled(input);
    if (!orderId) {
      throw new OrderCreationFailedError('Previous failed attempt has no associated order to retry.');
    }
    const existingOrder = await this.ordersRepository.findById(orderId);
    if (!existingOrder) {
      throw new OrderCreationFailedError(`Order ${orderId} for this retry no longer exists.`);
    }
    const customer = await this.customersRepository.findById(input.customerId);
    if (!customer) {
      throw new OrderCreationFailedError(`Customer ${input.customerId} for this retry no longer exists.`);
    }
    const clientIdentity = buildClientIdentity(customer);

    // Re-resolve prices from the CURRENT catalog rather than reusing whatever was resolved
    // during the original failed attempt: catalog sync may have changed prices in between,
    // and the persisted Order/OrderItem rows must match exactly what is about to be sent to
    // Poster, not stale figures from the first attempt.
    const resolvedItems = await this.resolveItems(input.items, input.rewardContext);
    const totalMinor = resolvedItems.reduce((sum, i) => sum + i.totalPriceMinor, 0);
    // Preserve the ORIGINAL spot/branch decision rather than recomputing it — posterSpotId is
    // a structural property of this order, not something a retry should be able to silently
    // change even if the caller's branchId happened to differ.
    const spotId = existingOrder.posterSpotId;

    await this.prisma.runTransaction(async (tx) => {
      await this.ordersRepository.resetToPendingForRetryWithFreshPricing(tx, orderId, { totalMinor, items: resolvedItems });
      await this.idempotencyRepository.markInProgress(tx, idempotencyKey);
    });

    return this.sendToPoster(orderId, idempotencyKey, spotId, resolvedItems, clientIdentity, input.customerId, input.rewardContext);
  }

  // Phase 8 / CRITICAL EXTERNAL SIDE EFFECT ORDER: rewardContext is ONLY ever turned into a
  // persisted RewardRedemption row inside the SAME transaction as recording Poster's CONFIRMED
  // success below — never before the Poster call, never in the definite_failure or
  // ambiguous_failure branches. See reward-redemption.service.ts's module comment for the full
  // failure-window analysis this ordering is built on. Poster itself has no price/discount
  // field (see poster.types.ts's CreatePosterOrderItemInput) — the reward line item is sent at
  // Poster's own configured price for that product, same as every other line; CUP's own
  // Order/OrderItem/RewardRedemption records are what correctly show it as free. This is a
  // KNOWN, DOCUMENTED representation limitation, not an oversight — see this phase's final
  // report.
  private async sendToPoster(
    orderId: string,
    idempotencyKey: string,
    spotId: number,
    resolvedItems: ResolvedOrderItem[],
    clientIdentity: PosterClientIdentity,
    customerId: string,
    rewardContext?: ResolvedCheckoutReward,
  ): Promise<CreateOrderResponse> {
    const outcome = await this.poster.createOrder({
      spot_id: spotId,
      ...clientIdentity,
      // Non-reward lines keep the EXACT pre-Phase-8 shape ({product_id, count}, no price key),
      // so a normal checkout's Poster payload is byte-identical to before. Only a free reward
      // line adds the documented per-line `price: 0` (see CreatePosterOrderItemInput.price).
      products: resolvedItems.map((item) => ({
        product_id: Number(item.posterProductId),
        count: item.quantity,
        ...(item.isRewardItem ? { price: cupUzsToPosterPrice(0) } : {}),
      })),
    });

    if (outcome.kind === 'success') {
      const response: CreateOrderResponse = {
        orderId,
        status: 'sent_to_poster',
        posterIncomingOrderId: outcome.incomingOrderId,
        replayed: false,
      };
      await this.prisma.runTransaction(async (tx) => {
        await this.ordersRepository.updateAfterPosterSuccess(tx, orderId, outcome.incomingOrderId);
        await this.idempotencyRepository.markCompleted(tx, idempotencyKey, JSON.stringify(response));
        if (rewardContext) {
          await this.rewardRedemptionService?.createRedemptionRecord(tx, rewardContext, customerId, orderId);
        }
      });
      return response;
    }

    if (outcome.kind === 'definite_failure') {
      await this.prisma.runTransaction(async (tx) => {
        await this.ordersRepository.updateStatus(tx, orderId, 'failed');
        await this.idempotencyRepository.markFailed(tx, idempotencyKey);
      });
      throw new OrderCreationFailedError(outcome.reason);
    }

    // ambiguous_failure — the documented remaining failure window (see docs/PHASE-0-PLAN.md
    // section 8): CUP cannot confirm whether Poster created the order. Marked uncertain,
    // never auto-retried, surfaced clearly to the caller.
    await this.prisma.runTransaction(async (tx) => {
      await this.ordersRepository.updateStatus(tx, orderId, 'uncertain');
      await this.idempotencyRepository.markUncertain(tx, idempotencyKey);
    });
    throw new IdempotencyKeyUncertainError(outcome.reason);
  }

  // Only used on a fresh create — a retry preserves the ORIGINAL order's stored posterSpotId
  // instead (see retryFailedAttempt). Falls back to the global default spot for callers that
  // don't supply branchId/posterSpotId at all (Phase 0's POST /orders), preserving existing
  // behavior exactly. Trusts the caller's posterSpotId when branchId is set — CartService
  // already validated the branch and has Branch.posterSpotId in hand, so OrdersService doesn't
  // need its own BranchRepository dependency just to re-derive a value the caller already has.
  private resolveSpotForBranch(input: CreateOrderServiceInput): { spotId: number; branchId: string | null } {
    if (!input.branchId) {
      return { spotId: this.config.env.POSTER_DEFAULT_SPOT_ID, branchId: null };
    }
    if (input.posterSpotId === undefined) {
      throw new BadRequestException('branchId was provided without a resolved posterSpotId.');
    }
    return { spotId: input.posterSpotId, branchId: input.branchId };
  }
}
