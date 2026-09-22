import { Injectable } from '@nestjs/common';
import { Db, PrismaService } from '../../common/prisma/prisma.service';
import { OrderStatus } from '../../common/enums/order-status';

export interface ResolvedOrderItem {
  productId: string;
  posterProductId: string;
  quantity: number;
  unitPriceMinor: number;
  totalPriceMinor: number;
  // Phase 8: true only for a free reward line resolved via CartService's reward selection —
  // see schema.prisma's comment on OrderItem.isRewardItem for why this must be an explicit
  // flag, never inferred from unitPriceMinor==0. Optional (not required) so existing test
  // fixtures built against the pre-Phase-8 shape still type-check unmodified — undefined is
  // equivalent to omitting the field, and the DB column's own @default(false) applies exactly
  // as if false had been passed explicitly.
  isRewardItem?: boolean;
}

export interface CreatePendingOrderData {
  customerId: string;
  posterSpotId: number;
  branchId?: string | null; // Phase 1.5: set when the order originated from a Cart checkout.
  idempotencyKey: string;
  totalMinor: number;
  items: ResolvedOrderItem[];
}

@Injectable()
export class OrdersRepository {
  constructor(private readonly prisma: PrismaService) {}

  createPendingWithItems(db: Db, data: CreatePendingOrderData) {
    return db.order.create({
      data: {
        customerId: data.customerId,
        posterSpotId: data.posterSpotId,
        branchId: data.branchId ?? null,
        idempotencyKey: data.idempotencyKey,
        status: 'pending' satisfies OrderStatus,
        totalMinor: data.totalMinor,
        items: { create: data.items },
      },
      include: { items: true },
    });
  }

  updateAfterPosterSuccess(db: Db, orderId: string, posterIncomingOrderId: string) {
    return db.order.update({
      where: { id: orderId },
      data: { posterIncomingOrderId, status: 'sent_to_poster' satisfies OrderStatus },
    });
  }

  updateStatus(db: Db, orderId: string, status: OrderStatus) {
    return db.order.update({ where: { id: orderId }, data: { status } });
  }

  // Used when retrying a previously "failed" idempotency key: replaces the order's items and
  // total with freshly resolved prices (catalog prices may have changed since the original
  // attempt) so the persisted Order/OrderItem rows match exactly what is sent to Poster.
  resetToPendingForRetryWithFreshPricing(
    db: Db,
    orderId: string,
    data: { totalMinor: number; items: ResolvedOrderItem[] },
  ) {
    return db.order.update({
      where: { id: orderId },
      data: {
        status: 'pending' satisfies OrderStatus,
        posterIncomingOrderId: null,
        totalMinor: data.totalMinor,
        items: {
          deleteMany: {},
          create: data.items,
        },
      },
      include: { items: true },
    });
  }

  // Includes items.product and branch — additive vs. Phase 0 (which only loaded bare items):
  // Phase 1.5's checkout response needs product name/branch detail, and GET /orders/:id
  // gains the same detail for free rather than needing a second, near-duplicate query method.
  findById(id: string) {
    return this.prisma.order.findUnique({
      where: { id },
      include: { items: { include: { product: true } }, branch: true },
    });
  }

  // Phase 2 order history: bounded, cursor-paginated, newest first. Only `branch` is included —
  // deliberately NOT `items`/`product` here, since a list of order cards doesn't need per-item
  // detail and fetching it for every row would be an avoidable N+1-shaped cost (spec section
  // 13). `take` is `limit + 1`; the extra row (if present) tells the caller whether there's a
  // next page without a separate count query.
  findManyByCustomer(customerId: string, options: { cursor?: string; take: number }) {
    return this.prisma.order.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      take: options.take,
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
      include: { branch: true },
    });
  }

  findPollable(pollableStatuses: readonly OrderStatus[]) {
    return this.prisma.order.findMany({
      where: {
        status: { in: [...pollableStatuses] },
        posterIncomingOrderId: { not: null },
      },
    });
  }
}
