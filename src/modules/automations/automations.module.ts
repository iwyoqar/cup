import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { CatalogModule } from '../catalog/catalog.module';
import { CustomerMetricsModule } from '../customer-metrics/customer-metrics.module';
import { LoyaltyModule } from '../loyalty/loyalty.module';
import { Loyalty2Module } from '../loyalty2/loyalty2.module';
import { RewardsModule } from '../rewards/reward-programs.module';
import { SegmentsModule } from '../segments/segments.module';
import { SettingsModule } from '../settings/settings.module';
import { AutomationEligibilityService } from './automation-eligibility.service';
import { AutomationEventsService } from './automation-events.service';
import { AutomationExecutionService } from './automation-execution.service';
import { AutomationMessageService } from './automation-message.service';
import { AutomationPreviewService } from './automation-preview.service';
import { AutomationRunnerService } from './automation-runner.service';
import { AutomationSettingsService } from './automation-settings.service';
import { AutomationTriggerService } from './automation-trigger.service';
import { AutomationsController } from './automations.controller';
import { AutomationsRepository } from './automations.repository';
import { AutomationsService } from './automations.service';

// CRM automation sits ABOVE the existing engines and reuses them: Campaigns (message, channel, status rules, send policy), Segments (membership),
// Rewards / Loyalty / Loyalty 2.0 / Customer Metrics (values, thresholds), Settings (configuration). No cycle: none of those imports this module
// (AdminCustomersModule imports it for the Customer 360 activity block).
@Module({
  imports: [AdminAuthModule, CampaignsModule, CatalogModule, CustomerMetricsModule, LoyaltyModule, Loyalty2Module, RewardsModule, SegmentsModule, SettingsModule],
  controllers: [AutomationsController],
  providers: [
    AutomationsRepository,
    AutomationSettingsService,
    AutomationEventsService,
    AutomationTriggerService,
    AutomationEligibilityService,
    AutomationMessageService,
    AutomationExecutionService,
    AutomationRunnerService,
    AutomationPreviewService,
    AutomationsService,
  ],
  exports: [AutomationsService, AutomationRunnerService, AutomationSettingsService],
})
export class AutomationsModule {}
