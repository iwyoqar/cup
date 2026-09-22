import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CUSTOMER_METRICS_ORDER_STATUSES } from '../customer-metrics/customer-metrics-order-statuses';

// Phase 11.4 — the four canonical sources of Customer 360's activity feed. Each query is bounded by `take`, filtered by the
// feed cursor IN THE DATABASE, ordered (time desc, id desc) and joined to the names it needs (branch / product / program) in
// the same query, so a page costs a fixed number of queries whatever the customer's history size. Read-only.

// Global feed order: occurredAt DESC, then kind rank ASC, then id DESC. The rank makes ties between different sources
// deterministic; the id makes ties inside one source deterministic.
export const KIND_RANK = { CUP_ORDER: 0, POS_PURCHASE: 1, LOYALTY: 2, REWARD_REDEEMED: 3 } as const;
export type ActivityKind = keyof typeof KIND_RANK;

export interface FeedCursor {
  t: number; // epoch ms of the last item returned
  k: number; // its kind rank
  i: string; // its row id
}

// "Strictly after the cursor" for one source with a constant rank, in (time desc, rank asc, id desc) order:
//   later-ranked source   -> time <= t   (same-instant rows of a later rank still come after the cursor row)
//   earlier-ranked source -> time <  t
//   same source           -> time < t OR (time = t AND id < i)
export function afterCursor(rank: number, cursor: FeedCursor | null, field: string): Record<string, unknown> {
  if (!cursor) return {};
  const t = new Date(cursor.t);
  if (rank > cursor.k) return { [field]: { lte: t } };
  if (rank < cursor.k) return { [field]: { lt: t } };
  return { OR: [{ [field]: { lt: t } }, { [field]: t, id: { lt: cursor.i } }] };
}

const NEWEST_FIRST = (field: string) => [{ [field]: 'desc' as const }, { id: 'desc' as const }];

@Injectable()
export class CustomerActivityRepository {
  constructor(private readonly prisma: PrismaService) {}

  // Phase 16: `branchId` (optional) restricts to purchases AT that branch (Order.branchId) — an order with no branch is never in a branch view.
  cupOrders(customerId: string, cursor: FeedCursor | null, take: number, branchId?: string | null) {
    return this.prisma.order.findMany({
      where: { customerId, status: { in: [...CUSTOMER_METRICS_ORDER_STATUSES] }, ...(branchId ? { branchId } : {}), ...afterCursor(KIND_RANK.CUP_ORDER, cursor, 'createdAt') },
      orderBy: NEWEST_FIRST('createdAt'),
      take,
      select: {
        id: true,
        status: true,
        totalMinor: true,
        createdAt: true,
        branch: { select: { name: true } },
        items: { select: { quantity: true, isRewardItem: true, product: { select: { name: true } } } },
      },
    });
  }

  posPurchases(customerId: string, cursor: FeedCursor | null, take: number, branchId?: string | null) {
    return this.prisma.posterImportedTransaction.findMany({
      where: { customerId, status: 'IMPORTED', ...(branchId ? { branchId } : {}), ...afterCursor(KIND_RANK.POS_PURCHASE, cursor, 'occurredAt') },
      orderBy: NEWEST_FIRST('occurredAt'),
      take,
      select: {
        id: true,
        occurredAt: true,
        totalMinor: true,
        branch: { select: { name: true } },
        items: { orderBy: { lineIndex: 'asc' }, select: { quantity: true, product: { select: { name: true } } } },
      },
    });
  }

  loyaltyTransactions(customerId: string, cursor: FeedCursor | null, take: number) {
    return this.prisma.loyaltyTransaction.findMany({
      where: { loyaltyAccount: { customerId }, ...afterCursor(KIND_RANK.LOYALTY, cursor, 'createdAt') },
      orderBy: NEWEST_FIRST('createdAt'),
      take,
      select: { id: true, type: true, points: true, description: true, createdAt: true },
    });
  }

  rewardRedemptions(customerId: string, cursor: FeedCursor | null, take: number) {
    return this.prisma.rewardRedemption.findMany({
      where: { customerId, ...afterCursor(KIND_RANK.REWARD_REDEEMED, cursor, 'redeemedAt') },
      orderBy: NEWEST_FIRST('redeemedAt'),
      take,
      select: { id: true, redeemedAt: true, rewardProductName: true, rewardQuantity: true, rewardProgram: { select: { name: true } } },
    });
  }
}
