import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface SavePromotionData {
  name: string;
  description: string | null;
  segmentId: string | null;
  benefitType: string;
  benefitValue: number | null;
  benefitProductId: string | null;
  benefitQuantity: number | null;
  startsAt: Date;
  endsAt: Date | null;
  isActive: boolean;
  usageLimitPerCustomer: number | null;
}

const DETAIL_INCLUDE = {
  segment: { select: { id: true, name: true } },
  benefitProduct: { select: { id: true, name: true, isActive: true } },
} as const;

@Injectable()
export class PromotionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findMany(options: { cursor?: string; take: number }) {
    return this.prisma.promotion.findMany({
      orderBy: { updatedAt: 'desc' },
      take: options.take,
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
      include: DETAIL_INCLUDE,
    });
  }

  findById(id: string) {
    return this.prisma.promotion.findUnique({ where: { id }, include: DETAIL_INCLUDE });
  }

  // Bounded — active promotions currently within their validity window, filtered at the SQL
  // level rather than fetched-then-filtered. The founder is expected to have a small number of
  // concurrently active promotions, so this is naturally bounded without needing pagination —
  // used by the customer-facing GET /promotions (promotions.service.ts's listForCustomer).
  findActiveWithinValidity(now: Date) {
    return this.prisma.promotion.findMany({
      where: { isActive: true, startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
      include: DETAIL_INCLUDE,
    });
  }

  create(data: SavePromotionData & { createdBy: string | null }) {
    return this.prisma.promotion.create({
      data: {
        name: data.name,
        description: data.description,
        segmentId: data.segmentId,
        benefitType: data.benefitType,
        benefitValue: data.benefitValue,
        benefitProductId: data.benefitProductId,
        benefitQuantity: data.benefitQuantity,
        startsAt: data.startsAt,
        endsAt: data.endsAt,
        isActive: data.isActive,
        usageLimitPerCustomer: data.usageLimitPerCustomer,
        createdBy: data.createdBy,
        updatedBy: data.createdBy,
      },
      include: DETAIL_INCLUDE,
    });
  }

  update(id: string, data: Partial<SavePromotionData> & { updatedBy: string | null }) {
    return this.prisma.promotion.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.segmentId !== undefined ? { segmentId: data.segmentId } : {}),
        ...(data.benefitType !== undefined ? { benefitType: data.benefitType } : {}),
        ...(data.benefitValue !== undefined ? { benefitValue: data.benefitValue } : {}),
        ...(data.benefitProductId !== undefined ? { benefitProductId: data.benefitProductId } : {}),
        ...(data.benefitQuantity !== undefined ? { benefitQuantity: data.benefitQuantity } : {}),
        ...(data.startsAt !== undefined ? { startsAt: data.startsAt } : {}),
        ...(data.endsAt !== undefined ? { endsAt: data.endsAt } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
        ...(data.usageLimitPerCustomer !== undefined ? { usageLimitPerCustomer: data.usageLimitPerCustomer } : {}),
        updatedBy: data.updatedBy,
      },
      include: DETAIL_INCLUDE,
    });
  }

  setActive(id: string, isActive: boolean, updatedBy: string | null) {
    return this.prisma.promotion.update({ where: { id }, data: { isActive, updatedBy }, include: DETAIL_INCLUDE });
  }

  delete(id: string) {
    return this.prisma.promotion.delete({ where: { id } });
  }
}
