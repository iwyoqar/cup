import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { CustomerMetricsModule } from '../customer-metrics/customer-metrics.module';
import { CustomersModule } from '../customers/customers.module';
import { PosterImportModule } from '../poster-import/poster-import.module';
import { RewardsModule } from '../rewards/reward-programs.module';
import { StaffModule } from '../staff/staff.module';
import { LoyaltyModule } from '../loyalty/loyalty.module';
import { AutomationsModule } from '../automations/automations.module';
import { ReferralsModule } from '../referrals/referrals.module';
import { GrowthIntelligenceModule } from '../growth-intelligence/growth-intelligence.module';
import { Loyalty2Module } from '../loyalty2/loyalty2.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { SegmentsModule } from '../segments/segments.module';
import { AdminCustomersController } from './admin-customers.controller';
import { AdminCustomersRepository } from './admin-customers.repository';
import { AdminCustomersService } from './admin-customers.service';
import { CustomerActivityRepository } from './customer-activity.repository';
import { CustomerActivityService } from './customer-activity.service';

// Deliberately does NOT import OrdersModule — the customer list/search query is self-contained in
// AdminCustomersRepository via direct Prisma access, the same "each repository owns its own
// queries" pattern used throughout. CustomersModule IS imported (Phase 26) so AdminCustomersService
// can call CustomersRepository.deactivate() for the new deactivation endpoint — everything else
// customer-related here still goes through AdminCustomersRepository's own queries. Order-derived metrics/
// favoriteBranch/recentOrders now come from the shared CustomerMetricsModule (Phase 5: one
// canonical definition, reused by segment matching too — see that module's comment). Loyalty
// balance still comes from LoyaltyService's read-only getAccountSnapshot() — never the
// customer-facing getAccountView(), which has side effects (lazy account creation, welcome
// bonus) that must never fire just because an admin opened a profile. No cycle: none of
// AdminAuthModule/LoyaltyModule/CustomerMetricsModule imports this one.
@Module({
  imports: [AdminAuthModule, LoyaltyModule, CustomerMetricsModule, CustomersModule, StaffModule, PosterImportModule, RewardsModule, PromotionsModule, SegmentsModule, Loyalty2Module, AutomationsModule, ReferralsModule, GrowthIntelligenceModule],
  controllers: [AdminCustomersController],
  providers: [AdminCustomersRepository, AdminCustomersService, CustomerActivityRepository, CustomerActivityService],
})
export class AdminCustomersModule {}
