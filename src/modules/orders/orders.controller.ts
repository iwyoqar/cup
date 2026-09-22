import { BadRequestException, Body, Controller, Get, Headers, NotFoundException, Param, Post, Query, UseGuards } from '@nestjs/common';
import { OrderStatus } from '../../common/enums/order-status';
import { clampPageSize } from '../../common/util/pagination';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentCustomer } from '../auth/current-customer.decorator';
import { createOrderSchema } from './create-order.dto';
import { OrdersService } from './orders.service';

interface AuthenticatedCustomer {
  id: string;
}

// Raw shape returned by OrdersService.findById() (OrdersRepository's items.product + branch
// include) — declared structurally here rather than imported, same pattern cart.service.ts
// already uses, so this controller doesn't reach past OrdersService into repository internals.
interface OrderWithRelations {
  id: string;
  customerId: string;
  status: string;
  totalMinor: number;
  createdAt: Date;
  branch: { id: string; name: string; address: string | null } | null;
  items: { quantity: number; unitPriceMinor: number; totalPriceMinor: number; product: { name: string } }[];
}

// Phase 2 spec section 4: a customer-safe detail view — no posterIncomingOrderId, posterSpotId,
// idempotencyKey, or customerId, and items are flattened to just what a receipt needs.
// unitPriceMinor/totalPriceMinor come straight from the stored OrderItem rows, never
// recomputed from the current Product.priceMinor, so historical orders keep their original
// price even if the catalog price has since changed.
function toOrderDetailView(order: OrderWithRelations) {
  return {
    id: order.id,
    status: order.status as OrderStatus,
    // Explicit allowlist, same convention as branch.controller.ts's own list endpoint — the
    // raw relation also carries posterSpotId/syncedAt, which have no business in a customer
    // response.
    branch: order.branch ? { id: order.branch.id, name: order.branch.name, address: order.branch.address } : null,
    items: order.items.map((item) => ({
      productName: item.product.name,
      quantity: item.quantity,
      unitPriceMinor: item.unitPriceMinor,
      totalPriceMinor: item.totalPriceMinor,
    })),
    totalMinor: order.totalMinor,
    createdAt: order.createdAt.toISOString(),
  };
}

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  // Deliberately NOT guarded — this is Phase 0's original internal/testing endpoint, which
  // predates auth entirely and still takes customerId directly in the body. Real customers go
  // through POST /cart/checkout (Phase 1.5), which never accepts a client-supplied customerId.
  // Left as-is to avoid breaking Phase 0's existing test suite, which calls this unauthenticated.
  @Post()
  async create(@Headers('idempotency-key') idempotencyKey: string | undefined, @Body() body: unknown) {
    if (!idempotencyKey) {
      throw new BadRequestException('Idempotency-Key header is required.');
    }
    const parsed = createOrderSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    return this.ordersService.createOrder(idempotencyKey, parsed.data);
  }

  // Phase 2: the authenticated customer's own order history only — customerId always comes
  // from @CurrentCustomer(), never from a query parameter (spec section 9's explicitly
  // forbidden "GET /orders?customerId=..." pattern).
  @UseGuards(AuthGuard)
  @Get()
  async listMine(
    @CurrentCustomer() customer: AuthenticatedCustomer,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.ordersService.listForCustomer(customer.id, { cursor, limit: clampPageSize(limit) });
  }

  // Phase 1.5 correction: now that checkout produces real orders for real authenticated
  // customers, this endpoint needed an ownership check it never had in Phase 0 (when no auth
  // existed and there was only ever one test customer). Guarded at the METHOD level, not the
  // controller level, specifically so POST /orders above stays unauthenticated and Phase 0's
  // existing tests keep working unmodified.
  @UseGuards(AuthGuard)
  @Get(':id')
  async get(@Param('id') id: string, @CurrentCustomer() customer: AuthenticatedCustomer) {
    const order = await this.ordersService.findById(id);
    // Same 404 for "doesn't exist" and "exists but isn't yours" — a mismatched owner must not
    // be able to distinguish the two by response.
    if (!order || order.customerId !== customer.id) {
      throw new NotFoundException('Order not found.');
    }
    return toOrderDetailView(order as OrderWithRelations);
  }
}
