import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AuthModule } from '../auth/auth.module';
import { CatalogModule } from '../catalog/catalog.module';
import { CustomersModule } from '../customers/customers.module';
import { LoyaltyModule } from '../loyalty/loyalty.module';
import { RewardsModule } from '../rewards/reward-programs.module';
import { SettingsModule } from '../settings/settings.module';
import { AdminLoyalty2Controller } from './admin-loyalty2.controller';
import { Loyalty2AchievementsService } from './loyalty2-achievements.service';
import { Loyalty2BirthdayService } from './loyalty2-birthday.service';
import { Loyalty2DefaultsService } from './loyalty2-defaults.service';
import { Loyalty2HistoryService } from './loyalty2-history.service';
import { Loyalty2LevelsService } from './loyalty2-levels.service';
import { Loyalty2ProfileService } from './loyalty2-profile.service';
import { Loyalty2ProgressService } from './loyalty2-progress.service';
import { Loyalty2SettingsService } from './loyalty2-settings.service';
import { Loyalty2SyncJob } from './loyalty2-sync.job';
import { Loyalty2SyncService } from './loyalty2-sync.service';
import { Loyalty2Controller } from './loyalty2.controller';
import { Loyalty2Repository } from './loyalty2.repository';

// Loyalty 2.0 is layered ON TOP of the existing loyalty / reward / promotion engines and preserves them: points still go
// through LoyaltyService, reward progress through RewardProgressRepository, purchases are the Phase 5 / Analytics V1 definition.
// AuthModule + CustomersModule are imported for the customer AuthGuard's own dependencies (same lesson as LoyaltyModule) and
// AdminAuthModule for AdminAuthGuard. No cycle: none of these imports Loyalty2Module (AdminCustomersModule imports it).
@Module({
  imports: [AuthModule, AdminAuthModule, CustomersModule, SettingsModule, LoyaltyModule, RewardsModule, CatalogModule],
  controllers: [Loyalty2Controller, AdminLoyalty2Controller],
  providers: [
    Loyalty2Repository,
    Loyalty2SettingsService,
    Loyalty2LevelsService,
    Loyalty2ProgressService,
    Loyalty2ProfileService,
    Loyalty2SyncService,
    Loyalty2HistoryService,
    Loyalty2BirthdayService,
    Loyalty2AchievementsService,
    Loyalty2DefaultsService,
    Loyalty2SyncJob,
  ],
  exports: [Loyalty2ProfileService, Loyalty2SyncService, Loyalty2BirthdayService, Loyalty2SettingsService, Loyalty2Repository, Loyalty2LevelsService],
})
export class Loyalty2Module {}
