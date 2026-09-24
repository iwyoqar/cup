import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { BranchIntelligenceModule } from '../branch-intelligence/branch-intelligence.module';
import { PosterModule } from '../poster/poster.module';
import { PosterReportsService } from './poster-reports.service';
import { ReportsController } from './reports.controller';
import { ReportsLocationsService } from './reports-locations.service';
import { ReportsService } from './reports.service';

// Reports Phase A/B1 — composes AnalyticsModule's exported AnalyticsService/AnalyticsRepository (the canonical
// CUP+POS revenue source) and BranchIntelligenceModule's exported service/repository (the canonical branch
// attribution); introduces no new revenue calculation, no new branch-attribution logic and no new schema.
// PosterModule is read-only here (dash.getSpotsSales), never mutated.
@Module({
  imports: [AdminAuthModule, AnalyticsModule, BranchIntelligenceModule, PosterModule],
  controllers: [ReportsController],
  providers: [ReportsService, ReportsLocationsService, PosterReportsService],
})
export class ReportsModule {}
