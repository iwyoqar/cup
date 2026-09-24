import { Injectable } from '@nestjs/common';
import { Db, PrismaService } from '../../common/prisma/prisma.service';
import { CUSTOMER_METRICS_ORDER_STATUSES } from '../customer-metrics/customer-metrics-order-statuses';

// The IMPORTED status is the only Phase 11.2 import state that means "a finalized, fully resolved, paid Poster sale".
// Kept as a local literal on purpose: the import module owns the write side, this only reads its canonical rows.
const IMPORTED_POS_STATUS = 'IMPORTED';

@Injectable()
export class RewardProgressRepository {
  constructor(private readonly prisma: PrismaService) {}

  // Phase 11.3: ONE unified purchase history. Qualifying units = qualifying CUP paid units + qualifying imported POS
  // paid units, summed from two bounded aggregate queries over LOCAL tables only (never a per-order / per-line loop,
  // never a Poster API call). Everything downstream (RewardProgressService, redemption re-check) keeps its exact
  // X+Y semantics — this method is the single place the source of qualifying units is decided.
  sumQualifyingQuantity(customerId: string, categoryId: string): Promise<number> {
    return this.sumQualifyingQuantityWith(this.prisma, customerId, categoryId);
  }

  // Phase 13: the SAME qualifying-unit definition (CUP paid units + IMPORTED POS paid units in the category) for MANY customers at once, optionally
  // only counting purchases up to `upTo` (CUP by Order.createdAt, POS by importedAt — the moment CUP learned of it). Two grouped queries whatever
  // the number of customers; used by CRM automation to detect a reward credit being earned since a cursor without a query per customer.
  async sumQualifyingQuantityForCustomers(customerIds: string[], categoryId: string, upTo?: Date): Promise<Map<string, number>> {
    const result = new Map<string, number>(customerIds.map((id) => [id, 0]));
    if (customerIds.length === 0) return result;
    const [cup, pos] = await Promise.all([
      this.prisma.orderItem.findMany({
        where: { isRewardItem: false, product: { categoryId }, order: { customerId: { in: customerIds }, status: { in: [...CUSTOMER_METRICS_ORDER_STATUSES] }, ...(upTo ? { createdAt: { lte: upTo } } : {}) } },
        select: { quantity: true, order: { select: { customerId: true } } },
      }),
      this.prisma.posterImportedTransactionItem.findMany({
        where: { quantity: { gt: 0 }, posterPayedSumMinor: { gt: 0 }, product: { categoryId }, transaction: { customerId: { in: customerIds }, status: IMPORTED_POS_STATUS, paidMinor: { gt: 0 }, ...(upTo ? { importedAt: { lte: upTo } } : {}) } },
        select: { quantity: true, transaction: { select: { customerId: true } } },
      }),
    ]);
    for (const i of cup) result.set(i.order.customerId, (result.get(i.order.customerId) ?? 0) + i.quantity);
    // The where clause already constrains customerId to `in: customerIds` (never null at the DB level — SQL IN never
    // matches NULL); this guard is pure type-narrowing for the now-nullable column, not a real runtime possibility.
    for (const i of pos) if (i.transaction.customerId) result.set(i.transaction.customerId, (result.get(i.transaction.customerId) ?? 0) + i.quantity);
    return result;
  }

  // Transaction-consistent variant, used only inside RewardRedemptionService.createRedemptionRecord's
  // own transaction — see that method's comment for why re-deriving this through the SAME `tx`
  // (not a separate connection) is what makes its availableRewards re-check meaningful.
  sumQualifyingQuantityTx(tx: Db, customerId: string, categoryId: string): Promise<number> {
    return this.sumQualifyingQuantityWith(tx, customerId, categoryId);
  }

  // Owner decision (2026-09-24): the "5+1"-style BUY_X_GET_Y reward counts DISTINCT qualifying
  // PURCHASES (one CUP order = 1, one imported POS transaction = 1), never the summed item quantity
  // within a purchase — buying 5 coffees in a single visit must NOT by itself complete a "5 visits"
  // cycle; only 5 separate qualifying visits do. This is a DIFFERENT counting rule from
  // sumQualifyingQuantity above, which stays exactly as-is for its other consumers (Loyalty2's
  // CATEGORY_UNITS achievement, the LOYALTY_MILESTONE lifetimeCoffeeQuantity metric — both genuinely
  // mean "total units/coffees ever bought", not "number of visits"). Only reward-progress.service.ts,
  // reward-redemption.service.ts's re-check, and automation-trigger.service.ts's REWARD_UNLOCKED
  // trigger (which must match the reward engine's own math) use this.
  countQualifyingOccasions(customerId: string, categoryId: string): Promise<number> {
    return this.countQualifyingOccasionsWith(this.prisma, customerId, categoryId);
  }

  countQualifyingOccasionsTx(tx: Db, customerId: string, categoryId: string): Promise<number> {
    return this.countQualifyingOccasionsWith(tx, customerId, categoryId);
  }

  // Bulk variant, same "1 per qualifying order/transaction" rule as countQualifyingOccasions, with the
  // same optional `upTo` cursor semantics as sumQualifyingQuantityForCustomers.
  async countQualifyingOccasionsForCustomers(customerIds: string[], categoryId: string, upTo?: Date): Promise<Map<string, number>> {
    const result = new Map<string, number>(customerIds.map((id) => [id, 0]));
    if (customerIds.length === 0) return result;
    const [cupOrders, posTransactions] = await Promise.all([
      this.prisma.order.findMany({
        where: {
          customerId: { in: customerIds },
          status: { in: [...CUSTOMER_METRICS_ORDER_STATUSES] },
          ...(upTo ? { createdAt: { lte: upTo } } : {}),
          items: { some: { isRewardItem: false, product: { categoryId } } },
        },
        select: { customerId: true },
      }),
      this.prisma.posterImportedTransaction.findMany({
        where: {
          customerId: { in: customerIds },
          status: IMPORTED_POS_STATUS,
          paidMinor: { gt: 0 },
          ...(upTo ? { importedAt: { lte: upTo } } : {}),
          items: { some: { quantity: { gt: 0 }, posterPayedSumMinor: { gt: 0 }, product: { categoryId } } },
        },
        select: { customerId: true },
      }),
    ]);
    for (const o of cupOrders) result.set(o.customerId, (result.get(o.customerId) ?? 0) + 1);
    // Same type-narrowing note as sumQualifyingQuantityForCustomers above — customerId: { in: customerIds } already
    // excludes null rows at the DB level.
    for (const t of posTransactions) if (t.customerId) result.set(t.customerId, (result.get(t.customerId) ?? 0) + 1);
    return result;
  }

  // A qualifying order/transaction is one that has AT LEAST ONE qualifying line — filtered with the
  // exact same predicates sumCupQuantity/sumImportedPosQuantity use per-line, just counting the
  // parent row once (via `some`) instead of summing every matching line's quantity.
  private async countQualifyingOccasionsWith(db: Db, customerId: string, categoryId: string): Promise<number> {
    const [cupCount, posCount] = await Promise.all([
      db.order.count({
        where: { customerId, status: { in: [...CUSTOMER_METRICS_ORDER_STATUSES] }, items: { some: { isRewardItem: false, product: { categoryId } } } },
      }),
      db.posterImportedTransaction.count({
        where: {
          customerId,
          status: IMPORTED_POS_STATUS,
          paidMinor: { gt: 0 },
          items: { some: { quantity: { gt: 0 }, posterPayedSumMinor: { gt: 0 }, product: { categoryId } } },
        },
      }),
    ]);
    return cupCount + posCount;
  }

  private async sumQualifyingQuantityWith(db: Db, customerId: string, categoryId: string): Promise<number> {
    const [cup, pos] = await Promise.all([this.sumCupQuantity(db, customerId, categoryId), this.sumImportedPosQuantity(db, customerId, categoryId)]);
    return cup + pos;
  }

  // Reuses the exact same "which order statuses count as a real customer purchase" definition
  // CustomerMetricsService already owns (spec: "use the same completed/valid order semantics
  // already established"), never a second, competing definition. isRewardItem: false is the
  // explicit attribution that excludes free reward items from progress — never inferred from
  // unitPriceMinor (see schema.prisma's comment on OrderItem.isRewardItem).
  private async sumCupQuantity(db: Db, customerId: string, categoryId: string): Promise<number> {
    const result = await db.orderItem.aggregate({
      where: {
        isRewardItem: false,
        product: { categoryId },
        order: { customerId, status: { in: [...CUSTOMER_METRICS_ORDER_STATUSES] } },
      },
      _sum: { quantity: true },
    });
    return result._sum.quantity ?? 0;
  }

  // Imported Poster POS purchases, read from the canonical Phase 11.2 tables (never from Poster).
  //  - customerId is the attribution the import recorded through the verified chain
  //    Poster client_id -> Customer.posterClientId (setPosterClientIfMissing never overwrites it). No phone / name / amount /
  //    time / branch matching happens here.
  //  - status IMPORTED only: UNRESOLVED rows (unmapped product, modification, bad quantity) and everything the import
  //    skipped (unpaid, unlinked client, unmapped/inactive branch, not closed) never reach this table as IMPORTED.
  //    CUP-originated receipts are never stored as IMPORTED at all (they are already counted as CUP orders).
  //  - Belt-and-braces guards, so one malformed row is excluded instead of guessed at: a paid transaction (paidMinor > 0),
  //    a whole-number positive quantity, and a line Poster reports as actually paid (posterPayedSumMinor > 0 — a line
  //    Poster reports as 0 paid is not counted, the conservative direction for a "free item" reward).
  //  - product: { categoryId } requires a mapped Product (productId not null) in the program's qualifying category — the
  //    category comes from the RewardProgram, nothing is hardcoded. Like the CUP side, product.isActive is NOT filtered:
  //    historical purchases keep counting after a product is deactivated.
  //  - No branch filter: rewards are per customer, not per branch. No date filter either (same as the CUP side).
  private async sumImportedPosQuantity(db: Db, customerId: string, categoryId: string): Promise<number> {
    const result = await db.posterImportedTransactionItem.aggregate({
      where: {
        quantity: { gt: 0 },
        posterPayedSumMinor: { gt: 0 },
        product: { categoryId },
        transaction: { customerId, status: IMPORTED_POS_STATUS, paidMinor: { gt: 0 } },
      },
      _sum: { quantity: true },
    });
    return result._sum.quantity ?? 0;
  }
}
