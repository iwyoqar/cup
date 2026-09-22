import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface CreateRedemptionData {
  promotionId: string;
  customerId: string;
  orderId: string | null;
  usageIndex: number;
  benefitType: string;
  benefitValue: number | null;
  benefitProductId: string | null;
  benefitProductName: string | null;
  benefitQuantity: number | null;
}

@Injectable()
export class PromotionRedemptionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // THE race-safety mechanism (see schema.prisma's comment on PromotionRedemption.usageIndex
  // and promotion-redemption.service.ts): the unique (promotionId, customerId, usageIndex)
  // constraint means at most one caller can ever successfully insert a given usageIndex for a
  // given customer+promotion — a concurrent loser gets a unique-constraint violation, never a
  // silently-accepted duplicate slot.
  create(data: CreateRedemptionData) {
    return this.prisma.promotionRedemption.create({ data });
  }

  countForCustomer(promotionId: string, customerId: string): Promise<number> {
    return this.prisma.promotionRedemption.count({ where: { promotionId, customerId } });
  }

  // Bulk variant for audience preview (spec's N+1 avoidance) — one groupBy query regardless of
  // candidate count, never a per-customer count query.
  async countByCustomerIds(promotionId: string, customerIds: string[]): Promise<Map<string, number>> {
    if (customerIds.length === 0) {
      return new Map();
    }
    const grouped = await this.prisma.promotionRedemption.groupBy({
      by: ['customerId'],
      where: { promotionId, customerId: { in: customerIds } },
      _count: { _all: true },
    });
    return new Map(grouped.map((g) => [g.customerId, g._count._all]));
  }

  countForPromotion(promotionId: string): Promise<number> {
    return this.prisma.promotionRedemption.count({ where: { promotionId } });
  }

  list(promotionId: string, options: { cursor?: string; take: number }) {
    return this.prisma.promotionRedemption.findMany({
      where: { promotionId },
      orderBy: { id: 'asc' },
      take: options.take,
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
      include: { customer: { select: { displayName: true, phone: true } } },
    });
  }
}
