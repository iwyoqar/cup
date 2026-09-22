import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { CatalogModule } from '../catalog/catalog.module';
import { RewardEligibilityService } from './reward-eligibility.service';
import { RewardProgramsController } from './reward-programs.controller';
import { RewardProgramsRepository } from './reward-programs.repository';
import { RewardProgramsService } from './reward-programs.service';
import { RewardProgressRepository } from './reward-progress.repository';
import { RewardProgressService } from './reward-progress.service';
import { RewardRedemptionsRepository } from './reward-redemptions.repository';
import { RewardRedemptionService } from './reward-redemption.service';

// CatalogModule is reused for qualifying-category/reward-product validation — never a second
// product/category lookup (same pattern PromotionsModule already established for FREE_PRODUCT).
// No CustomerMetricsModule / PosterImportModule dependency: RewardProgressRepository queries
// Order/OrderItem and the canonical imported POS tables (PosterImportedTransaction/Item)
// directly, only REUSING the CUSTOMER_METRICS_ORDER_STATUSES constant as a plain import (not a
// DI dependency) — see that repository's comment. The reward engine never calls Poster.
//
// Exports RewardProgramsService (consumed by LoyaltyController for GET /loyalty/rewards — see
// loyalty.module.ts) and RewardRedemptionService (consumed by CartModule for checkout
// integration — see cart.module.ts). No cycle: neither LoyaltyModule nor CartModule is imported
// back here.
//
// Phase 22: also exports RewardProgramsRepository and RewardEligibilityService so PosWidgetModule can re-validate a redemption request's program and
// product SERVER-SIDE (never trusting the widget) with the exact same eligibility logic checkout already uses — no second implementation of "is this
// product eligible right now" anywhere in the codebase.
@Module({
  imports: [AdminAuthModule, CatalogModule],
  controllers: [RewardProgramsController],
  providers: [
    RewardProgramsRepository,
    RewardProgramsService,
    RewardProgressRepository,
    RewardProgressService,
    RewardEligibilityService,
    RewardRedemptionsRepository,
    RewardRedemptionService,
  ],
  exports: [RewardProgramsService, RewardRedemptionService, RewardProgressRepository, RewardProgramsRepository, RewardEligibilityService],
})
export class RewardsModule {}
