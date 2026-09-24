import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { ConfigService } from '../../common/config/config.service';
import { FinanceCogsSyncService } from './finance-cogs-sync.service';

// Mirrors catalog-sync.job.ts's dynamic-interval-from-config pattern exactly.
@Injectable()
export class FinanceCogsSyncJob implements OnModuleInit {
  private readonly logger = new Logger(FinanceCogsSyncJob.name);

  constructor(
    private readonly cogsSyncService: FinanceCogsSyncService,
    private readonly config: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    const interval = setInterval(() => {
      this.cogsSyncService.sync().catch((err) => {
        this.logger.error(`COGS sync tick failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }, this.config.env.FINANCE_COGS_SYNC_INTERVAL_MS);
    interval.unref?.();
    this.schedulerRegistry.addInterval('finance-cogs-sync', interval);
  }
}
