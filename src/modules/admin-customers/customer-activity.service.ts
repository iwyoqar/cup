import { BadRequestException, Injectable } from '@nestjs/common';
import { ActivityKind, CustomerActivityRepository, FeedCursor, KIND_RANK } from './customer-activity.repository';

export type ActivityFilter = 'purchases' | 'all';

// Display-only, server-shaped. Deliberately carries no internal ids (order / transaction / customer / program ids never
// leave the server); the opaque `nextCursor` is the only pagination handle.
export interface CustomerActivityItem {
  type: ActivityKind;
  at: string;
  source: 'CUP' | 'POS' | null; // purchases only — CUP orders and POS purchases are never mixed up
  branchName: string | null; // purchases only; null = the source has no branch (UI shows "Filial aniqlanmagan")
  amountMinor: number | null; // purchases only
  status: string | null; // CUP order status
  lines: { productName: string | null; quantity: number; isReward: boolean }[]; // purchases only; null name = unmapped product
  points: number | null; // loyalty only (signed)
  label: string | null; // loyalty description / reward description
}

export interface CustomerActivityPage {
  items: CustomerActivityItem[];
  nextCursor: string | null;
}

interface Ranked {
  key: { t: number; k: number; i: string };
  item: CustomerActivityItem;
}

// Total order: time DESC, kind rank ASC, id DESC — the same order each source query applies, so the merged page is exactly
// the next `limit` rows of one virtual, globally sorted feed.
function compareRanked(a: Ranked, b: Ranked): number {
  if (a.key.t !== b.key.t) return b.key.t - a.key.t;
  if (a.key.k !== b.key.k) return a.key.k - b.key.k;
  return a.key.i < b.key.i ? 1 : a.key.i > b.key.i ? -1 : 0;
}

@Injectable()
export class CustomerActivityService {
  constructor(private readonly repository: CustomerActivityRepository) {}

  // Cursor pagination over up to four independently sorted sources. Each source is asked for at most limit+1 rows strictly
  // after the cursor (the database applies the cursor); the union is sorted and cut at limit — at most 4*(limit+1) rows are
  // ever read per page, never a whole history, and there is no offset. The cursor is the (time, rank, id) of the last item
  // returned, which is unique and totally ordered, so pages never overlap or skip.
  async getFeed(customerId: string, options: { cursor?: string; limit: number; filter: ActivityFilter; branchId?: string | null }): Promise<CustomerActivityPage> {
    const cursor = options.cursor ? decodeCursor(options.cursor) : null;
    const take = options.limit + 1;
    const includeAll = options.filter === 'all';

    const [orders, pos, loyalty, redemptions] = await Promise.all([
      this.repository.cupOrders(customerId, cursor, take, options.branchId),
      this.repository.posPurchases(customerId, cursor, take, options.branchId),
      includeAll ? this.repository.loyaltyTransactions(customerId, cursor, take) : Promise.resolve([]),
      includeAll ? this.repository.rewardRedemptions(customerId, cursor, take) : Promise.resolve([]),
    ]);

    const ranked: Ranked[] = [
      ...orders.map((o): Ranked => ({
        key: { t: o.createdAt.getTime(), k: KIND_RANK.CUP_ORDER, i: o.id },
        item: {
          type: 'CUP_ORDER',
          at: o.createdAt.toISOString(),
          source: 'CUP',
          branchName: o.branch ? o.branch.name : null,
          amountMinor: o.totalMinor,
          status: o.status,
          lines: o.items.map((i) => ({ productName: i.product ? i.product.name : null, quantity: i.quantity, isReward: i.isRewardItem })),
          points: null,
          label: null,
        },
      })),
      ...pos.map((t): Ranked => ({
        key: { t: t.occurredAt.getTime(), k: KIND_RANK.POS_PURCHASE, i: t.id },
        item: {
          type: 'POS_PURCHASE',
          at: t.occurredAt.toISOString(),
          source: 'POS',
          branchName: t.branch ? t.branch.name : null,
          amountMinor: t.totalMinor,
          status: null,
          lines: t.items.map((i) => ({ productName: i.product ? i.product.name : null, quantity: i.quantity, isReward: false })),
          points: null,
          label: null,
        },
      })),
      ...loyalty.map((l): Ranked => ({
        key: { t: l.createdAt.getTime(), k: KIND_RANK.LOYALTY, i: l.id },
        item: { type: 'LOYALTY', at: l.createdAt.toISOString(), source: null, branchName: null, amountMinor: null, status: null, lines: [], points: l.points, label: l.description ?? l.type },
      })),
      ...redemptions.map((r): Ranked => ({
        key: { t: r.redeemedAt.getTime(), k: KIND_RANK.REWARD_REDEEMED, i: r.id },
        item: {
          type: 'REWARD_REDEEMED',
          at: r.redeemedAt.toISOString(),
          source: null,
          branchName: null,
          amountMinor: null,
          status: null,
          lines: r.rewardProductName ? [{ productName: r.rewardProductName, quantity: r.rewardQuantity, isReward: true }] : [],
          points: null,
          label: r.rewardProgram.name,
        },
      })),
    ].sort(compareRanked);

    const hasMore = ranked.length > options.limit;
    const page = hasMore ? ranked.slice(0, options.limit) : ranked;
    return { items: page.map((r) => r.item), nextCursor: hasMore ? encodeCursor(page[page.length - 1].key) : null };
  }
}

function encodeCursor(key: FeedCursor): string {
  return Buffer.from(JSON.stringify(key)).toString('base64url');
}

// Opaque to clients; anything malformed is a 400, never guessed at.
function decodeCursor(raw: string): FeedCursor {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<FeedCursor>;
    if (typeof parsed.t === 'number' && Number.isFinite(parsed.t) && Number.isInteger(parsed.k) && parsed.k! >= 0 && parsed.k! <= 3 && typeof parsed.i === 'string' && parsed.i.length > 0 && parsed.i.length <= 64) {
      return { t: parsed.t, k: parsed.k as number, i: parsed.i };
    }
  } catch {
    // fall through
  }
  throw new BadRequestException('Invalid cursor.');
}
