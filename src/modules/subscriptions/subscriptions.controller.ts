import { BadRequestException, Body, Controller, Get, Headers, Param, Post, Query, UseGuards } from '@nestjs/common';
import { clampPageSize } from '../../common/util/pagination';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentCustomer } from '../auth/current-customer.decorator';
import { IDEMPOTENCY_KEY, purchaseSchema } from './subscriptions.dto';
import { SubscriptionsService } from './subscriptions.service';

interface AuthenticatedCustomer {
  id: string;
}

// Coffee Subscription — customer (Telegram Mini App) endpoints. Identity ALWAYS comes from @CurrentCustomer() (the verified customer
// session) — no endpoint accepts a customerId. Nothing here redeems coffee (only the POS widget can, server-validated) and nothing here
// takes a payment: a purchase is created PAYMENT_PENDING and waits for a future payment provider.
@UseGuards(AuthGuard)
@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  // Current + queued subscription (with derived usage), the pending purchase, available plans and the fixed policy.
  @Get('me')
  me(@CurrentCustomer() customer: AuthenticatedCustomer) {
    return this.subscriptions.customerSummary(customer.id);
  }

  @Get('me/history')
  history(@CurrentCustomer() customer: AuthenticatedCustomer) {
    return this.subscriptions.customerHistory(customer.id);
  }

  @Get('me/redemptions')
  redemptions(@CurrentCustomer() customer: AuthenticatedCustomer, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    return this.subscriptions.customerRedemptions(customer.id, cursor || undefined, clampPageSize(limit));
  }

  @Get('plans')
  plans() {
    return this.subscriptions.plans(true);
  }

  @Post('purchases')
  purchase(@CurrentCustomer() customer: AuthenticatedCustomer, @Body() body: unknown, @Headers('idempotency-key') key?: string) {
    const planId = parsePlan(body);
    return this.subscriptions.createPurchase(customer.id, planId, requireKey(key), { type: 'CUSTOMER', id: customer.id });
  }

  // Renew = the same purchase path; the new subscription is scheduled to start when the current one ends (decided at activation).
  @Post('renew')
  renew(@CurrentCustomer() customer: AuthenticatedCustomer, @Body() body: unknown, @Headers('idempotency-key') key?: string) {
    const planId = parsePlan(body);
    return this.subscriptions.createPurchase(customer.id, planId, requireKey(key), { type: 'CUSTOMER', id: customer.id }, true);
  }

  @Post('purchases/:id/cancel')
  cancel(@CurrentCustomer() customer: AuthenticatedCustomer, @Param('id') id: string) {
    return this.subscriptions.cancelPurchase(id, { type: 'CUSTOMER', id: customer.id }, customer.id);
  }
}

function parsePlan(body: unknown): string {
  const parsed = purchaseSchema.safeParse(body);
  if (!parsed.success) throw new BadRequestException('planId is required.');
  return parsed.data.planId;
}

export function requireKey(key: string | undefined): string {
  if (!key || !IDEMPOTENCY_KEY.test(key)) throw new BadRequestException('A valid Idempotency-Key header is required.');
  return key;
}
