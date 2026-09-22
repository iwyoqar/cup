import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AuthModule } from '../auth/auth.module';
import { CustomersModule } from '../customers/customers.module';
import { RewardsModule } from '../rewards/reward-programs.module';
import { SettingsModule } from '../settings/settings.module';
import { AdminLoyaltySettingsController } from './admin-loyalty-settings.controller';
import { LoyaltyController } from './loyalty.controller';
import { LoyaltyRepository } from './loyalty.repository';
import { LoyaltyService } from './loyalty.service';
import { LoyaltySettingsService } from './loyalty-settings.service';

// AuthModule (customer AuthGuard) and AdminAuthModule (AdminAuthGuard) both imported — this
// module serves both a customer-facing controller and an admin-facing one, each guarded by its
// own, completely separate auth mechanism (Part 1/2/15). No cycle: neither AuthModule nor
// AdminAuthModule imports LoyaltyModule.
//
// CustomersModule is imported directly too — the same CartModule lesson from Phase 1.6: Nest
// resolves a guard-by-class-reference's OWN constructor dependencies (AuthGuard needs
// SessionService + CustomersRepository) against the REQUESTING module's import graph, not just
// the module that exported the guard class. AuthModule never re-exports CustomersRepository
// (only privately consumes it), so without this, boot fails with "can't resolve dependencies of
// AuthGuard ... in the LoyaltyModule context" — a runtime DI-graph error invisible to
// tsc/build, only caught by actually starting the app.
@Module({
  imports: [AuthModule, AdminAuthModule, SettingsModule, CustomersModule, RewardsModule],
  controllers: [LoyaltyController, AdminLoyaltySettingsController],
  providers: [LoyaltyRepository, LoyaltyService, LoyaltySettingsService],
  exports: [LoyaltyService, LoyaltySettingsService],
})
export class LoyaltyModule {}
