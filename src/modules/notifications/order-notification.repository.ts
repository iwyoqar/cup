import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { isUniqueConstraintViolation } from '../../common/util/prisma-errors';

type DeliveryState = 'pending' | 'sent' | 'failed';

@Injectable()
export class OrderNotificationRepository {
  constructor(private readonly prisma: PrismaService) {}

  // The INSERT itself IS the atomic claim (see schema.prisma's comment on the unique
  // (orderId, orderStatus) constraint) — returns false, never throws, when another caller
  // already claimed this exact transition. That is the expected, harmless outcome under
  // concurrent poll ticks, not an error condition.
  async claim(orderId: string, orderStatus: string): Promise<boolean> {
    try {
      await this.prisma.orderStatusNotification.create({
        data: { orderId, orderStatus, deliveryState: 'pending' satisfies DeliveryState },
      });
      return true;
    } catch (err) {
      if (isUniqueConstraintViolation(err)) {
        return false;
      }
      throw err;
    }
  }

  async markSent(orderId: string, orderStatus: string): Promise<void> {
    await this.prisma.orderStatusNotification.update({
      where: { orderId_orderStatus: { orderId, orderStatus } },
      data: { deliveryState: 'sent' satisfies DeliveryState, sentAt: new Date() },
    });
  }

  async markFailed(orderId: string, orderStatus: string): Promise<void> {
    await this.prisma.orderStatusNotification.update({
      where: { orderId_orderStatus: { orderId, orderStatus } },
      data: { deliveryState: 'failed' satisfies DeliveryState, attempts: { increment: 1 } },
    });
  }

  // Bounded retry candidates only (spec sections 8/34): a 'pending' row — meaning the process
  // may have crashed between claiming and either sending or recording the outcome — is
  // deliberately NEVER included here. Retrying it risks a duplicate message if the original
  // send actually reached Telegram before the crash; only a row with a CAUGHT send failure
  // (deliveryState 'failed') is safe to retry, since we know for certain nothing was delivered
  // for that attempt.
  findRetryableWithOrder(maxAttempts: number) {
    return this.prisma.orderStatusNotification.findMany({
      where: { deliveryState: 'failed' satisfies DeliveryState, attempts: { lt: maxAttempts } },
      include: { order: { include: { branch: true } } },
    });
  }
}
