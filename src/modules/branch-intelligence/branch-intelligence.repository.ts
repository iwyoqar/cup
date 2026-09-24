import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CUSTOMER_METRICS_ORDER_STATUSES } from '../customer-metrics/customer-metrics-order-statuses';
import { dayBucketFromEpochMsSql, epochMsCastSql, epochMsParam } from '../../common/prisma/sql-dialect';

const ORDER_STATUSES = [...CUSTOMER_METRICS_ORDER_STATUSES];
const num = (v: bigint | number | string | null | undefined): number => (v === null || v === undefined ? 0 : Number(v));

// A branch whose only activity in the period is anonymous POS purchases has no row from branchRowsIdentified() at
// all (nothing there to join against) — this is its starting point before anonymous revenue/orders are merged in.
const EMPTY_BRANCH_ROW = (branchId: string): BranchRow => ({
  branchId,
  customers: 0,
  orders: 0,
  revenue: 0,
  cupOrders: 0,
  cupRevenue: 0,
  posOrders: 0,
  posRevenue: 0,
  cupCustomers: 0,
  posCustomers: 0,
  newCustomers: 0,
  customers2Plus: 0,
  customers3Plus: 0,
  repeatPurchases: 0,
  alsoOtherBranches: 0,
  latestHere: 0,
  arrivedFromOther: 0,
});

export interface RangeMs {
  from: number; // inclusive epoch ms
  to: number; // exclusive epoch ms
}

export interface BranchRow {
  branchId: string;
  customers: number;
  orders: number;
  revenue: number;
  cupOrders: number;
  cupRevenue: number;
  posOrders: number;
  posRevenue: number;
  cupCustomers: number;
  posCustomers: number;
  newCustomers: number;
  customers2Plus: number;
  customers3Plus: number;
  repeatPurchases: number;
  alsoOtherBranches: number; // customers who ALSO purchased at another mapped branch in the period
  latestHere: number; // customers whose latest mapped purchase in the period was at this branch
  arrivedFromOther: number; // customers with a purchase here that DIRECTLY followed a purchase at another branch
}

export interface TotalsRow {
  orders: number;
  revenue: number;
  customers: number;
  newCustomers: number;
  unmappedOrders: number;
  unmappedRevenue: number;
  cupOrders: number;
  cupRevenue: number;
  posOrders: number;
  posRevenue: number;
  cupCustomers: number;
  posCustomers: number;
}

// The ONE canonical purchase list every query below starts from: qualifying CUP orders (CUSTOMER_METRICS_ORDER_STATUSES, by createdAt / branchId)
// UNION IMPORTED POS purchases (by occurredAt / branchId) — exactly Analytics V1's / Growth Intelligence's definition. An order with no branch (or any
// row whose branch is NULL) is "unmapped": it is in the all-branches totals but in no branch's metrics. Nothing is ever inferred from the customer, the
// staff member, the product or the time.
const PURCHASES = Prisma.sql`
  SELECT "branchId" AS b, "customerId" AS c, ${epochMsCastSql('"createdAt"')} AS t, "totalMinor" AS a, 'C' AS src, "id" AS id
    FROM "orders" WHERE "status" IN (${Prisma.join(ORDER_STATUSES)})
  UNION ALL
  SELECT "branchId", "customerId", ${epochMsCastSql('"occurredAt"')}, "totalMinor", 'P', "id"
    FROM "poster_imported_transactions" WHERE "status" = 'IMPORTED'`;

// Every purchase with its position in that CUSTOMER'S canonical history (time, source, id): rn = 1 is their FIRST purchase ever, prevB the branch of the
// purchase immediately before it (NULL for the first purchase or when that purchase had no branch).
const SEQUENCED = Prisma.sql`
  SELECT b, c, t, a, src, id, ROW_NUMBER() OVER w AS rn, LAG(b) OVER w AS prevB FROM p WINDOW w AS (PARTITION BY c ORDER BY t, src, id)`;

const dayExpr = (offsetMinutes: number) => dayBucketFromEpochMsSql('t', offsetMinutes);

// Only Prisma / raw SQL for Branch Intelligence lives here. Every method is ONE statement whose cost does not depend on the number of branches
// (branches are a GROUP BY, never a loop).
@Injectable()
export class BranchIntelligenceRepository {
  constructor(private readonly prisma: PrismaService) {}

  listBranches() {
    return this.prisma.branch.findMany({ select: { id: true, name: true, isActive: true, posterSpotId: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }] });
  }

  // Per-branch period metrics in one pass: purchases at MAPPED branches inside the period, grouped per (branch, customer) and then per branch.
  //
  // Bug found during Reports Phase B1 (2026-09-24): the raw query below INNER JOINs per-purchase rows against `nb`/`lp` ON customerId, so an anonymous
  // POS purchase (customerId NULL, introduced by Phase 19) is silently dropped from EVERY figure here, including revenue/orders — not just the
  // customer-behavior figures where dropping it would actually be correct (a purchase with no customer cannot have cross-branch customer behavior).
  // `totals()` below has no such join and correctly includes anonymous revenue, so branch revenue could undercount the all-branches total by exactly
  // the anonymous amount, with no "unmapped" figure to explain the gap (these rows DO have a branchId). Fixed by keeping the query's identified-customer
  // behavior exactly as before (nb/lp/rn/prevB are genuinely undefined for a purchase with no customer — the INNER JOIN there is correct) and merging
  // anonymous purchases back in afterwards as pure revenue/orders, via posAnonymousByBranch() below, which never touches a customer-level figure.
  async branchRows(r: RangeMs): Promise<BranchRow[]> {
    const [rows, anonymous] = await Promise.all([this.branchRowsIdentified(r), this.posAnonymousByBranch(r)]);
    const byId = new Map(rows.map((row) => [row.branchId, row]));
    for (const a of anonymous) {
      const row = byId.get(a.branchId) ?? EMPTY_BRANCH_ROW(a.branchId);
      row.orders += a.orders;
      row.revenue += a.revenue;
      row.posOrders += a.orders;
      row.posRevenue += a.revenue;
      byId.set(a.branchId, row);
    }
    return [...byId.values()];
  }

  private async branchRowsIdentified(r: RangeMs): Promise<BranchRow[]> {
    const rows = await this.prisma.$queryRaw<Record<string, bigint | number | string | null>[]>(Prisma.sql`
      WITH p AS (${PURCHASES}), s AS (${SEQUENCED}),
      per AS (SELECT * FROM s WHERE t >= ${r.from} AND t < ${r.to} AND b IS NOT NULL),
      nb AS (SELECT c, COUNT(DISTINCT b) AS nb FROM per GROUP BY c),
      lp AS (SELECT c, b AS lastB FROM (SELECT c, b, ROW_NUMBER() OVER (PARTITION BY c ORDER BY t DESC, src DESC, id DESC) AS r FROM per) WHERE r = 1),
      pc AS (
        SELECT per.b AS b, per.c AS c, COUNT(*) AS n, SUM(per.a) AS rev,
               SUM(CASE WHEN per.src = 'C' THEN 1 ELSE 0 END) AS cupN, SUM(CASE WHEN per.src = 'C' THEN per.a ELSE 0 END) AS cupRev,
               SUM(CASE WHEN per.src = 'P' THEN 1 ELSE 0 END) AS posN, SUM(CASE WHEN per.src = 'P' THEN per.a ELSE 0 END) AS posRev,
               MAX(CASE WHEN per.rn = 1 THEN 1 ELSE 0 END) AS isNew,
               MAX(CASE WHEN per.prevB IS NOT NULL AND per.prevB <> per.b THEN 1 ELSE 0 END) AS arrived,
               MAX(nb.nb) AS nb, MAX(CASE WHEN lp.lastB = per.b THEN 1 ELSE 0 END) AS latestHere
          FROM per JOIN nb ON nb.c = per.c JOIN lp ON lp.c = per.c GROUP BY per.b, per.c
      )
      SELECT b, COUNT(*) AS customers, SUM(n) AS orders, SUM(rev) AS revenue,
             SUM(cupN) AS cupOrders, SUM(cupRev) AS cupRevenue, SUM(posN) AS posOrders, SUM(posRev) AS posRevenue,
             SUM(CASE WHEN cupN > 0 THEN 1 ELSE 0 END) AS cupCustomers, SUM(CASE WHEN posN > 0 THEN 1 ELSE 0 END) AS posCustomers,
             SUM(isNew) AS newCustomers, SUM(CASE WHEN n >= 2 THEN 1 ELSE 0 END) AS c2, SUM(CASE WHEN n >= 3 THEN 1 ELSE 0 END) AS c3,
             SUM(n - 1) AS repeatPurchases, SUM(CASE WHEN nb >= 2 THEN 1 ELSE 0 END) AS multi, SUM(latestHere) AS latestHere, SUM(arrived) AS arrived
        FROM pc GROUP BY b`);
    return rows.map((x) => ({
      branchId: String(x.b),
      customers: num(x.customers),
      orders: num(x.orders),
      revenue: num(x.revenue),
      cupOrders: num(x.cupOrders),
      cupRevenue: num(x.cupRevenue),
      posOrders: num(x.posOrders),
      posRevenue: num(x.posRevenue),
      cupCustomers: num(x.cupCustomers),
      posCustomers: num(x.posCustomers),
      newCustomers: num(x.newCustomers),
      customers2Plus: num(x.c2),
      customers3Plus: num(x.c3),
      repeatPurchases: num(x.repeatPurchases),
      alsoOtherBranches: num(x.multi),
      latestHere: num(x.latestHere),
      arrivedFromOther: num(x.arrived),
    }));
  }

  // The all-branches picture INCLUDING unmapped purchases — the same population as Analytics V1 without a branch filter.
  async totals(r: RangeMs): Promise<TotalsRow> {
    const [x] = await this.prisma.$queryRaw<Record<string, bigint | number | string | null>[]>(Prisma.sql`
      WITH p AS (${PURCHASES}), s AS (${SEQUENCED})
      SELECT COUNT(*) AS orders, SUM(a) AS revenue, COUNT(DISTINCT c) AS customers,
             COUNT(DISTINCT CASE WHEN rn = 1 THEN c END) AS newCustomers,
             SUM(CASE WHEN b IS NULL THEN 1 ELSE 0 END) AS unmappedOrders, SUM(CASE WHEN b IS NULL THEN a ELSE 0 END) AS unmappedRevenue,
             SUM(CASE WHEN src = 'C' THEN 1 ELSE 0 END) AS cupOrders, SUM(CASE WHEN src = 'C' THEN a ELSE 0 END) AS cupRevenue,
             SUM(CASE WHEN src = 'P' THEN 1 ELSE 0 END) AS posOrders, SUM(CASE WHEN src = 'P' THEN a ELSE 0 END) AS posRevenue,
             COUNT(DISTINCT CASE WHEN src = 'C' THEN c END) AS cupCustomers, COUNT(DISTINCT CASE WHEN src = 'P' THEN c END) AS posCustomers
        FROM s WHERE t >= ${r.from} AND t < ${r.to}`);
    return {
      orders: num(x?.orders),
      revenue: num(x?.revenue),
      customers: num(x?.customers),
      newCustomers: num(x?.newCustomers),
      unmappedOrders: num(x?.unmappedOrders),
      unmappedRevenue: num(x?.unmappedRevenue),
      cupOrders: num(x?.cupOrders),
      cupRevenue: num(x?.cupRevenue),
      posOrders: num(x?.posOrders),
      posRevenue: num(x?.posRevenue),
      cupCustomers: num(x?.cupCustomers),
      posCustomers: num(x?.posCustomers),
    };
  }

  // Reports Phase B1 — the customer-less subset of each branch's POS revenue (posRevenue in branchRows() above), grouped by branch. Never a second POS
  // revenue calculation: callers derive "identified POS" per branch by subtracting this from branchRows()'s own posRevenue/posOrders for that branch.
  async posAnonymousByBranch(r: RangeMs): Promise<{ branchId: string; orders: number; revenue: number }[]> {
    const rows = await this.prisma.$queryRaw<{ b: string; orders: bigint | number; revenue: bigint | number | null }[]>(Prisma.sql`
      SELECT "branchId" AS b, COUNT(*) AS orders, SUM("totalMinor") AS revenue
        FROM "poster_imported_transactions"
       WHERE "status" = 'IMPORTED' AND "customerId" IS NULL AND "branchId" IS NOT NULL
         AND "occurredAt" >= ${epochMsParam(r.from)} AND "occurredAt" < ${epochMsParam(r.to)}
       GROUP BY "branchId"`);
    return rows.map((x) => ({ branchId: x.b, orders: num(x.orders), revenue: num(x.revenue) }));
  }

  // Per branch: the latest qualifying purchase EVER (not limited to the period) and how many calendar days of the period had at least one purchase.
  async activity(r: RangeMs, offsetMinutes: number): Promise<{ branchId: string; lastAt: number; activeDays: number }[]> {
    const rows = await this.prisma.$queryRaw<{ b: string; lastAt: bigint | number; activeDays: bigint | number }[]>(Prisma.sql`
      WITH p AS (${PURCHASES})
      SELECT b, MAX(t) AS lastAt, COUNT(DISTINCT CASE WHEN t >= ${r.from} AND t < ${r.to} THEN ${dayExpr(offsetMinutes)} END) AS activeDays
        FROM p WHERE b IS NOT NULL GROUP BY b`);
    return rows.map((x) => ({ branchId: x.b, lastAt: num(x.lastAt), activeDays: num(x.activeDays) }));
  }

  // The product with the most units sold at each branch in the period (paid CUP units + imported POS lines with a mapped product — Analytics V1's item
  // rules). Ties: revenue, then product name. One row per branch; it is a factual "most units", never a ranking of branches.
  async topProductPerBranch(r: RangeMs): Promise<{ branchId: string; productId: string; quantity: number; revenue: number }[]> {
    const rows = await this.prisma.$queryRaw<{ b: string; pid: string; q: bigint | number; rev: bigint | number }[]>(Prisma.sql`
      WITH it AS (
        SELECT o."branchId" AS b, i."productId" AS pid, SUM(i."quantity") AS q, SUM(i."totalPriceMinor") AS rev
          FROM "order_items" i JOIN "orders" o ON o."id" = i."orderId"
         WHERE i."isRewardItem" = 0 AND o."status" IN (${Prisma.join(ORDER_STATUSES)}) AND o."branchId" IS NOT NULL AND o."createdAt" >= ${epochMsParam(r.from)} AND o."createdAt" < ${epochMsParam(r.to)}
         GROUP BY o."branchId", i."productId"
        UNION ALL
        SELECT t."branchId", i."productId", SUM(i."quantity"), SUM(i."posterPayedSumMinor")
          FROM "poster_imported_transaction_items" i JOIN "poster_imported_transactions" t ON t."id" = i."transactionId"
         WHERE i."productId" IS NOT NULL AND t."status" = 'IMPORTED' AND t."occurredAt" >= ${epochMsParam(r.from)} AND t."occurredAt" < ${epochMsParam(r.to)}
         GROUP BY t."branchId", i."productId"
      ), m AS (SELECT b, pid, SUM(q) AS q, SUM(rev) AS rev FROM it GROUP BY b, pid),
      k AS (SELECT m.b AS b, m.pid AS pid, m.q AS q, m.rev AS rev, ROW_NUMBER() OVER (PARTITION BY m.b ORDER BY m.q DESC, m.rev DESC, pr."name", m.pid) AS rn
              FROM m JOIN "products" pr ON pr."id" = m.pid)
      SELECT b, pid, q, rev FROM k WHERE rn = 1`);
    return rows.map((x) => ({ branchId: x.b, productId: x.pid, quantity: num(x.q), revenue: num(x.rev) }));
  }

  async productInfo(ids: string[]): Promise<Map<string, { name: string; categoryId: string; categoryName: string }>> {
    const out = new Map<string, { name: string; categoryId: string; categoryName: string }>();
    for (let i = 0; i < ids.length; i += 500) {
      const rows = await this.prisma.product.findMany({ where: { id: { in: ids.slice(i, i + 500) } }, select: { id: true, name: true, categoryId: true, category: { select: { name: true } } } });
      for (const p of rows) out.set(p.id, { name: p.name, categoryId: p.categoryId, categoryName: p.category.name });
    }
    return out;
  }

  // ---------------------------------------------------------------------------------------------------------------- single-branch detail

  // Orders / revenue / DISTINCT customers per business day at ONE branch (both sources). Only days with activity are returned; the service zero-fills.
  async dailySeries(r: RangeMs, offsetMinutes: number, branchId: string): Promise<{ day: string; orders: number; revenue: number; customers: number }[]> {
    const rows = await this.prisma.$queryRaw<{ day: string; orders: bigint | number; revenue: bigint | number; customers: bigint | number }[]>(Prisma.sql`
      WITH p AS (${PURCHASES})
      SELECT ${dayExpr(offsetMinutes)} AS day, COUNT(*) AS orders, SUM(a) AS revenue, COUNT(DISTINCT c) AS customers
        FROM p WHERE b = ${branchId} AND t >= ${r.from} AND t < ${r.to} GROUP BY day`);
    return rows.map((x) => ({ day: x.day, orders: num(x.orders), revenue: num(x.revenue), customers: num(x.customers) }));
  }

  // The customers who purchased at the branch in the period (used only for the customer-level reward availability figure).
  // c IS NOT NULL: an anonymous POS purchase (Phase 19) has no customer to check reward availability for — without
  // this filter, a NULL slipped into the caller's customerId list and crashed a downstream Prisma `in` query (found
  // during Reports Phase B1, 2026-09-24). Consistent with the same exclusion AnalyticsRepository.posCustomerIds() already applies.
  async customerIdsAtBranch(r: RangeMs, branchId: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ c: string }[]>(Prisma.sql`WITH p AS (${PURCHASES}) SELECT DISTINCT c FROM p WHERE b = ${branchId} AND t >= ${r.from} AND t < ${r.to} AND c IS NOT NULL`);
    return rows.map((x) => x.c);
  }

  // Of the customers who purchased at the branch in the period, how many already hold a loyalty account (an account exists once they opened Loyalty or earned).
  async customersWithLoyaltyAccount(r: RangeMs, branchId: string): Promise<number> {
    const [x] = await this.prisma.$queryRaw<{ n: bigint | number }[]>(Prisma.sql`
      WITH p AS (${PURCHASES}) SELECT COUNT(DISTINCT p.c) AS n FROM p JOIN "loyalty_accounts" la ON la."customerId" = p.c WHERE p.b = ${branchId} AND p.t >= ${r.from} AND p.t < ${r.to}`);
    return num(x?.n);
  }

  // Points ledger rows that carry an orderId (=> the order's branch) versus rows that do not. Only the ORDER's own branch is used; a row with no orderId is
  // never given a branch (welcome bonus, promotion / achievement / referral points, adjustments, POS-source earnings recorded without an order).
  async pointsLedger(r: RangeMs, branchId: string): Promise<{ attributed: { earned: number; spent: number; rows: number }; unattributed: { earned: number; spent: number; rows: number } }> {
    const shape = (x?: Record<string, bigint | number | string | null>) => ({ earned: num(x?.earned), spent: Math.abs(num(x?.spent)), rows: num(x?.rows) });
    const [a] = await this.prisma.$queryRaw<Record<string, bigint | number | string | null>[]>(Prisma.sql`
      SELECT SUM(CASE WHEN lt."points" > 0 THEN lt."points" ELSE 0 END) AS earned, SUM(CASE WHEN lt."points" < 0 THEN lt."points" ELSE 0 END) AS spent, COUNT(*) AS rows
        FROM "loyalty_transactions" lt JOIN "orders" o ON o."id" = lt."orderId"
       WHERE o."branchId" = ${branchId} AND lt."createdAt" >= ${epochMsParam(r.from)} AND lt."createdAt" < ${epochMsParam(r.to)}`);
    const [u] = await this.prisma.$queryRaw<Record<string, bigint | number | string | null>[]>(Prisma.sql`
      SELECT SUM(CASE WHEN "points" > 0 THEN "points" ELSE 0 END) AS earned, SUM(CASE WHEN "points" < 0 THEN "points" ELSE 0 END) AS spent, COUNT(*) AS rows
        FROM "loyalty_transactions" WHERE "orderId" IS NULL AND "createdAt" >= ${epochMsParam(r.from)} AND "createdAt" < ${epochMsParam(r.to)}`);
    return { attributed: shape(a), unattributed: shape(u) };
  }

  // Loyalty 2.0 accruals whose SOURCE PURCHASE (CUP order or imported POS purchase) is at the branch and inside the period — reliable attribution for both
  // sources — plus the cashback credited for those purchases.
  async loyalty2Accruals(r: RangeMs, branchId: string): Promise<{ purchases: number; members: number; pointsAwarded: number; cashbackEarned: number }> {
    const src = Prisma.sql`SELECT 'CUP_ORDER' AS st, "id" AS id, "branchId" AS b, ${epochMsCastSql('"createdAt"')} AS t FROM "orders"
                           UNION ALL SELECT 'POS', "id", "branchId", ${epochMsCastSql('"occurredAt"')} FROM "poster_imported_transactions"`;
    const [a] = await this.prisma.$queryRaw<Record<string, bigint | number | string | null>[]>(Prisma.sql`
      WITH s AS (${src})
      SELECT COUNT(*) AS purchases, COUNT(DISTINCT a."customerId") AS members, SUM(a."pointsAwarded") AS pts
        FROM "loyalty_accruals" a JOIN s ON s.st = a."sourceType" AND s.id = a."sourceId"
       WHERE s.b = ${branchId} AND s.t >= ${r.from} AND s.t < ${r.to}`);
    const [c] = await this.prisma.$queryRaw<Record<string, bigint | number | string | null>[]>(Prisma.sql`
      WITH s AS (${src})
      SELECT SUM(ct."amountMinor") AS cash FROM "cashback_transactions" ct JOIN s ON s.st = ct."sourceType" AND s.id = ct."sourceId"
       WHERE ct."type" = 'EARN' AND s.b = ${branchId} AND s.t >= ${r.from} AND s.t < ${r.to}`);
    return { purchases: num(a?.purchases), members: num(a?.members), pointsAwarded: num(a?.pts), cashbackEarned: num(c?.cash) };
  }

  // Reward redemptions made on an order at the branch (the redemption's own order -> branch) versus redemptions with no order.
  async rewardRedemptions(r: RangeMs, branchId: string): Promise<{ byProgram: { name: string; count: number }[]; unattributed: number }> {
    const by = await this.prisma.$queryRaw<{ name: string; n: bigint | number }[]>(Prisma.sql`
      SELECT rp."name" AS name, COUNT(*) AS n FROM "reward_redemptions" rr JOIN "orders" o ON o."id" = rr."orderId" JOIN "reward_programs" rp ON rp."id" = rr."rewardProgramId"
       WHERE o."branchId" = ${branchId} AND rr."redeemedAt" >= ${epochMsParam(r.from)} AND rr."redeemedAt" < ${epochMsParam(r.to)} GROUP BY rp."name" ORDER BY rp."name"`);
    const [u] = await this.prisma.$queryRaw<{ n: bigint | number }[]>(Prisma.sql`SELECT COUNT(*) AS n FROM "reward_redemptions" WHERE "orderId" IS NULL AND "redeemedAt" >= ${epochMsParam(r.from)} AND "redeemedAt" < ${epochMsParam(r.to)}`);
    return { byProgram: by.map((x) => ({ name: x.name, count: num(x.n) })), unattributed: num(u?.n) };
  }

  async promotionRedemptions(r: RangeMs, branchId: string): Promise<{ byPromotion: { name: string; count: number }[]; unattributed: number }> {
    const by = await this.prisma.$queryRaw<{ name: string; n: bigint | number }[]>(Prisma.sql`
      SELECT p."name" AS name, COUNT(*) AS n FROM "promotion_redemptions" pr JOIN "orders" o ON o."id" = pr."orderId" JOIN "promotions" p ON p."id" = pr."promotionId"
       WHERE o."branchId" = ${branchId} AND pr."redeemedAt" >= ${epochMsParam(r.from)} AND pr."redeemedAt" < ${epochMsParam(r.to)} GROUP BY p."name" ORDER BY p."name"`);
    const [u] = await this.prisma.$queryRaw<{ n: bigint | number }[]>(Prisma.sql`SELECT COUNT(*) AS n FROM "promotion_redemptions" WHERE "orderId" IS NULL AND "redeemedAt" >= ${epochMsParam(r.from)} AND "redeemedAt" < ${epochMsParam(r.to)}`);
    return { byPromotion: by.map((x) => ({ name: x.name, count: num(x.n) })), unattributed: num(u?.n) };
  }

  // Referrals that QUALIFIED in the period, attributed through the qualifying PURCHASE (its key names a CUP order or a POS purchase, whose own branch is used).
  async referrals(r: RangeMs, branchId: string): Promise<{ qualifiedHere: number; rewardedHere: number; qualifiedTotal: number }> {
    const rows = await this.prisma.$queryRaw<{ status: string; n: bigint | number }[]>(Prisma.sql`
      SELECT status, COUNT(*) AS n FROM (
        SELECT r."status" AS status FROM "referrals" r JOIN "orders" o ON o."id" = substr(r."qualifyingPurchaseKey", 11)
         WHERE r."qualifyingPurchaseKey" LIKE 'CUP_ORDER:%' AND r."status" IN ('QUALIFIED', 'REWARDED') AND r."qualifiedAt" >= ${epochMsParam(r.from)} AND r."qualifiedAt" < ${epochMsParam(r.to)} AND o."branchId" = ${branchId}
        UNION ALL
        SELECT r."status" FROM "referrals" r JOIN "poster_imported_transactions" t ON t."id" = substr(r."qualifyingPurchaseKey", 5)
         WHERE r."qualifyingPurchaseKey" LIKE 'POS:%' AND r."status" IN ('QUALIFIED', 'REWARDED') AND r."qualifiedAt" >= ${epochMsParam(r.from)} AND r."qualifiedAt" < ${epochMsParam(r.to)} AND t."branchId" = ${branchId}
      ) GROUP BY status`);
    const [t] = await this.prisma.$queryRaw<{ n: bigint | number }[]>(Prisma.sql`
      SELECT COUNT(*) AS n FROM "referrals" WHERE "status" IN ('QUALIFIED', 'REWARDED') AND "qualifiedAt" >= ${epochMsParam(r.from)} AND "qualifiedAt" < ${epochMsParam(r.to)}`);
    const at = (s: string) => num(rows.find((x) => x.status === s)?.n);
    return { qualifiedHere: at('QUALIFIED') + at('REWARDED'), rewardedHere: at('REWARDED'), qualifiedTotal: num(t?.n) };
  }
}
