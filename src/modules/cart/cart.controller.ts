import { BadRequestException, Body, Controller, Delete, Get, Headers, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentCustomer } from '../auth/current-customer.decorator';
import { addCartItemSchema, selectCartRewardSchema, setCartBranchSchema, updateCartItemSchema } from './cart.dto';
import { MissingIdempotencyKeyError } from './cart.errors';
import { CartService } from './cart.service';

interface AuthenticatedCustomer {
  id: string;
}

// Every route here is guarded — the customer is always resolved from the validated session
// token via @CurrentCustomer(), never from a body/query/URL-supplied customerId. See
// AuthGuard (Phase 1.3) for the actual verification.
@UseGuards(AuthGuard)
@Controller('cart')
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Get()
  getCart(@CurrentCustomer() customer: AuthenticatedCustomer) {
    return this.cartService.getCart(customer.id);
  }

  @Post('branch')
  setBranch(@CurrentCustomer() customer: AuthenticatedCustomer, @Body() body: unknown) {
    const parsed = setCartBranchSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('branchId is required.');
    }
    return this.cartService.setBranch(customer.id, parsed.data.branchId);
  }

  @Post('items')
  addItem(@CurrentCustomer() customer: AuthenticatedCustomer, @Body() body: unknown) {
    const parsed = addCartItemSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('productId and a positive integer quantity are required.');
    }
    return this.cartService.addItem(customer.id, parsed.data.productId, parsed.data.quantity);
  }

  @Patch('items/:cartItemId')
  updateItem(
    @CurrentCustomer() customer: AuthenticatedCustomer,
    @Param('cartItemId') cartItemId: string,
    @Body() body: unknown,
  ) {
    const parsed = updateCartItemSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('A positive integer quantity is required.');
    }
    return this.cartService.updateItemQuantity(customer.id, cartItemId, parsed.data.quantity);
  }

  @Delete('items/:cartItemId')
  removeItem(@CurrentCustomer() customer: AuthenticatedCustomer, @Param('cartItemId') cartItemId: string) {
    return this.cartService.removeItem(customer.id, cartItemId);
  }

  @Delete()
  clearCart(@CurrentCustomer() customer: AuthenticatedCustomer) {
    return this.cartService.clearCart(customer.id);
  }

  // Phase 8: explicit reward selection — the customer must choose which qualifying product
  // receives the reward (spec: "Do NOT automatically select the cheapest/most expensive
  // product"). Server-side re-validates everything (program active, product qualifying/active,
  // reward currently available) regardless of what the Mini App UI already restricted.
  @Post('reward')
  selectReward(@CurrentCustomer() customer: AuthenticatedCustomer, @Body() body: unknown) {
    const parsed = selectCartRewardSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('rewardProgramId and productId are required.');
    }
    return this.cartService.selectReward(customer.id, parsed.data.rewardProgramId, parsed.data.productId);
  }

  @Delete('reward')
  clearReward(@CurrentCustomer() customer: AuthenticatedCustomer) {
    return this.cartService.clearReward(customer.id);
  }

  // No request body: everything checkout needs (branch, items, customer identity) is already
  // resolvable from the authenticated customer's cart — see docs/PHASE-1-DESIGN.md section 3
  // and this phase's spec, both of which prefer an empty body over accepting fields that
  // would just be re-deriving what the server already knows (or, worse, letting a client
  // supply customerId/posterClientId/phone as if they were authoritative).
  @Post('checkout')
  checkout(
    @CurrentCustomer() customer: AuthenticatedCustomer,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    if (!idempotencyKey) {
      throw new MissingIdempotencyKeyError();
    }
    return this.cartService.checkout(customer.id, idempotencyKey);
  }
}
