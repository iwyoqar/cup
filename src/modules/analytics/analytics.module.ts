import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsRepository } from './analytics.repository';
import { AnalyticsService } from './analytics.service';

@Module({
  imports: [AdminAuthModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsRepository, AnalyticsService],
  // Phase 18: Branch Intelligence reuses Analytics V1's service (branch parity) and its product / daily queries — one definition of a sale.
  exports: [AnalyticsRepository, AnalyticsService],
})
export class AnalyticsModule {}
