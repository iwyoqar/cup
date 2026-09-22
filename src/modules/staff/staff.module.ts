import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { CustomerActivityRepository } from '../admin-customers/customer-activity.repository';
import { CustomerActivityService } from '../admin-customers/customer-activity.service';
import { BranchModule } from '../branches/branch.module';
import { GrowthIntelligenceModule } from '../growth-intelligence/growth-intelligence.module';
import { Loyalty2Module } from '../loyalty2/loyalty2.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { ReferralsModule } from '../referrals/referrals.module';
import { CustomerMetricsModule } from '../customer-metrics/customer-metrics.module';
import { CustomersModule } from '../customers/customers.module';
import { LoyaltyModule } from '../loyalty/loyalty.module';
import { PosterModule } from '../poster/poster.module';
import { RewardsModule } from '../rewards/reward-programs.module';
import { AdminStaffController } from './admin-staff.controller';
import { StaffAuthGuard } from './staff-auth.guard';
import { StaffAuthService } from './staff-auth.service';
import { StaffCustomersService } from './staff-customers.service';
import { StaffProfileService } from './staff-profile.service';
import { StaffSessionService } from './staff-session.service';
import { StaffController } from './staff.controller';
import { StaffRepository } from './staff.repository';

@Module({
  // Phase 16: the Staff profile only COMPOSES existing read models (Loyalty 2.0, Rewards, Promotions, Referrals, Growth Intelligence, the Customer 360 activity feed).
  // The two activity classes depend on PrismaService alone, so they are provided here directly (AdminCustomersModule imports StaffModule — importing it back would be a cycle).
  imports: [JwtModule.register({}), AdminAuthModule, CustomersModule, LoyaltyModule, RewardsModule, CustomerMetricsModule, PosterModule, BranchModule, Loyalty2Module, PromotionsModule, ReferralsModule, GrowthIntelligenceModule],
  controllers: [StaffController, AdminStaffController],
  providers: [StaffRepository, StaffSessionService, StaffAuthService, StaffAuthGuard, StaffCustomersService, StaffProfileService, CustomerActivityRepository, CustomerActivityService],
  exports: [StaffRepository],
})
export class StaffModule {}
