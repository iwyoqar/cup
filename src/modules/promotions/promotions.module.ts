import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AuthModule } from '../auth/auth.module';
import { CatalogModule } from '../catalog/catalog.module';
import { CustomerMetricsModule } from '../customer-metrics/customer-metrics.module';
import { CustomersModule } from '../customers/customers.module';
import { LoyaltyModule } from '../loyalty/loyalty.module';
import { SegmentsModule } from '../segments/segments.module';
import { CustomerPromotionsController } from './customer-promotions.controller';
import { PromotionAudienceRepository } from './promotion-audience.repository';
import { PromotionAudienceService } from './promotion-audience.service';
import { PromotionCalculationService } from './promotion-calculation.service';
import { PromotionEligibilityService } from './promotion-eligibility.service';
import { PromotionRedemptionsRepository } from './promotion-redemptions.repository';
import { PromotionRedemptionService } from './promotion-redemption.service';
import { PromotionsController } from './promotions.controller';
import { PromotionsRepository } from './promotions.repository';
import { PromotionsService } from './promotions.service';

// SegmentsModule (exports SegmentsService — the ONE canonical segment evaluator, reused for both
// audience targeting and eligibility, never duplicated) and CustomerMetricsModule (the
// "no segment = every customer" case) mirror exactly how CampaignsModule reuses them. CatalogModule
// is reused for FREE_PRODUCT's product-existence/active validation — never a second product
// lookup. LoyaltyModule is reused by PromotionRedemptionService for LOYALTY_POINTS crediting —
// never a second loyalty transaction mechanism.
//
// AuthModule + CustomersModule are imported directly (not just transitively) for the exact same
// reason CartModule/LoyaltyModule already document: Nest resolves a guard-by-class-reference's
// OWN constructor dependencies (AuthGuard needs SessionService + CustomersRepository) against the
// REQUESTING module's import graph — AuthModule never re-exports CustomersRepository. Without
// CustomersModule here too, CustomerPromotionsController's AuthGuard would fail to resolve at
// boot with the same DI-graph error this project has hit (and fixed the same way) several times
// before. AdminAuthModule is the equivalent for PromotionsController's AdminAuthGuard.
//
// PromotionCalculationService and PromotionRedemptionService are exported for a future checkout
// integration to consume — nothing in this module calls PromotionRedemptionService.redeem() from
// an HTTP-reachable path (spec: no public redeem endpoint without a checkout use case).
@Module({
  imports: [AdminAuthModule, AuthModule, CustomersModule, SegmentsModule, CustomerMetricsModule, CatalogModule, LoyaltyModule],
  controllers: [PromotionsController, CustomerPromotionsController],
  providers: [
    PromotionsRepository,
    PromotionsService,
    PromotionRedemptionsRepository,
    PromotionAudienceRepository,
    PromotionAudienceService,
    PromotionEligibilityService,
    PromotionCalculationService,
    PromotionRedemptionService,
  ],
  // PromotionsService is exported (Phase 11.4) only so Customer 360 can reuse its read-only listForCustomer. PromotionEligibilityService and
  // PromotionRedemptionsRepository are exported (Phase 23) so PosWidgetModule can re-validate eligibility and check per-order/per-customer redemption
  // state server-side without a second eligibility implementation — same reasoning RewardProgramsModule already documents for Phase 22.
  exports: [PromotionCalculationService, PromotionRedemptionService, PromotionsService, PromotionEligibilityService, PromotionRedemptionsRepository, PromotionsRepository],
})
export class PromotionsModule {}
