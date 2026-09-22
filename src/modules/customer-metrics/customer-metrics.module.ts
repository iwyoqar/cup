import { Module } from '@nestjs/common';
import { CustomerMetricsRepository } from './customer-metrics.repository';
import { CustomerMetricsService } from './customer-metrics.service';

// Shared, self-contained (only needs the global PrismaModule) — imported by both
// AdminCustomersModule (Customer 360) and SegmentsModule (segment matching), never the other
// way around. No cycle.
@Module({
  providers: [CustomerMetricsRepository, CustomerMetricsService],
  exports: [CustomerMetricsService],
})
export class CustomerMetricsModule {}
