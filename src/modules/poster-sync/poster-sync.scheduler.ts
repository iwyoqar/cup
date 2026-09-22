import { Injectable, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { ConfigService } from '../../common/config/config.service';
import { PosterReconcileService } from './poster-reconcile.service';
import { PosterSyncProcessorService } from './poster-sync-processor.service';

// In-process scheduling only (the same mechanism as the other CUP jobs): it decides WHEN to run. The processor tick drains the durable queue; the
// reconciliation pass runs on its own slower cadence. Both are complete no-ops while POSTER_SYNC_ENABLED is off. A short delay after start runs one tick and
// one reconciliation, so events queued while CUP was down and receipts missed during the outage are handled without waiting a full interval.
@Injectable()
export class PosterSyncScheduler implements OnModuleInit {
  constructor(
    private readonly processor: PosterSyncProcessorService,
    private readonly reconcile: PosterReconcileService,
    private readonly config: ConfigService,
    private readonly registry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    const tick = setInterval(() => void this.processor.tick(), this.config.env.POSTER_SYNC_TICK_MS);
    tick.unref?.();
    this.registry.addInterval('poster-sync-tick', tick);

    const reconcile = setInterval(() => void this.reconcile.run(), this.config.env.POSTER_RECONCILE_INTERVAL_MS);
    reconcile.unref?.();
    this.registry.addInterval('poster-sync-reconcile', reconcile);

    if (this.config.env.POSTER_SYNC_ENABLED) {
      const boot = setTimeout(() => {
        void this.processor.tick().then(() => this.reconcile.run());
      }, 10_000);
      boot.unref?.();
    }
  }
}
