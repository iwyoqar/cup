import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { ConfigService } from '../../common/config/config.service';
import { Loyalty2SyncService } from './loyalty2-sync.service';

const BATCH = 25;

// In-process scheduling only (same mechanism as the order-status poll / catalog sync jobs): it decides WHEN to run
// Loyalty2SyncService.syncPending. Does nothing at all while Loyalty 2.0 is switched off in Admin, never overlaps itself, and a
// failure only logs.
@Injectable()
export class Loyalty2SyncJob implements OnModuleInit {
  private readonly logger = new Logger(Loyalty2SyncJob.name);
  private running = false;

  constructor(
    private readonly sync: Loyalty2SyncService,
    private readonly config: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    const interval = setInterval(() => {
      if (this.running) return;
      this.running = true;
      this.sync
        .syncPending(BATCH)
        .catch((err) => this.logger.error(`Loyalty 2.0 sync tick failed: ${err instanceof Error ? err.message : String(err)}`))
        .finally(() => {
          this.running = false;
        });
    }, this.config.env.LOYALTY2_SYNC_INTERVAL_MS);
    interval.unref?.();
    this.schedulerRegistry.addInterval('loyalty2-sync', interval);
  }
}
