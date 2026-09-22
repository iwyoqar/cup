import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { GrowthIntelligenceModule } from '../growth-intelligence/growth-intelligence.module';
import { RewardsModule } from '../rewards/reward-programs.module';
import { BranchIntelligenceController } from './branch-intelligence.controller';
import { BranchIntelligenceRepository } from './branch-intelligence.repository';
import { BranchIntelligenceService } from './branch-intelligence.service';

// Branch Intelligence READS: it owns no table, sends nothing and calls no external service. Reused, never re-implemented: Analytics V1 (period rules, item
// aggregates, parity), Growth Intelligence (lifecycle / RFM / signals / opportunities, branch-scoped), Rewards (reward availability). No cycle: none of those
// imports this module.
@Module({
  imports: [AdminAuthModule, AnalyticsModule, GrowthIntelligenceModule, RewardsModule],
  controllers: [BranchIntelligenceController],
  providers: [BranchIntelligenceRepository, BranchIntelligenceService],
})
export class BranchIntelligenceModule {}
