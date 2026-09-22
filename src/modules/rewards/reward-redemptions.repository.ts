import { Injectable } from '@nestjs/common';
import { Db, PrismaService } from '../../common/prisma/prisma.service';

export interface CreateRewardRedemptionData {
  rewardProgramId: string;
  customerId: string;
  orderId: string | null;
  redemptionIndex: number;
  rewardProductId: string | null;
  rewardProductName: string | null;
  rewardQuantity: number;
  buyQuantitySnapshot: number;
  qualifyingCategoryName: string | null;
}

@Injectable()
export class RewardRedemptionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // Accepts a `Db` (plain PrismaService or an in-flight transaction client) so OrdersService can
  // create this row in the SAME atomic transaction as recording Poster's confirmed success — see
  // reward-redemption.service.ts's module comment for why that specific timing matters. The
  // unique (rewardProgramId, customerId, redemptionIndex) constraint is the race-safety
  // mechanism, same pattern as PromotionRedemptionsRepository.create.
  create(db: Db, data: CreateRewardRedemptionData) {
    return db.rewardRedemption.create({ data });
  }

  countForCustomer(rewardProgramId: string, customerId: string): Promise<number> {
    return this.prisma.rewardRedemption.count({ where: { rewardProgramId, customerId } });
  }

  // Transaction-consistent variant of the above, used only inside createRedemptionRecord's own
  // transaction (see reward-redemption.service.ts) — reads through the SAME `tx` client the
  // subsequent insert uses, rather than a separate connection, so the count and the insert are
  // guaranteed to see a consistent view of each other.
  countForCustomerTx(db: Db, rewardProgramId: string, customerId: string): Promise<number> {
    return db.rewardRedemption.count({ where: { rewardProgramId, customerId } });
  }

  // Phase 16: total redemptions ever + the newest few (program / product names joined in the same query) for the Staff profile. Read-only, bounded.
  async summaryForCustomer(customerId: string, take: number) {
    const [total, recent] = await Promise.all([
      this.prisma.rewardRedemption.count({ where: { customerId } }),
      this.prisma.rewardRedemption.findMany({
        where: { customerId },
        orderBy: [{ redeemedAt: 'desc' }, { id: 'desc' }],
        take,
        select: { redeemedAt: true, rewardProductName: true, rewardQuantity: true, rewardProgram: { select: { name: true } } },
      }),
    ]);
    return { total, recent };
  }

  // Phase 15: redemption counts for MANY customers of one program in a single grouped query (customers with none are simply absent).
  async countsForCustomers(rewardProgramId: string, customerIds: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (customerIds.length === 0) return out;
    const rows = await this.prisma.rewardRedemption.groupBy({ by: ['customerId'], where: { rewardProgramId, customerId: { in: customerIds } }, _count: { _all: true } });
    for (const r of rows) out.set(r.customerId, r._count._all);
    return out;
  }

  countForProgram(rewardProgramId: string): Promise<number> {
    return this.prisma.rewardRedemption.count({ where: { rewardProgramId } });
  }

  list(rewardProgramId: string, options: { cursor?: string; take: number }) {
    return this.prisma.rewardRedemption.findMany({
      where: { rewardProgramId },
      orderBy: { id: 'asc' },
      take: options.take,
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
      include: { customer: { select: { displayName: true, phone: true } } },
    });
  }
}
