import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { Loyalty2Module } from '../loyalty2/loyalty2.module';
import { ReferralsModule } from '../referrals/referrals.module';
import { RewardsModule } from '../rewards/reward-programs.module';
import { SettingsModule } from '../settings/settings.module';
import { GrowthIntelligenceController } from './growth-intelligence.controller';
import { GrowthIntelligenceRepository } from './growth-intelligence.repository';
import { GrowthIntelligenceService } from './growth-intelligence.service';
import { GrowthSettingsService } from './growth-settings.service';

// Growth Intelligence READS the canonical data and the existing engines' configuration; it owns no table and sends nothing. Reused: Rewards (bulk
// reward availability through RewardProgressService), Loyalty 2.0 (levels + on/off), Referrals (program state + success counts), Settings, Analytics'
// business-day arithmetic. No cycle: none of those imports this module (Segments, AdminCustomers import it).
@Module({
  imports: [AdminAuthModule, SettingsModule, RewardsModule, Loyalty2Module, ReferralsModule],
  controllers: [GrowthIntelligenceController],
  providers: [GrowthIntelligenceRepository, GrowthSettingsService, GrowthIntelligenceService],
  exports: [GrowthIntelligenceService, GrowthSettingsService],
})
export class GrowthIntelligenceModule {}
