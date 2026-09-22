import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { ConfigService } from '../../common/config/config.service';
import { CatalogService } from './catalog.service';

// Secondary, low-frequency sync (POST /catalog/sync is the primary path for local testing —
// see docs/PHASE-0-PLAN.md section 7). Registered dynamically so the interval can come from
// config rather than a compile-time decorator constant.
@Injectable()
export class CatalogSyncJob implements OnModuleInit {
  private readonly logger = new Logger(CatalogSyncJob.name);

  constructor(
    private readonly catalogService: CatalogService,
    private readonly config: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    const interval = setInterval(() => {
      this.catalogService.sync().catch((err) => {
        this.logger.error(`Catalog sync tick failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }, this.config.env.CATALOG_SYNC_INTERVAL_MS);
    interval.unref?.();
    this.schedulerRegistry.addInterval('catalog-sync', interval);
  }
}
