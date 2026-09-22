import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AuthModule } from '../auth/auth.module';
import { CustomersModule } from '../customers/customers.module';
import { LoyaltyModule } from '../loyalty/loyalty.module';
import { Loyalty2Module } from '../loyalty2/loyalty2.module';
import { SettingsModule } from '../settings/settings.module';
import { AdminReferralsController } from './admin-referrals.controller';
import { ReferralAttributionService } from './referral-attribution.service';
import { ReferralBotIdentityService } from './referral-bot-identity.service';
import { ReferralEventsService } from './referral-events.service';
import { ReferralQualificationService } from './referral-qualification.service';
import { ReferralRewardService } from './referral-reward.service';
import { ReferralRunnerService } from './referral-runner.service';
import { ReferralSettingsService } from './referral-settings.service';
import { ReferralsController } from './referrals.controller';
import { ReferralsRepository } from './referrals.repository';
import { ReferralsService } from './referrals.service';

// Referrals reuse the existing engines instead of duplicating them: points go through LoyaltyService (the existing ledger), purchases come from the
// ONE canonical qualifying-purchase definition in Loyalty2Repository (CUP orders + imported POS), configuration lives in the Settings store.
// This module deliberately does NOT import TelegramModule (TelegramModule imports THIS module for /start attribution and pushes the bot username
// into ReferralBotIdentityService), so there is no cycle. AuthModule + CustomersModule are imported for the customer AuthGuard's dependencies and
// AdminAuthModule for AdminAuthGuard (same as Loyalty2Module).
@Module({
  imports: [AuthModule, AdminAuthModule, CustomersModule, SettingsModule, LoyaltyModule, Loyalty2Module],
  controllers: [ReferralsController, AdminReferralsController],
  providers: [
    ReferralsRepository,
    ReferralSettingsService,
    ReferralBotIdentityService,
    ReferralAttributionService,
    ReferralRewardService,
    ReferralQualificationService,
    ReferralEventsService,
    ReferralRunnerService,
    ReferralsService,
  ],
  exports: [ReferralAttributionService, ReferralBotIdentityService, ReferralsService, ReferralEventsService, ReferralRunnerService, ReferralSettingsService],
})
export class ReferralsModule {}
