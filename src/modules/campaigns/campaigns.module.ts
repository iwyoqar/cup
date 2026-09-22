import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { SegmentsModule } from '../segments/segments.module';
import { TelegramAccountsModule } from '../telegram-accounts/telegram-accounts.module';
import { TelegramModule } from '../telegram/telegram.module';
import { CampaignAudienceRepository } from './campaign-audience.repository';
import { CampaignAudienceService } from './campaign-audience.service';
import { CampaignMessagingService } from './campaign-messaging.service';
import { CampaignRecipientsRepository } from './campaign-recipients.repository';
import { CampaignsController } from './campaigns.controller';
import { CampaignsRepository } from './campaigns.repository';
import { CampaignsService } from './campaigns.service';

// SegmentsModule (exports SegmentsService — the ONE canonical segment evaluator, never
// duplicated here) and TelegramModule (exports TelegramMessagingService, built on the existing
// bot instance — never a second grammY Bot) give CampaignsService everything it needs without
// this module ever touching Prisma models those modules already own. TelegramAccountsModule is
// imported directly for the same reason LoyaltyModule/CustomerMetricsModule are imported
// directly by SegmentsModule: CampaignAudienceService needs TelegramAccountsRepository's bulk
// lookup, not anything TelegramModule itself re-exports. No cycle: none of these modules imports
// CampaignsModule.
@Module({
  imports: [AdminAuthModule, SegmentsModule, TelegramModule, TelegramAccountsModule],
  controllers: [CampaignsController],
  providers: [
    CampaignsRepository,
    CampaignsService,
    CampaignAudienceRepository,
    CampaignAudienceService,
    CampaignRecipientsRepository,
    CampaignMessagingService,
  ],
  // Phase 13: CRM automation reuses the campaign message + the campaign send policy (never a second messaging implementation).
  exports: [CampaignsService, CampaignMessagingService],
})
export class CampaignsModule {}
