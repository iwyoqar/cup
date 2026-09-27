import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AuthModule } from '../auth/auth.module';
import { CustomersModule } from '../customers/customers.module';
import { StaffModule } from '../staff/staff.module';
import { AdminSubscriptionsController } from './admin-subscriptions.controller';
import { SubscriptionAuditService } from './subscription-audit.service';
import { SubscriptionExpiryJob } from './subscription-expiry.job';
import { SubscriptionPaymentRegistry } from './subscription-payments';
import { SubscriptionPlansService } from './subscription-plans.service';
import { SubscriptionsAdminService } from './subscriptions-admin.service';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsRepository } from './subscriptions.repository';
import { SubscriptionsService } from './subscriptions.service';

// Coffee Subscription — a first-class CUP domain. Plans, product eligibility, subscriptions, purchases (provider-agnostic) and the read
// models. Redemption at the register lives in PosWidgetModule (PosWidgetSubscriptionRedemptionService), reusing this module's repository,
// rules and audit — the same split as rewards (RewardsModule) vs. their POS redemption (PosWidgetModule).
@Module({
  imports: [AuthModule, CustomersModule, AdminAuthModule, StaffModule],
  controllers: [SubscriptionsController, AdminSubscriptionsController],
  providers: [SubscriptionsRepository, SubscriptionsService, SubscriptionPlansService, SubscriptionsAdminService, SubscriptionAuditService, SubscriptionPaymentRegistry, SubscriptionExpiryJob],
  exports: [SubscriptionsRepository, SubscriptionsService, SubscriptionAuditService],
})
export class SubscriptionsModule {}
