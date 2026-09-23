import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Db, PrismaService } from '../../common/prisma/prisma.service';
import { CUSTOMER_METRICS_ORDER_STATUSES } from '../customer-metrics/customer-metrics-order-statuses';
import { epochMsCastSql, monthDaySql } from '../../common/prisma/sql-dialect';

const STATUSES = [...CUSTOMER_METRICS_ORDER_STATUSES];
const num = (v: unknown): number => Number(v);

// Only Prisma / raw SQL for CRM automation lives here. Every stream read is BOUNDED (LIMIT) and resumes from a cursor, so no tick ever scans
// the whole customer base. Raw SQL casts DateTime columns to INTEGER (SQLite stores them as epoch milliseconds).

export interface EventCursor {
  t: number;
  src: string;
  id: string;
}

export interface PurchaseEventRow {
  t: number;
  src: 'C' | 'P';
  id: string;
  customerId: string;
  sourceKey: string; // CUP: Order.id, POS: posterTransactionId — the canonical identity
}

export interface CartRow {
  cartId: string;
  customerId: string;
  activityMs: number;
  itemCount: number;
}

export type AutomationWithRefs = Prisma.AutomationGetPayload<{ include: { campaign: { select: { id: true; name: true; status: true; channel: true; messageText: true } }; segment: { select: { id: true; name: true } } } }>;

const INCLUDE = { campaign: { select: { id: true, name: true, status: true, channel: true, messageText: true } }, segment: { select: { id: true, name: true } } } as const;

@Injectable()
export class AutomationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ------------------------------------------------------------------------------------------------------ automations

  findById(id: string): Promise<AutomationWithRefs | null> {
    return this.prisma.automation.findUnique({ where: { id }, include: INCLUDE });
  }

  findMany(options: { cursor?: string; take: number }) {
    return this.prisma.automation.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: options.take,
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
      include: INCLUDE,
    });
  }

  findActive(): Promise<AutomationWithRefs[]> {
    return this.prisma.automation.findMany({ where: { status: 'ACTIVE' }, orderBy: { createdAt: 'asc' }, include: INCLUDE });
  }

  create(data: Prisma.AutomationUncheckedCreateInput) {
    return this.prisma.automation.create({ data, include: INCLUDE });
  }

  update(id: string, data: Prisma.AutomationUncheckedUpdateInput) {
    return this.prisma.automation.update({ where: { id }, data, include: INCLUDE });
  }

  // Compare-and-set claims: exactly one caller wins, whatever the number of runners.
  async claimRunKey(id: string, runKey: string): Promise<boolean> {
    const r = await this.prisma.automation.updateMany({ where: { id, OR: [{ lastRunKey: null }, { lastRunKey: { not: runKey } }] }, data: { lastRunKey: runKey } });
    return r.count === 1;
  }

  async advanceCursor(id: string, expected: string | null, next: string): Promise<boolean> {
    const r = await this.prisma.automation.updateMany({ where: { id, eventCursor: expected }, data: { eventCursor: next } });
    return r.count === 1;
  }

  touchRun(id: string) {
    return this.prisma.automation.update({ where: { id }, data: { lastRunAt: new Date() } });
  }

  async executionStats(automationId: string): Promise<Record<string, number>> {
    const rows = await this.prisma.automationExecution.groupBy({ by: ['status'], where: { automationId }, _count: { _all: true } });
    return Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
  }

  async hasExecutions(automationId: string): Promise<boolean> {
    return (await this.prisma.automationExecution.count({ where: { automationId } })) > 0;
  }

  // ------------------------------------------------------------------------------------------------------ executions

  createExecution(data: Prisma.AutomationExecutionUncheckedCreateInput) {
    return this.prisma.automationExecution.create({ data });
  }

  async existingTriggerKeys(automationId: string, keys: string[]): Promise<Set<string>> {
    if (keys.length === 0) return new Set();
    const rows = await this.prisma.automationExecution.findMany({ where: { automationId, triggerKey: { in: keys } }, select: { triggerKey: true } });
    return new Set(rows.map((r) => r.triggerKey));
  }

  listExecutions(automationId: string, options: { cursor?: string; take: number }) {
    return this.prisma.automationExecution.findMany({
      where: { automationId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: options.take,
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
      select: { id: true, status: true, reason: true, createdAt: true, sentAt: true, errorCode: true, customer: { select: { displayName: true } }, automation: { select: { triggerType: true, campaign: { select: { name: true } } } } },
    });
  }

  recentForCustomer(customerId: string, take: number) {
    return this.prisma.automationExecution.findMany({
      where: { customerId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
      select: { status: true, reason: true, createdAt: true, sentAt: true, automation: { select: { name: true, triggerType: true } } },
    });
  }

  // A reservation slot exists for this execution => a send was ATTEMPTED (or is about to be); it must never be retried.
  async hasReservation(executionId: string): Promise<boolean> {
    return (await this.prisma.automationSendSlot.count({ where: { executionId } })) > 0;
  }

  // Undo a claim after a TRANSIENT failure that happened before any reservation, so the row is simply retried on the next tick.
  releaseClaim(id: string) {
    return this.prisma.automationExecution.updateMany({ where: { id, status: 'PENDING' }, data: { claimedAt: null } });
  }

  // PENDING rows that are due (delay / quiet hours elapsed) and not yet claimed, oldest first. Bounded.
  findDuePending(now: Date, take: number) {
    return this.prisma.automationExecution.findMany({
      where: { status: 'PENDING', claimedAt: null, OR: [{ notBeforeAt: null }, { notBeforeAt: { lte: now } }] },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take,
    });
  }

  // Atomic claim: only one runner ever gets count === 1 for a given row.
  async claim(id: string): Promise<boolean> {
    const r = await this.prisma.automationExecution.updateMany({ where: { id, status: 'PENDING', claimedAt: null }, data: { claimedAt: new Date() } });
    return r.count === 1;
  }

  // Claimed rows that never finished (a crash between claim and outcome) — swept to FAILED so they are never re-sent.
  async sweepStaleClaims(olderThan: Date): Promise<number> {
    const r = await this.prisma.automationExecution.updateMany({ where: { status: 'PENDING', claimedAt: { lt: olderThan } }, data: { status: 'FAILED', errorCode: 'interrupted', decidedAt: new Date() } });
    return r.count;
  }

  markSkipped(id: string, reason: string) {
    return this.prisma.automationExecution.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'SKIPPED', reason, decidedAt: new Date() } });
  }

  markSent(id: string, telegramMessageId: string) {
    return this.prisma.automationExecution.update({ where: { id }, data: { status: 'SENT', telegramMessageId, decidedAt: new Date(), sentAt: new Date() } });
  }

  markFailed(id: string, errorCode: string) {
    return this.prisma.automationExecution.update({ where: { id }, data: { status: 'FAILED', errorCode, decidedAt: new Date() } });
  }

  // ------------------------------------------------------------------------------------------------- reservation ledgers

  lastSendSlot(db: Db, automationId: string, customerId: string) {
    return db.automationSendSlot.findFirst({ where: { automationId, customerId }, orderBy: { ordinal: 'desc' } });
  }

  createSendSlot(db: Db, data: { automationId: string; customerId: string; ordinal: number; executionId: string; createdAt: Date }) {
    return db.automationSendSlot.create({ data });
  }

  async usedDailySlots(db: Db, customerId: string, dayKey: string): Promise<Set<number>> {
    const rows = await db.crmDailySlot.findMany({ where: { customerId, dayKey }, select: { slot: true } });
    return new Set(rows.map((r) => r.slot));
  }

  createDailySlot(db: Db, data: { customerId: string; dayKey: string; slot: number; executionId: string; createdAt: Date }) {
    return db.crmDailySlot.create({ data });
  }

  // Read-only counters for the preview (never reserve anything).
  async sendSlotSnapshot(automationId: string, customerIds: string[]): Promise<Map<string, { count: number; lastAt: Date | null }>> {
    const rows = await this.prisma.automationSendSlot.groupBy({ by: ['customerId'], where: { automationId, customerId: { in: customerIds } }, _count: { _all: true }, _max: { createdAt: true } });
    return new Map(rows.map((r) => [r.customerId, { count: r._count._all, lastAt: r._max.createdAt }]));
  }

  async dailySlotCounts(customerIds: string[], dayKey: string): Promise<Map<string, number>> {
    const rows = await this.prisma.crmDailySlot.groupBy({ by: ['customerId'], where: { customerId: { in: customerIds }, dayKey }, _count: { _all: true } });
    return new Map(rows.map((r) => [r.customerId, r._count._all]));
  }

  // ------------------------------------------------------------------------------------------------------ customers

  async telegramChatIds(customerIds: string[]): Promise<Map<string, string>> {
    if (customerIds.length === 0) return new Map();
    const rows = await this.prisma.telegramAccount.findMany({ where: { customerId: { in: customerIds } }, select: { customerId: true, chatId: true } });
    return new Map(rows.map((r) => [r.customerId, r.chatId]));
  }

  async customerNames(customerIds: string[]): Promise<Map<string, { displayName: string | null; firstName: string | null }>> {
    if (customerIds.length === 0) return new Map();
    const rows = await this.prisma.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, displayName: true, telegramAccount: { select: { firstName: true } } } });
    return new Map(rows.map((r) => [r.id, { displayName: r.displayName, firstName: r.telegramAccount?.firstName ?? null }]));
  }

  findRewardProgram(id: string) {
    return this.prisma.rewardProgram.findUnique({ where: { id }, select: { id: true, name: true, buyQuantity: true, qualifyingCategoryId: true } });
  }

  // ------------------------------------------------------------------------------------- purchase event stream (canonical)

  // PURCHASE_COMPLETED stream: qualifying CUP orders (event time = createdAt) and IMPORTED POS purchases (event time = importedAt, the moment CUP
  // learned of the sale, so a late import is a NEW event). Strictly after `cursor`, within [sinceMs, untilMs], ordered (t, src, id), bounded.
  async purchaseEventsAfter(cursor: EventCursor | null, sinceMs: number, untilMs: number, limit: number): Promise<PurchaseEventRow[]> {
    const after = cursor ? Prisma.sql`AND (t > ${cursor.t} OR (t = ${cursor.t} AND (src > ${cursor.src} OR (src = ${cursor.src} AND id > ${cursor.id}))))` : Prisma.empty;
    const rows = await this.prisma.$queryRaw<{ t: bigint | number; src: string; id: string; customerId: string; sourceKey: string }[]>(Prisma.sql`
      SELECT t, src, id, customerId, sourceKey FROM (
        SELECT ${epochMsCastSql('"createdAt"')} AS t, 'C' AS src, "id" AS id, "customerId" AS customerId, "id" AS sourceKey
          FROM "orders" WHERE "status" IN (${Prisma.join(STATUSES)})
        UNION ALL
        SELECT ${epochMsCastSql('"importedAt"')} AS t, 'P' AS src, "id" AS id, "customerId" AS customerId, "posterTransactionId" AS sourceKey
          FROM "poster_imported_transactions" WHERE "status" = 'IMPORTED'
      ) WHERE t >= ${sinceMs} AND t <= ${untilMs} ${after} ORDER BY t, src, id LIMIT ${limit}`);
    return rows.map((r) => ({ t: num(r.t), src: r.src as 'C' | 'P', id: r.id, customerId: r.customerId, sourceKey: r.sourceKey }));
  }

  // Earliest qualifying purchase time (same event-time definition as the stream) per customer — FIRST_PURCHASE.
  async firstPurchaseTimes(customerIds: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (customerIds.length === 0) return out;
    const [cup, pos] = await Promise.all([
      this.prisma.order.groupBy({ by: ['customerId'], where: { customerId: { in: customerIds }, status: { in: STATUSES } }, _min: { createdAt: true } }),
      this.prisma.posterImportedTransaction.groupBy({ by: ['customerId'], where: { customerId: { in: customerIds }, status: 'IMPORTED' }, _min: { importedAt: true } }),
    ]);
    for (const r of cup) if (r._min.createdAt) out.set(r.customerId, r._min.createdAt.getTime());
    for (const r of pos) if (r._min.importedAt) out.set(r.customerId, Math.min(out.get(r.customerId) ?? Infinity, r._min.importedAt.getTime()));
    return out;
  }

  // Lifetime qualifying spend per customer up to an instant (CUP by createdAt, POS by importedAt) — the Analytics / Customer 360 definition.
  async spendUpTo(customerIds: string[], upTo?: Date): Promise<Map<string, number>> {
    const out = new Map<string, number>(customerIds.map((id) => [id, 0]));
    if (customerIds.length === 0) return out;
    const [cup, pos] = await Promise.all([
      this.prisma.order.groupBy({ by: ['customerId'], where: { customerId: { in: customerIds }, status: { in: STATUSES }, ...(upTo ? { createdAt: { lte: upTo } } : {}) }, _sum: { totalMinor: true } }),
      this.prisma.posterImportedTransaction.groupBy({ by: ['customerId'], where: { customerId: { in: customerIds }, status: 'IMPORTED', ...(upTo ? { importedAt: { lte: upTo } } : {}) }, _sum: { totalMinor: true } }),
    ]);
    for (const r of cup) out.set(r.customerId, (out.get(r.customerId) ?? 0) + (r._sum.totalMinor ?? 0));
    for (const r of pos) out.set(r.customerId, (out.get(r.customerId) ?? 0) + (r._sum.totalMinor ?? 0));
    return out;
  }

  async redemptionCountsUpTo(customerIds: string[], upTo?: Date): Promise<Map<string, number>> {
    const out = new Map<string, number>(customerIds.map((id) => [id, 0]));
    if (customerIds.length === 0) return out;
    const rows = await this.prisma.rewardRedemption.groupBy({ by: ['customerId'], where: { customerId: { in: customerIds }, ...(upTo ? { redeemedAt: { lte: upTo } } : {}) }, _count: { _all: true } });
    for (const r of rows) out.set(r.customerId, r._count._all);
    return out;
  }

  // ------------------------------------------------------------------------------------------------ other bounded streams

  // Customers whose LAST qualifying purchase (real purchase time) lies in (afterMs, beforeMs], oldest first, cursor (lastAt, customerId).
  async lastPurchaseBetween(afterMs: number, beforeMs: number, cursor: { t: number; id: string } | null, limit: number): Promise<{ customerId: string; lastAt: number }[]> {
    const after = cursor ? Prisma.sql`AND (lastAt > ${cursor.t} OR (lastAt = ${cursor.t} AND customerId > ${cursor.id}))` : Prisma.empty;
    const rows = await this.prisma.$queryRaw<{ customerId: string; lastAt: bigint | number }[]>(Prisma.sql`
      SELECT customerId, lastAt FROM (
        SELECT customerId, MAX(t) AS lastAt FROM (
          SELECT "customerId" AS customerId, ${epochMsCastSql('"createdAt"')} AS t FROM "orders" WHERE "status" IN (${Prisma.join(STATUSES)})
          UNION ALL
          SELECT "customerId" AS customerId, ${epochMsCastSql('"occurredAt"')} AS t FROM "poster_imported_transactions" WHERE "status" = 'IMPORTED'
        ) GROUP BY customerId
      ) WHERE lastAt > ${afterMs} AND lastAt <= ${beforeMs} ${after} ORDER BY lastAt, customerId LIMIT ${limit}`);
    return rows.map((r) => ({ customerId: r.customerId, lastAt: num(r.lastAt) }));
  }

  async lastPurchaseAt(customerId: string): Promise<number | null> {
    const [cup, pos] = await Promise.all([
      this.prisma.order.aggregate({ where: { customerId, status: { in: STATUSES } }, _max: { createdAt: true } }),
      this.prisma.posterImportedTransaction.aggregate({ where: { customerId, status: 'IMPORTED' }, _max: { occurredAt: true } }),
    ]);
    const values = [cup._max.createdAt?.getTime(), pos._max.occurredAt?.getTime()].filter((v): v is number => v !== undefined);
    return values.length ? Math.max(...values) : null;
  }

  // Birthday candidates: customers with a birthDate whose (UTC) month-day is in `monthDays`, ordered by id, after `afterId`, bounded.
  // Phase 26: "isActive" excludes deactivated customers — never a new BIRTHDAY automation trigger for them.
  async birthdayCustomers(monthDays: string[], afterId: string | null, limit: number): Promise<{ id: string; birthDate: Date }[]> {
    const rows = await this.prisma.$queryRaw<{ id: string; birthDate: bigint | number }[]>(Prisma.sql`
      SELECT "id" AS id, ${epochMsCastSql('"birthDate"')} AS birthDate FROM "customers"
      WHERE "isActive" = true AND "birthDate" IS NOT NULL AND ${monthDaySql('"birthDate"')} IN (${Prisma.join(monthDays)})
      ${afterId ? Prisma.sql`AND "id" > ${afterId}` : Prisma.empty} ORDER BY "id" LIMIT ${limit}`);
    return rows.map((r) => ({ id: r.id, birthDate: new Date(num(r.birthDate)) }));
  }

  // Carts with at least one item and no checkout in flight, whose last meaningful activity (max of Cart.updatedAt and its items' addedAt —
  // the same definition CartService uses for expiry) lies in (afterMs, beforeMs], oldest first, cursor (activity, cartId), bounded.
  async cartsInactiveBetween(afterMs: number, beforeMs: number, cursor: { t: number; id: string } | null, limit: number, onlyCartId?: string): Promise<CartRow[]> {
    const after = cursor ? Prisma.sql`AND (act > ${cursor.t} OR (act = ${cursor.t} AND cartId > ${cursor.id}))` : Prisma.empty;
    const only = onlyCartId ? Prisma.sql`AND cartId = ${onlyCartId}` : Prisma.empty;
    const rows = await this.prisma.$queryRaw<{ cartId: string; customerId: string; act: bigint | number; n: bigint | number }[]>(Prisma.sql`
      SELECT cartId, customerId, act, n FROM (
        SELECT c."id" AS cartId, c."customerId" AS customerId,
               CASE WHEN ${epochMsCastSql('c."updatedAt"')} > MAX(${epochMsCastSql('i."addedAt"')}) THEN ${epochMsCastSql('c."updatedAt"')} ELSE MAX(${epochMsCastSql('i."addedAt"')}) END AS act,
               COUNT(i."id") AS n
        FROM "carts" c JOIN "cart_items" i ON i."cartId" = c."id" WHERE c."checkoutLockedAt" IS NULL GROUP BY c."id"
      ) WHERE act > ${afterMs} AND act <= ${beforeMs} ${after} ${only} ORDER BY act, cartId LIMIT ${limit}`);
    return rows.map((r) => ({ cartId: r.cartId, customerId: r.customerId, activityMs: num(r.act), itemCount: num(r.n) }));
  }

  async cartStateOf(customerId: string): Promise<CartRow | null> {
    const cart = await this.prisma.cart.findUnique({ where: { customerId }, select: { id: true } });
    if (!cart) return null;
    const rows = await this.cartsInactiveBetween(0, Number.MAX_SAFE_INTEGER, null, 1, cart.id);
    return rows[0] ?? null;
  }

}
