import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface SaveRewardProgramData {
  name: string;
  description: string | null;
  type: string;
  qualifyingCategoryId: string;
  buyQuantity: number;
  rewardQuantity: number;
  isActive: boolean;
  startsAt: Date;
  endsAt: Date | null;
}

const DETAIL_INCLUDE = {
  qualifyingCategory: { select: { id: true, name: true, isActive: true } },
} as const;

@Injectable()
export class RewardProgramsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findMany(options: { cursor?: string; take: number }) {
    return this.prisma.rewardProgram.findMany({
      orderBy: { updatedAt: 'desc' },
      take: options.take,
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
      include: DETAIL_INCLUDE,
    });
  }

  findById(id: string) {
    return this.prisma.rewardProgram.findUnique({ where: { id }, include: DETAIL_INCLUDE });
  }

  // Bounded — active programs currently within their validity window, filtered at the SQL
  // level. Used by the customer-facing GET /loyalty/rewards; the founder is expected to run a
  // small number of these at once (same tradeoff already accepted for
  // PromotionsRepository.findActiveWithinValidity).
  findActiveWithinValidity(now: Date) {
    return this.prisma.rewardProgram.findMany({
      where: { isActive: true, startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
      include: DETAIL_INCLUDE,
    });
  }

  create(data: SaveRewardProgramData & { createdBy: string | null }) {
    return this.prisma.rewardProgram.create({
      data: {
        name: data.name,
        description: data.description,
        type: data.type,
        qualifyingCategoryId: data.qualifyingCategoryId,
        buyQuantity: data.buyQuantity,
        rewardQuantity: data.rewardQuantity,
        isActive: data.isActive,
        startsAt: data.startsAt,
        endsAt: data.endsAt,
        createdBy: data.createdBy,
        updatedBy: data.createdBy,
      },
      include: DETAIL_INCLUDE,
    });
  }

  update(id: string, data: Partial<SaveRewardProgramData> & { updatedBy: string | null }) {
    return this.prisma.rewardProgram.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.qualifyingCategoryId !== undefined ? { qualifyingCategoryId: data.qualifyingCategoryId } : {}),
        ...(data.buyQuantity !== undefined ? { buyQuantity: data.buyQuantity } : {}),
        ...(data.rewardQuantity !== undefined ? { rewardQuantity: data.rewardQuantity } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
        ...(data.startsAt !== undefined ? { startsAt: data.startsAt } : {}),
        ...(data.endsAt !== undefined ? { endsAt: data.endsAt } : {}),
        updatedBy: data.updatedBy,
      },
      include: DETAIL_INCLUDE,
    });
  }

  delete(id: string) {
    return this.prisma.rewardProgram.delete({ where: { id } });
  }
}
