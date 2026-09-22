import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

export type WebhookEventStatus = 'QUEUED' | 'PROCESSING' | 'DONE' | 'DEAD';

export interface NewWebhookEvent {
  dedupeKey: string;
  object: string;
  objectId: string;
  action: string;
  eventAt: Date;
  account: string;
}

export interface WebhookEventRow {
  id: string;
  object: string;
  objectId: string;
  action: string;
  eventAt: Date;
  attempts: number;
}

const isUnique = (err: unknown): boolean => !!err && typeof err === 'object' && (err as { code?: string }).code === 'P2002';

// Phase 20 — persistence for the webhook queue. Every state change is a compare-and-set on the row's current status, so two workers (or a crash in the
// middle of a tick) can never process the same event twice or lose one: a QUEUED row is claimed atomically, a PROCESSING row carries a lease that is
// reclaimed if its owner died, and only DONE / DEAD are terminal.
@Injectable()
export class PosterSyncRepository {
  constructor(private readonly prisma: PrismaService) {}

  // Durable, idempotent record of ONE delivery. A retry of the same delivery only bumps `deliveries`. Returns whether a new row was created.
  async recordDelivery(event: NewWebhookEvent): Promise<{ created: boolean; id: string }> {
    try {
      const row = await this.prisma.posterWebhookEvent.create({ data: event, select: { id: true } });
      return { created: true, id: row.id };
    } catch (err) {
      if (!isUnique(err)) throw err;
      const row = await this.prisma.posterWebhookEvent.update({
        where: { dedupeKey: event.dedupeKey },
        data: { deliveries: { increment: 1 }, lastDeliveredAt: new Date() },
        select: { id: true },
      });
      return { created: false, id: row.id };
    }
  }

  // Crash recovery: a PROCESSING row whose lease is older than `leaseMs` goes back to the queue (its owner is gone). Returns how many were reclaimed.
  async reclaimStale(now: Date, leaseMs: number): Promise<number> {
    const res = await this.prisma.posterWebhookEvent.updateMany({
      where: { status: 'PROCESSING', lockedAt: { lt: new Date(now.getTime() - leaseMs) } },
      data: { status: 'QUEUED', lockedAt: null },
    });
    return res.count;
  }

  // Claims up to `limit` due events, oldest first. Each claim is its own compare-and-set, so a concurrent worker simply wins some rows and we win others.
  async claimDue(now: Date, limit: number): Promise<WebhookEventRow[]> {
    const due = await this.prisma.posterWebhookEvent.findMany({
      where: { status: 'QUEUED', nextAttemptAt: { lte: now } },
      orderBy: [{ nextAttemptAt: 'asc' }, { receivedAt: 'asc' }],
      take: limit,
      select: { id: true, object: true, objectId: true, action: true, eventAt: true, attempts: true },
    });
    const claimed: WebhookEventRow[] = [];
    for (const row of due) {
      const won = await this.prisma.posterWebhookEvent.updateMany({ where: { id: row.id, status: 'QUEUED' }, data: { status: 'PROCESSING', lockedAt: now } });
      if (won.count === 1) claimed.push(row);
    }
    return claimed;
  }

  // Terminal success (including a deliberate "nothing to import" outcome).
  complete(ids: string[], outcome: string, now: Date) {
    return this.prisma.posterWebhookEvent.updateMany({ where: { id: { in: ids }, status: 'PROCESSING' }, data: { status: 'DONE', outcome, lastError: null, lockedAt: null, processedAt: now } });
  }

  // Back to the queue WITHOUT counting a failure (a settling delay, or work skipped because Poster was unreachable earlier in the same tick).
  release(ids: string[], nextAttemptAt: Date, outcome: string | null) {
    return this.prisma.posterWebhookEvent.updateMany({ where: { id: { in: ids }, status: 'PROCESSING' }, data: { status: 'QUEUED', lockedAt: null, nextAttemptAt, outcome } });
  }

  // A failed attempt: retry later with backoff, or DEAD once the attempts are exhausted (visible in Admin, retried manually).
  async fail(ids: string[], error: string, nextAttemptAt: Date | null): Promise<void> {
    const message = error.slice(0, 240);
    if (nextAttemptAt) {
      await this.prisma.posterWebhookEvent.updateMany({ where: { id: { in: ids }, status: 'PROCESSING' }, data: { status: 'QUEUED', lockedAt: null, attempts: { increment: 1 }, lastError: message, nextAttemptAt } });
    } else {
      await this.prisma.posterWebhookEvent.updateMany({ where: { id: { in: ids }, status: 'PROCESSING' }, data: { status: 'DEAD', lockedAt: null, attempts: { increment: 1 }, lastError: message, processedAt: new Date() } });
    }
  }

  // Manual retry of a DEAD event (Admin). Only DEAD rows move; the row keeps its history (deliveries, receivedAt).
  async requeueDead(id: string, now: Date): Promise<boolean> {
    const res = await this.prisma.posterWebhookEvent.updateMany({ where: { id, status: 'DEAD' }, data: { status: 'QUEUED', attempts: 0, nextAttemptAt: now, lockedAt: null, lastError: null, outcome: null } });
    return res.count === 1;
  }

  // Which of these Poster transaction ids are already IMPORTED / UNRESOLVED in CUP (used for the "removed in Poster" warning).
  async importedStatuses(posterTransactionIds: string[]): Promise<Map<string, string>> {
    if (posterTransactionIds.length === 0) return new Map();
    const rows = await this.prisma.posterImportedTransaction.findMany({ where: { posterTransactionId: { in: posterTransactionIds } }, select: { posterTransactionId: true, status: true } });
    return new Map(rows.map((r) => [r.posterTransactionId, r.status]));
  }

  // Of these transaction ids, the ones a webhook was ever received for (reconciliation uses it to spot a MISSED webhook).
  async idsWithWebhook(posterTransactionIds: string[]): Promise<Set<string>> {
    if (posterTransactionIds.length === 0) return new Set();
    const rows = await this.prisma.posterWebhookEvent.findMany({ where: { object: 'transaction', objectId: { in: posterTransactionIds } }, select: { objectId: true }, distinct: ['objectId'] });
    return new Set(rows.map((r) => r.objectId));
  }

  async stats(now: Date) {
    const since = new Date(now.getTime() - 24 * 3600 * 1000);
    const [byStatus, oldestQueued, lastReceived, lastProcessed, received24h, dup24h, outcomes24h, removedImported, deadRows] = await Promise.all([
      this.prisma.posterWebhookEvent.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.posterWebhookEvent.findFirst({ where: { status: 'QUEUED' }, orderBy: { nextAttemptAt: 'asc' }, select: { nextAttemptAt: true, receivedAt: true } }),
      this.prisma.posterWebhookEvent.aggregate({ _max: { lastDeliveredAt: true } }),
      this.prisma.posterWebhookEvent.aggregate({ where: { status: 'DONE' }, _max: { processedAt: true } }),
      this.prisma.posterWebhookEvent.count({ where: { receivedAt: { gte: since } } }),
      this.prisma.posterWebhookEvent.aggregate({ where: { receivedAt: { gte: since } }, _sum: { deliveries: true } }),
      this.prisma.posterWebhookEvent.groupBy({ by: ['outcome'], where: { status: 'DONE', processedAt: { gte: since } }, _count: { _all: true } }),
      this.prisma.posterWebhookEvent.findMany({ where: { outcome: 'REMOVED_IMPORTED' }, select: { objectId: true }, distinct: ['objectId'], take: 20 }),
      this.prisma.posterWebhookEvent.count({ where: { status: 'DEAD' } }),
    ]);
    const count = (s: string) => byStatus.find((r) => r.status === s)?._count._all ?? 0;
    return {
      queue: { queued: count('QUEUED'), processing: count('PROCESSING'), done: count('DONE'), dead: deadRows, oldestQueuedSince: oldestQueued?.nextAttemptAt ?? null },
      lastReceivedAt: lastReceived._max.lastDeliveredAt,
      lastProcessedAt: lastProcessed._max.processedAt,
      received24h,
      duplicateDeliveries24h: Math.max(0, (dup24h._sum.deliveries ?? 0) - received24h),
      outcomes24h: outcomes24h.map((o) => ({ outcome: o.outcome ?? 'UNKNOWN', count: o._count._all })),
      removedButImported: removedImported.map((r) => r.objectId),
    };
  }

  async list(filters: { status?: string; objectId?: string }, skip: number, take: number) {
    const where: Prisma.PosterWebhookEventWhereInput = { ...(filters.status ? { status: filters.status } : {}), ...(filters.objectId ? { objectId: filters.objectId } : {}) };
    const [total, rows] = await Promise.all([
      this.prisma.posterWebhookEvent.count({ where }),
      this.prisma.posterWebhookEvent.findMany({
        where,
        orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
        select: { id: true, object: true, objectId: true, action: true, eventAt: true, status: true, deliveries: true, attempts: true, nextAttemptAt: true, outcome: true, lastError: true, receivedAt: true, processedAt: true },
      }),
    ]);
    return { total, rows };
  }
}
