import { Module } from '@nestjs/common';
import { BranchModule } from '../branches/branch.module';
import { CatalogModule } from '../catalog/catalog.module';
import { CustomerMetricsModule } from '../customer-metrics/customer-metrics.module';
import { CustomersModule } from '../customers/customers.module';
import { LoyaltyModule } from '../loyalty/loyalty.module';
import { Loyalty2Module } from '../loyalty2/loyalty2.module';
import { PosterModule } from '../poster/poster.module';
import { PosterImportModule } from '../poster-import/poster-import.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { RewardsModule } from '../rewards/reward-programs.module';
import { StaffModule } from '../staff/staff.module';
import { PosWidgetAuditService } from './pos-widget-audit.service';
import { PosWidgetAuthService } from './pos-widget-auth.service';
import { PosWidgetOverviewService } from './pos-widget-overview.service';
import { PosWidgetPromotionRedemptionRepository } from './pos-widget-promotion-redemption.repository';
import { PosWidgetPromotionRedemptionService } from './pos-widget-promotion-redemption.service';
import { PosWidgetRewardRedemptionRepository } from './pos-widget-reward-redemption.repository';
import { PosWidgetRewardRedemptionService } from './pos-widget-reward-redemption.service';
import { PosterPromotionMutationService } from './poster-promotion-mutation.service';
import { PosterRewardMutationService } from './poster-reward-mutation.service';
import { PosPromotionRedemptionGuard, PosRewardRedemptionGuard, PosWidgetController, PosWidgetGuard } from './pos-widget.controller';

// Phase 21 — the Poster POS widget backend. Composes existing READ services only (customers, loyalty, Loyalty 2.0, rewards, promotions, customer metrics, imported
// POS activity, the catalog) and reuses staff_scan_events for the audit.
// Ships OFF (POS_WIDGET_ENABLED).
//
// Phase 22 adds ONE write path: POST /pos-widget/rewards/redeem, gated by its own operator interlock (POS_REWARD_REDEMPTION_ENABLED) on top of the same
// signature guard. It composes RewardsModule's existing eligibility/redemption logic (no second reward engine) and PosterRewardMutationService.
//
// Phase 21 deliberately imported NO Poster-facing module ("PosterService is never used" — see the git history of this comment). That boundary is
// intentionally crossed here, now that PosterRewardMutationService has a real, verified-safe mutation to make (docs/PHASE-22-AUDIT.md §15):
// PosterModule is imported ONLY for PosterRewardMutationService's use (two read calls + one write call, all logged), never by the read-only overview
// path, which still composes nothing but the existing read services above.
//
// Phase 23 adds a SECOND write path: POST /pos-widget/promotions/redeem, gated by its own independent operator interlock (POS_PROMOTION_REDEMPTION_ENABLED).
// Composes PromotionsModule's existing eligibility/redemption logic (no second promotion engine) and PosterPromotionMutationService — reward and
// promotion redemption remain separate concepts throughout (separate attempt tables, separate flags, separate audit actions, separate per-order rules).
@Module({
  imports: [CustomersModule, LoyaltyModule, Loyalty2Module, RewardsModule, PromotionsModule, CustomerMetricsModule, PosterImportModule, CatalogModule, BranchModule, StaffModule, PosterModule],
  controllers: [PosWidgetController],
  providers: [
    PosWidgetAuthService,
    PosWidgetOverviewService,
    PosWidgetAuditService,
    PosWidgetGuard,
    PosWidgetRewardRedemptionRepository,
    PosWidgetRewardRedemptionService,
    PosterRewardMutationService,
    PosRewardRedemptionGuard,
    PosWidgetPromotionRedemptionRepository,
    PosWidgetPromotionRedemptionService,
    PosterPromotionMutationService,
    PosPromotionRedemptionGuard,
  ],
})
export class PosWidgetModule {}
