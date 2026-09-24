import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { BranchIntelligenceModule } from '../branch-intelligence/branch-intelligence.module';
import { PosterModule } from '../poster/poster.module';
import { PosterReportsService } from './poster-reports.service';
import { ReportsController } from './reports.controller';
import { ReportsLocationsService } from './reports-locations.service';
import { ReportsPaymentsService } from './reports-payments.service';
import { ReportsCategoriesService } from './reports-categories.service';
import { ReportsProductSalesRepository } from './reports-product-sales.repository';
import { ReportsProductSalesService } from './reports-product-sales.service';
import { ReportsProductsService } from './reports-products.service';
import { FinanceModule } from '../finance/finance.module';
import { GrowthIntelligenceModule } from '../growth-intelligence/growth-intelligence.module';
import { Loyalty2Module } from '../loyalty2/loyalty2.module';
import { RewardsModule } from '../rewards/reward-programs.module';
import { ReportsAbcService } from './reports-abc.service';
import { ReportsCampaignsService } from './reports-campaigns.service';
import { ReportsCustomersRepository } from './reports-customers.repository';
import { ReportsCustomersService } from './reports-customers.service';
import { ReportsEmployeesService } from './reports-employees.service';
import { ReportsLoyaltyRepository } from './reports-loyalty.repository';
import { ReportsLoyaltyService } from './reports-loyalty.service';
import { ReportsPromotionsService } from './reports-promotions.service';
import { ReportsReferralsService } from './reports-referrals.service';
import { ReportsTaxesService } from './reports-taxes.service';
import { ReportsReceiptsService } from './reports-receipts.service';
import { ReportsService } from './reports.service';

// Reports Phase A/B1 — composes AnalyticsModule's exported AnalyticsService/AnalyticsRepository (the canonical
// CUP+POS revenue source) and BranchIntelligenceModule's exported service/repository (the canonical branch
// attribution); introduces no new revenue calculation, no new branch-attribution logic and no new schema.
// Phases D-G add read-only reuse of GrowthIntelligence (lifecycle), Finance (tax liability), Loyalty2 (levels) and
// Rewards (current reward availability) — their exported services only, no logic change.
// PosterModule is read-only here (dash.getSpotsSales, dash.getPaymentsReport, dash.getProductsSales, dash.getCategoriesSales), never mutated.
@Module({
  imports: [AdminAuthModule, AnalyticsModule, BranchIntelligenceModule, PosterModule, GrowthIntelligenceModule, FinanceModule, Loyalty2Module, RewardsModule],
  controllers: [ReportsController],
  providers: [
    ReportsService,
    ReportsLocationsService,
    ReportsPaymentsService,
    ReportsProductSalesRepository,
    ReportsProductSalesService,
    ReportsProductsService,
    ReportsCategoriesService,
    ReportsCustomersRepository,
    ReportsCustomersService,
    ReportsEmployeesService,
    ReportsTaxesService,
    ReportsLoyaltyRepository,
    ReportsLoyaltyService,
    ReportsPromotionsService,
    ReportsCampaignsService,
    ReportsReferralsService,
    ReportsAbcService,
    ReportsReceiptsService,
    PosterReportsService,
  ],
})
export class ReportsModule {}
