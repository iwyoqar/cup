import { Injectable, Logger } from '@nestjs/common';
import { OrderStatus } from '../../common/enums/order-status';
import { getOrderStatusLabel, isNotifiableStatusTransition } from '../orders/order-status-presentation';
import { OrderStatusTransition } from '../orders/orders.service';
import { TelegramAccountsRepository } from '../telegram-accounts/telegram-accounts.repository';
import { TelegramBotService } from '../telegram/telegram-bot.service';
import { OrderNotificationRepository } from './order-notification.repository';

// Bounded retry (spec section 34): after this many caught send failures for the same
// (orderId, orderStatus) transition, the notification is left 'failed' permanently — the order
// itself is completely unaffected either way (spec section 14). Not exposed as an env var per
// spec section 29 ("do not create unnecessary configuration variables") — this is an internal
// implementation constant, not operational tuning anyone needs to change per environment.
const MAX_NOTIFICATION_ATTEMPTS = 3;

interface RetryCandidate {
  orderId: string;
  orderStatus: string;
  order: { customerId: string; branch: { name: string } | null };
}

// Owns the full notify-once-per-transition lifecycle: claim (DB-unique, the real concurrency
// guard — see order-notification.repository.ts) -> resolve recipient -> send via the existing
// TelegramBotService -> record the outcome. Never touches Order.status itself (spec section 14:
// notification delivery and order state are strictly separate concerns) and never constructs
// its own grammY Bot (spec section 30).
//
// Known tradeoff (spec section 8, stated explicitly rather than hidden): the status persist
// (OrdersService.refreshStatus) and this claim insert are two separate database writes, not one
// shared transaction — a crash in the narrow window between them would silently skip that one
// transition's notification forever (the status won't be observed as "changed" again). This
// project accepts that rare, non-catastrophic gap in exchange for not coupling OrdersService to
// the notifications schema. See also the schema.prisma comment on why a 'pending' row is never
// auto-retried: this design deliberately favors "maybe miss one notification" over "maybe send
// a duplicate."
@Injectable()
export class OrderNotificationService {
  private readonly logger = new Logger(OrderNotificationService.name);

  constructor(
    private readonly repository: OrderNotificationRepository,
    private readonly telegramAccountsRepository: TelegramAccountsRepository,
    private readonly telegramBotService: TelegramBotService,
  ) {}

  async notifyStatusChange(transition: OrderStatusTransition): Promise<void> {
    if (!isNotifiableStatusTransition(transition.newStatus)) {
      // Spec section 24: the pre-acceptance states aren't a "change" worth telling the
      // customer about — checkout's own HTTP response already told the Mini App the order was
      // placed, and no separate order-created Telegram message exists yet to duplicate anyway.
      return;
    }

    const claimed = await this.repository.claim(transition.orderId, transition.newStatus);
    if (!claimed) {
      // Someone else (a concurrent poll tick, or — in a future multi-instance deployment —
      // another process) already claimed this exact transition. Nothing more to do here.
      return;
    }

    await this.deliver({
      orderId: transition.orderId,
      orderStatus: transition.newStatus,
      customerId: transition.customerId,
      branchName: transition.branchName,
    });
  }

  // Spec sections 8/34: re-attempts ONLY caught send failures (deliveryState 'failed'), never
  // 'pending' rows — see order-notification.repository.ts's findRetryableWithOrder for why.
  // Runs on the same 30s scheduled tick as the main sync (OrderStatusSyncService) rather than a
  // second timer, per spec section 10's "do not create a separate process."
  async retryFailedNotifications(): Promise<void> {
    const candidates = await this.repository.findRetryableWithOrder(MAX_NOTIFICATION_ATTEMPTS);
    for (const candidate of candidates as RetryCandidate[]) {
      await this.deliver({
        orderId: candidate.orderId,
        orderStatus: candidate.orderStatus as OrderStatus,
        customerId: candidate.order.customerId,
        branchName: candidate.order.branch?.name ?? null,
      });
    }
  }

  private async deliver(input: {
    orderId: string;
    orderStatus: OrderStatus;
    customerId: string;
    branchName: string | null;
  }): Promise<void> {
    const account = await this.telegramAccountsRepository.findByCustomerId(input.customerId);
    if (!account) {
      // Spec section 17: no TelegramAccount is not an error — the order continues normally,
      // there is simply nowhere to send a message. The claimed row stays 'pending' forever in
      // this case, which is harmless (nothing else reads a stuck 'pending' row).
      this.logger.warn(
        `No TelegramAccount for customer (order=${input.orderId}) — skipping status notification.`,
      );
      return;
    }

    const message = this.buildMessage(input.orderId, input.orderStatus, input.branchName);
    try {
      await this.telegramBotService.sendOrderStatusNotification(account.chatId, message);
      await this.repository.markSent(input.orderId, input.orderStatus);
      this.logger.log(`Sent status notification: order=${input.orderId}, status=${input.orderStatus}`);
    } catch (err) {
      // Spec section 18: a blocked bot or any other permanent send error must never affect the
      // order itself, and must never retry forever — markFailed() only increments a bounded
      // counter (see MAX_NOTIFICATION_ATTEMPTS). Never logs the raw error object (could
      // stringify Telegram API detail); only its message.
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to send status notification: order=${input.orderId}, status=${input.orderStatus}: ${reason}`);
      await this.repository.markFailed(input.orderId, input.orderStatus);
    }
  }

  private buildMessage(orderId: string, status: OrderStatus, branchName: string | null): string {
    const lines = ['☕ CUP Coffee', '', `Buyurtma #${orderId} holati yangilandi.`, '', `Holat: ${getOrderStatusLabel(status)}`];
    if (branchName) {
      lines.push('', `Filial: ${branchName}`);
    }
    return lines.join('\n');
  }
}
