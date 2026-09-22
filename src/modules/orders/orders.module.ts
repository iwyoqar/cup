import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CatalogModule } from '../catalog/catalog.module';
import { CustomersModule } from '../customers/customers.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PosterModule } from '../poster/poster.module';
import { RewardsModule } from '../rewards/reward-programs.module';
import { IdempotencyRepository } from './idempotency.repository';
import { OrderStatusPollJob } from './order-status-poll.job';
import { OrderStatusSyncService } from './order-status-sync.service';
import { OrdersController } from './orders.controller';
import { OrdersRepository } from './orders.repository';
import { OrdersService } from './orders.service';

// AuthModule imported only for AuthGuard, used on GET /orders/:id (Phase 1.5 ownership fix).
// NotificationsModule added in Phase 1.9 for OrderStatusSyncService's Telegram notifications —
// no cycle: NotificationsModule -> TelegramModule/TelegramAccountsModule, neither of which
// imports OrdersModule. RewardsModule added in Phase 8 for OrdersService's
// RewardRedemptionService dependency — no cycle: RewardsModule only imports
// AdminAuthModule/CatalogModule.
@Module({
  imports: [PosterModule, CatalogModule, CustomersModule, AuthModule, NotificationsModule, RewardsModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrdersRepository, IdempotencyRepository, OrderStatusSyncService, OrderStatusPollJob],
  exports: [OrdersService],
})
export class OrdersModule {}
