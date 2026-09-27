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
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { PosWidgetSubscriptionService } from './pos-widget-subscription.service';
import { PosWidgetAuditService } from './pos-widget-audit.service';
import { PosWidgetAuthService } from './pos-widget-auth.service';
import { PosWidgetOverviewService } from './pos-widget-overview.service';
import { PosWidgetPromotionRedemptionRepository } from './pos-widget-promotion-redemption.repository';
import { PosWidgetPromotionRedemptionService } from './pos-widget-promotion-redemption.service';
import { PosWidgetRewardRedemptionRepository } from './pos-widget-reward-redemption.repository';
import { PosWidgetRewardRedemptionService } from './pos-widget-reward-redemption.service';
import { PosterOrderMutationService } from './poster-order-mutation.service';
import { PosterPromotionMutationService } from './poster-promotion-mutation.service';
import { PosterRewardMutationService } from './poster-reward-mutation.service';
import { PosPromotionRedemptionGuard, PosRewardRedemptionGuard, PosSubscriptionCashSaleGuard, PosSubscriptionPosterPurchaseGuard, PosSubscriptionRedemptionGuard, PosWidgetController, PosWidgetGuard } from './pos-widget.controller';

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
//
// Coffee Subscription adds a THIRD write path: POST /pos-widget/subscriptions/purchase-cash, gated by its own independent interlock
// (POS_SUBSCRIPTION_CASH_SALE_ENABLED). Unlike every write path above, this one makes NO Poster mutation at all — it composes only
// SubscriptionsService's existing purchase/activation methods (no second payment system); see pos-widget-subscription.service.ts#purchaseCash.
//
// Coffee Subscription adds a FOURTH write path: POST /pos-widget/subscriptions/purchase-poster-order (+ its .../check-payment companion),
// gated by its own independent interlock (POS_SUBSCRIPTION_POSTER_PURCHASE_ENABLED). This one DOES mutate Poster — a real, non-zero-price
// addTransactionProduct call via the new PosterOrderMutationService (poster-order-mutation.service.ts), never live-verified unlike the
// price-0 mechanism reward/promotion/redemption share.
@Module({
  imports: [CustomersModule, LoyaltyModule, Loyalty2Module, RewardsModule, PromotionsModule, CustomerMetricsModule, PosterImportModule, CatalogModule, BranchModule, StaffModule, PosterModule, SubscriptionsModule],
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
    // Coffee Subscription: summary (read-only) + redemption behind POS_SUBSCRIPTION_REDEMPTION_ENABLED, reusing PosterRewardMutationService.
    // + cash sale behind its own independent POS_SUBSCRIPTION_CASH_SALE_ENABLED (no Poster mutation at all — see purchaseCash).
    // + real Poster order purchase behind POS_SUBSCRIPTION_POSTER_PURCHASE_ENABLED, reusing PosterOrderMutationService.
    PosWidgetSubscriptionService,
    PosSubscriptionRedemptionGuard,
    PosSubscriptionCashSaleGuard,
    PosterOrderMutationService,
    PosSubscriptionPosterPurchaseGuard,
  ],
})
export class PosWidgetModule {}
