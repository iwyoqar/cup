import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { BranchModule } from '../branches/branch.module';
import { CustomerMetricsModule } from '../customer-metrics/customer-metrics.module';
import { GrowthIntelligenceModule } from '../growth-intelligence/growth-intelligence.module';
import { LoyaltyModule } from '../loyalty/loyalty.module';
import { SegmentsController } from './segments.controller';
import { SegmentsRepository } from './segments.repository';
import { SegmentsService } from './segments.service';

// CustomerMetricsModule (order-derived metrics) and LoyaltyModule (read-only loyalty snapshot)
// give SegmentsService the ONE canonical set of customer metrics — never a second, competing
// calculation. BranchModule is reused for favoriteBranch condition validation (does a named
// branch actually exist). No cycle: none of these modules imports SegmentsModule.
//
// Phase 6: exports SegmentsService so CampaignsModule can resolve a campaign's audience through
// this exact same segment evaluator (never a second, competing implementation) without
// depending on SegmentsRepository or any of SegmentsModule's own internals.
@Module({
  imports: [AdminAuthModule, CustomerMetricsModule, LoyaltyModule, BranchModule, GrowthIntelligenceModule],
  controllers: [SegmentsController],
  providers: [SegmentsRepository, SegmentsService],
  exports: [SegmentsService],
})
export class SegmentsModule {}
