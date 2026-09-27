import { BadRequestException, Body, Controller, ForbiddenException, Get, Headers, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ConfigService } from '../../common/config/config.service';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard';
import { CurrentAdmin } from '../admin-auth/current-admin.decorator';
import { isAdminRole } from '../staff/staff-roles';
import { adminPurchaseSchema, cancelSchema, manualActivationSchema, resolveRedemptionSchema } from './subscriptions.dto';
import { requireKey } from './subscriptions.controller';
import { SubscriptionPlansService } from './subscription-plans.service';
import { SubscriptionPaymentRegistry } from './subscription-payments';
import { SubscriptionsAdminService } from './subscriptions-admin.service';
import { SUBSCRIPTION_POLICY, SubscriptionsService } from './subscriptions.service';

interface AuthenticatedAdmin {
  id: string;
  role: string;
}

type Q = Record<string, string | undefined>;

// Coffee Subscription — Admin API. Reads: any authenticated admin. Every write (plans, product mappings, purchases, activation,
// cancellation, resolving an UNKNOWN redemption): an ADMIN-role account (same rule as staff management), and each is audited.
// There is no endpoint that edits a balance, a redemption's portions or a subscription's dates by hand.
@UseGuards(AdminAuthGuard)
@Controller('admin/subscriptions')
export class AdminSubscriptionsController {
  constructor(
    private readonly admin: SubscriptionsAdminService,
    private readonly plans: SubscriptionPlansService,
    private readonly subscriptions: SubscriptionsService,
    private readonly payments: SubscriptionPaymentRegistry,
    private readonly config: ConfigService,
  ) {}

  @Get('settings')
  settings() {
    return {
      manualActivationEnabled: this.config.env.SUBSCRIPTIONS_MANUAL_ACTIVATION_ENABLED,
      posRedemptionEnabled: this.config.env.POS_SUBSCRIPTION_REDEMPTION_ENABLED,
      posCashSaleEnabled: this.config.env.POS_SUBSCRIPTION_CASH_SALE_ENABLED,
      posPosterPurchaseEnabled: this.config.env.POS_SUBSCRIPTION_POSTER_PURCHASE_ENABLED,
      paymentProviders: this.payments.available(),
      policy: SUBSCRIPTION_POLICY,
    };
  }

  @Get('overview')
  overview(@Query() q: Q) {
    return this.admin.overview(q);
  }

  @Get('active')
  active(@Query() q: Q) {
    return this.admin.active(q);
  }

  @Get('revenue')
  revenue(@Query() q: Q) {
    return this.admin.revenue(q);
  }

  // ---- plans + eligible products ----------------------------------------------------------------------------------------------------
  @Get('plans')
  listPlans() {
    return this.plans.list();
  }

  @Post('plans')
  createPlan(@Body() body: unknown, @CurrentAdmin() a: AuthenticatedAdmin) {
    requireRole(a);
    return this.plans.create(body, a.id);
  }

  @Patch('plans/:id')
  updatePlan(@Param('id') id: string, @Body() body: unknown, @CurrentAdmin() a: AuthenticatedAdmin) {
    requireRole(a);
    return this.plans.update(id, body, a.id);
  }

  @Get('products')
  products() {
    return this.plans.listMappings();
  }

  // Coffee Subscription — real Poster order purchase. The plan form's "Poster mahsulot" dropdown source: every active synced product, no
  // live Poster call (reuses the catalog CUP already syncs).
  @Get('eligible-products')
  eligibleProducts() {
    return this.plans.eligibleProducts();
  }

  @Post('products')
  addProduct(@Body() body: unknown, @CurrentAdmin() a: AuthenticatedAdmin) {
    requireRole(a);
    return this.plans.createMapping(body, a.id);
  }

  @Patch('products/:id')
  updateProduct(@Param('id') id: string, @Body() body: unknown, @CurrentAdmin() a: AuthenticatedAdmin) {
    requireRole(a);
    return this.plans.updateMapping(id, body, a.id);
  }

  // ---- redemptions ------------------------------------------------------------------------------------------------------------------
  @Get('redemptions')
  redemptions(@Query() q: Q) {
    return this.admin.redemptions(q);
  }

  @Get('redemptions/:id')
  redemption(@Param('id') id: string) {
    return this.admin.redemptionDetail(id);
  }

  @Post('redemptions/:id/resolve')
  resolve(@Param('id') id: string, @Body() body: unknown, @CurrentAdmin() a: AuthenticatedAdmin) {
    requireRole(a);
    const parsed = resolveRedemptionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('outcome (CONFIRMED | FAILED) and a note are required.');
    return this.admin.resolveRedemption(id, parsed.data.outcome, parsed.data.note, a.id);
  }

  // ---- customers --------------------------------------------------------------------------------------------------------------------
  @Get('customers')
  customers(@Query() q: Q) {
    return this.admin.customers(q);
  }

  @Get('customers/:customerId')
  customer(@Param('customerId') customerId: string) {
    return this.admin.customerDetail(customerId);
  }

  // ---- purchases / lifecycle --------------------------------------------------------------------------------------------------------
  @Post('purchases')
  createPurchase(@Body() body: unknown, @CurrentAdmin() a: AuthenticatedAdmin, @Headers('idempotency-key') key?: string) {
    requireRole(a);
    const parsed = adminPurchaseSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('customerId and planId are required.');
    return this.admin.createPurchaseFor(parsed.data.customerId, parsed.data.planId, requireKey(key), a.id);
  }

  @Get('purchases/:id')
  purchase(@Param('id') id: string) {
    return this.admin.purchase(id);
  }

  // Development / manual initialization only — NOT a payment. Double-gated (env flag + ADMIN role), audited, never revenue.
  @Post('purchases/:id/manual-activate')
  manualActivate(@Param('id') id: string, @Body() body: unknown, @CurrentAdmin() a: AuthenticatedAdmin) {
    requireRole(a);
    const parsed = manualActivationSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('A note explaining the manual activation is required.');
    return this.subscriptions.manualActivate(id, a.id, parsed.data.note);
  }

  @Post('purchases/:id/cancel')
  cancelPurchase(@Param('id') id: string, @CurrentAdmin() a: AuthenticatedAdmin) {
    requireRole(a);
    return this.subscriptions.cancelPurchase(id, { type: 'ADMIN', id: a.id }, null);
  }

  @Post(':id/cancel')
  cancelSubscription(@Param('id') id: string, @Body() body: unknown, @CurrentAdmin() a: AuthenticatedAdmin) {
    requireRole(a);
    const parsed = cancelSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('A cancellation reason is required.');
    return this.subscriptions.cancelSubscription(id, { type: 'ADMIN', id: a.id }, parsed.data.reason);
  }
}

function requireRole(a: AuthenticatedAdmin): void {
  if (!isAdminRole(a.role)) throw new ForbiddenException('Admin role required.');
}
