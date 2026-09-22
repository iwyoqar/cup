import { Injectable, Logger } from '@nestjs/common';
import { OrderNotificationService } from '../notifications/order-notification.service';
import { OrdersService } from './orders.service';

// The orchestration layer between "when to check" (OrderStatusPollJob's timer) and the two
// things that actually need to happen per tick: sync CUP's Order.status from Poster (delegated
// entirely to OrdersService.refreshStatus — no Poster-calling or status-mapping logic is
// duplicated here), and notify the customer when that sync reveals a meaningful transition
// (delegated to OrderNotificationService). Neither Poster failures nor Telegram failures for
// one order are allowed to stop the rest of the batch (spec sections 13/14).
@Injectable()
export class OrderStatusSyncService {
  private readonly logger = new Logger(OrderStatusSyncService.name);

  constructor(
    private readonly ordersService: OrdersService,
    private readonly orderNotificationService: OrderNotificationService,
  ) {}

  async syncPollableOrders(): Promise<void> {
    const orders = await this.ordersService.findPollableOrders();
    for (const order of orders) {
      await this.syncOne(order.id);
    }
    // Bounded retry for previously-failed sends, on this same tick rather than a second timer
    // (spec section 10).
    await this.orderNotificationService.retryFailedNotifications().catch((err) => {
      this.logger.error(`Notification retry pass failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  private async syncOne(orderId: string): Promise<void> {
    try {
      const transition = await this.ordersService.refreshStatus(orderId);
      if (!transition) {
        return;
      }
      await this.orderNotificationService.notifyStatusChange(transition).catch((err) => {
        this.logger.error(
          `Failed to notify status change for order ${transition.orderId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
      // Phase 3 Part 8 — deliberately NOT wired up: this is where automatic loyalty purchase-
      // earning would be triggered (e.g. `if (transition.newStatus === 'completed') await
      // this.loyaltyService.earnPointsForOrder(...)`), but the currently verified Poster/CUP
      // order lifecycle has no reliable "completed/paid" boundary — only pending ->
      // sent_to_poster -> accepted is real; 'completed' is a declared-but-never-reached CUP
      // status (see common/enums/order-status.ts). Awarding points on 'accepted' would risk
      // paying out for an order later cancelled/refunded at the POS. See
      // src/modules/loyalty/loyalty.service.ts's file-level comment for the full reasoning.
    } catch (err) {
      // Spec section 13: a Poster failure for one order never marks it failed and never stops
      // the rest of the batch — just logged, retried on the next scheduled tick.
      this.logger.error(`Failed to sync order ${orderId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
