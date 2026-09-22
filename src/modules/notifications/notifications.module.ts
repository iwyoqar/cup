import { Module } from '@nestjs/common';
import { TelegramAccountsModule } from '../telegram-accounts/telegram-accounts.module';
import { TelegramModule } from '../telegram/telegram.module';
import { OrderNotificationRepository } from './order-notification.repository';
import { OrderNotificationService } from './order-notification.service';

// Deliberately depends on TelegramModule/TelegramAccountsModule ONLY — never on OrdersModule.
// OrderStatusTransition data is passed in by the caller (OrderStatusSyncService, which lives in
// OrdersModule and imports this module instead), so this module never needs to know about
// OrdersRepository/CatalogModule/etc. That keeps the dependency direction one-way
// (OrdersModule -> NotificationsModule) with no risk of the cycle spec section 31 warns about.
@Module({
  imports: [TelegramModule, TelegramAccountsModule],
  providers: [OrderNotificationRepository, OrderNotificationService],
  exports: [OrderNotificationService],
})
export class NotificationsModule {}
