import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule } from './common/config/config.module';
import { PrismaModule } from './common/prisma/prisma.module';
import { AdminAuthModule } from './modules/admin-auth/admin-auth.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { Loyalty2Module } from './modules/loyalty2/loyalty2.module';
import { AutomationsModule } from './modules/automations/automations.module';
import { ReferralsModule } from './modules/referrals/referrals.module';
import { GrowthIntelligenceModule } from './modules/growth-intelligence/growth-intelligence.module';
import { BranchIntelligenceModule } from './modules/branch-intelligence/branch-intelligence.module';
import { FinanceModule } from './modules/finance/finance.module';
import { ReportsModule } from './modules/reports/reports.module';
import { AdminCustomersModule } from './modules/admin-customers/admin-customers.module';
import { AuthModule } from './modules/auth/auth.module';
import { BranchModule } from './modules/branches/branch.module';
import { CampaignsModule } from './modules/campaigns/campaigns.module';
import { CartModule } from './modules/cart/cart.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { CustomersModule } from './modules/customers/customers.module';
import { HealthModule } from './modules/health/health.module';
import { LoyaltyModule } from './modules/loyalty/loyalty.module';
import { OrdersModule } from './modules/orders/orders.module';
import { PosterImportModule } from './modules/poster-import/poster-import.module';
import { PosterModule } from './modules/poster/poster.module';
import { PosterSyncModule } from './modules/poster-sync/poster-sync.module';
import { PosWidgetModule } from './modules/pos-widget/pos-widget.module';
import { PromotionsModule } from './modules/promotions/promotions.module';
import { RewardsModule } from './modules/rewards/reward-programs.module';
import { SegmentsModule } from './modules/segments/segments.module';
import { SettingsModule } from './modules/settings/settings.module';
import { StaffModule } from './modules/staff/staff.module';
import { TelegramModule } from './modules/telegram/telegram.module';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    ScheduleModule.forRoot(),
    PosterModule,
    CustomersModule,
    AuthModule,
    CatalogModule,
    BranchModule,
    CartModule,
    OrdersModule,
    HealthModule,
    TelegramModule,
    AdminAuthModule,
    SettingsModule,
    LoyaltyModule,
    AdminCustomersModule,
    SegmentsModule,
    CampaignsModule,
    PromotionsModule,
    RewardsModule,
    StaffModule,
    PosterImportModule,
    PosterSyncModule,
    PosWidgetModule,
    AnalyticsModule,
    Loyalty2Module,
    AutomationsModule,
    ReferralsModule,
    GrowthIntelligenceModule,
    BranchIntelligenceModule,
    FinanceModule,
    ReportsModule,
  ],
})
export class AppModule {}
