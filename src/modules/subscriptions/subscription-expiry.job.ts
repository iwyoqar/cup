import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { ConfigService } from '../../common/config/config.service';
import { SubscriptionsService } from './subscriptions.service';

// Housekeeping: flips ACTIVE -> EXPIRED once a subscription's period is over (same dynamic-interval pattern as finance-cogs-sync.job.ts).
// Correctness never depends on it — every usability check compares the dates itself.
@Injectable()
export class SubscriptionExpiryJob implements OnModuleInit {
  private readonly logger = new Logger(SubscriptionExpiryJob.name);

  constructor(
    private readonly subscriptions: SubscriptionsService,
    private readonly config: ConfigService,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    const interval = setInterval(() => {
      this.subscriptions.expireDue().catch((err) => this.logger.error(`Subscription expiry tick failed: ${err instanceof Error ? err.message : String(err)}`));
    }, this.config.env.SUBSCRIPTION_EXPIRY_INTERVAL_MS);
    interval.unref?.();
    this.scheduler.addInterval('subscription-expiry', interval);
  }
}
