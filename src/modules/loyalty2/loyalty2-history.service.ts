import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { afterCursor, FeedCursor } from '../admin-customers/customer-activity.repository';

export type LoyaltyHistoryType = 'POINT_EARN' | 'POINT_SPEND' | 'CASHBACK_EARN' | 'LEVEL_UP' | 'ACHIEVEMENT' | 'REWARD_REDEEM';

// Display-only, carries no internal ids (the opaque cursor is the only handle).
export interface LoyaltyHistoryItem {
  type: LoyaltyHistoryType;
  at: string;
  title: string;
  detail: string | null;
  points: number | null; // signed
  cashbackMinor: number | null;
}

export interface LoyaltyHistoryPage {
  items: LoyaltyHistoryItem[];
  nextCursor: string | null;
}

// Source rank (tie-break between sources at the same instant): points 0, cashback 1, level-up 2, achievement 3, reward 4.
const RANK = { POINTS: 0, CASHBACK: 1, LEVEL_UP: 2, ACHIEVEMENT: 3, REWARD: 4 } as const;
const NEWEST_FIRST = (field: string) => [{ [field]: 'desc' as const }, { id: 'desc' as const }];

interface Ranked {
  key: FeedCursor;
  item: LoyaltyHistoryItem;
}

function compare(a: Ranked, b: Ranked): number {
  if (a.key.t !== b.key.t) return b.key.t - a.key.t;
  if (a.key.k !== b.key.k) return a.key.k - b.key.k;
  return a.key.i < b.key.i ? 1 : a.key.i > b.key.i ? -1 : 0;
}

// The unified, chronological loyalty history: points ledger, cashback ledger, level-ups, achievements and reward redemptions
// merged with the same cursor design as the Customer 360 activity feed — each source is fetched at most limit+1 rows strictly
// after the cursor in the database, the union is sorted (time DESC, rank ASC, id DESC) and cut at `limit`; no offset, no
// whole-history read. Read-only.
@Injectable()
export class Loyalty2HistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async getHistory(customerId: string, options: { cursor?: string; limit: number }): Promise<LoyaltyHistoryPage> {
    const cursor = options.cursor ? decodeCursor(options.cursor) : null;
    const take = options.limit + 1;
    const [points, cashback, levelUps, unlocks, redemptions] = await Promise.all([
      this.prisma.loyaltyTransaction.findMany({
        where: { loyaltyAccount: { customerId }, ...afterCursor(RANK.POINTS, cursor, 'createdAt') },
        orderBy: NEWEST_FIRST('createdAt'),
        take,
        select: { id: true, type: true, points: true, description: true, createdAt: true },
      }),
      this.prisma.cashbackTransaction.findMany({
        where: { customerId, type: 'EARN', ...afterCursor(RANK.CASHBACK, cursor, 'createdAt') },
        orderBy: NEWEST_FIRST('createdAt'),
        take,
        select: { id: true, amountMinor: true, description: true, createdAt: true },
      }),
      this.prisma.loyaltyLevelUp.findMany({
        where: { customerId, ...afterCursor(RANK.LEVEL_UP, cursor, 'reachedAt') },
        orderBy: NEWEST_FIRST('reachedAt'),
        take,
        select: { id: true, levelName: true, reachedAt: true },
      }),
      this.prisma.customerAchievement.findMany({
        where: { customerId, ...afterCursor(RANK.ACHIEVEMENT, cursor, 'unlockedAt') },
        orderBy: NEWEST_FIRST('unlockedAt'),
        take,
        select: { id: true, unlockedAt: true, pointsAwarded: true, achievement: { select: { name: true, icon: true } } },
      }),
      this.prisma.rewardRedemption.findMany({
        where: { customerId, ...afterCursor(RANK.REWARD, cursor, 'redeemedAt') },
        orderBy: NEWEST_FIRST('redeemedAt'),
        take,
        select: { id: true, redeemedAt: true, rewardProductName: true, rewardQuantity: true, rewardProgram: { select: { name: true } } },
      }),
    ]);

    const ranked: Ranked[] = [
      ...points.map((p): Ranked => ({
        key: { t: p.createdAt.getTime(), k: RANK.POINTS, i: p.id },
        item: { type: p.points < 0 || p.type === 'SPEND' ? 'POINT_SPEND' : 'POINT_EARN', at: p.createdAt.toISOString(), title: p.points < 0 || p.type === 'SPEND' ? 'Points spent' : 'Points earned', detail: p.description, points: p.points, cashbackMinor: null },
      })),
      ...cashback.map((c): Ranked => ({
        key: { t: c.createdAt.getTime(), k: RANK.CASHBACK, i: c.id },
        item: { type: 'CASHBACK_EARN', at: c.createdAt.toISOString(), title: 'Cashback earned', detail: c.description, points: null, cashbackMinor: c.amountMinor },
      })),
      ...levelUps.map((l): Ranked => ({
        key: { t: l.reachedAt.getTime(), k: RANK.LEVEL_UP, i: l.id },
        item: { type: 'LEVEL_UP', at: l.reachedAt.toISOString(), title: 'Level up', detail: `Reached ${l.levelName}`, points: null, cashbackMinor: null },
      })),
      ...unlocks.map((u): Ranked => ({
        key: { t: u.unlockedAt.getTime(), k: RANK.ACHIEVEMENT, i: u.id },
        item: { type: 'ACHIEVEMENT', at: u.unlockedAt.toISOString(), title: 'Achievement unlocked', detail: `${u.achievement.icon} ${u.achievement.name}`, points: u.pointsAwarded > 0 ? u.pointsAwarded : null, cashbackMinor: null },
      })),
      ...redemptions.map((r): Ranked => ({
        key: { t: r.redeemedAt.getTime(), k: RANK.REWARD, i: r.id },
        item: { type: 'REWARD_REDEEM', at: r.redeemedAt.toISOString(), title: 'Reward redeemed', detail: r.rewardProductName ? `${r.rewardProductName} × ${r.rewardQuantity} · ${r.rewardProgram.name}` : r.rewardProgram.name, points: null, cashbackMinor: null },
      })),
    ].sort(compare);

    const hasMore = ranked.length > options.limit;
    const page = hasMore ? ranked.slice(0, options.limit) : ranked;
    return { items: page.map((r) => r.item), nextCursor: hasMore ? Buffer.from(JSON.stringify(page[page.length - 1].key)).toString('base64url') : null };
  }
}

function decodeCursor(raw: string): FeedCursor {
  try {
    const p = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<FeedCursor>;
    if (typeof p.t === 'number' && Number.isFinite(p.t) && Number.isInteger(p.k) && (p.k as number) >= 0 && (p.k as number) <= 4 && typeof p.i === 'string' && p.i.length > 0 && p.i.length <= 64) {
      return { t: p.t, k: p.k as number, i: p.i };
    }
  } catch {
    // fall through
  }
  throw new BadRequestException('Invalid cursor.');
}
