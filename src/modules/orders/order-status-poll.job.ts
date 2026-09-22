import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { ConfigService } from '../../common/config/config.service';
import { OrderStatusSyncService } from './order-status-sync.service';

// In-process polling (no Redis/BullMQ in Phase 0 — see docs/PHASE-0-PLAN.md). Single-instance
// only: running more than one backend process would poll the same orders redundantly. That is
// an accepted, documented limitation for Phase 0, to be revisited when Redis is introduced —
// see order-notification.repository.ts for why the notification claim itself stays safe even
// if that changes (Phase 1.9).
//
// Purely the scheduling mechanism now — the actual per-tick work (status sync + notification)
// lives in OrderStatusSyncService, so this class has exactly one job: decide WHEN to run it.
@Injectable()
export class OrderStatusPollJob implements OnModuleInit {
  private readonly logger = new Logger(OrderStatusPollJob.name);

  constructor(
    private readonly orderStatusSyncService: OrderStatusSyncService,
    private readonly config: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    const interval = setInterval(() => {
      this.orderStatusSyncService.syncPollableOrders().catch((err) => {
        this.logger.error(`Order status poll tick failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }, this.config.env.ORDER_STATUS_POLL_INTERVAL_MS);
    interval.unref?.();
    this.schedulerRegistry.addInterval('order-status-poll', interval);
  }
}
