import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface ImportedTransactionData {
  posterTransactionId: string;
  posterClientId: string | null;
  customerId: string | null;
  branchId: string;
  posterSpotId: number;
  status: 'IMPORTED' | 'UNRESOLVED';
  unresolvedReason: string | null;
  posterStatus: string;
  posterPayType: string;
  occurredAt: Date;
  totalMinor: number;
  paidMinor: number;
  items: {
    lineIndex: number;
    posterProductId: string;
    productId: string | null;
    quantity: number;
    posterProductPriceMinor: number;
    posterPayedSumMinor: number;
  }[];
}

// Phase 11.2 — persistence + the bulk read lookups the import needs. Reads Customer/Branch/Product/Order directly
// (one bounded query each, never per row) so the import stays a handful of queries regardless of window size.
export interface SubscriptionLineRef {
  id: string;
  posterProductId: string;
  status: string;
  reconciliationStatus: string | null;
}

@Injectable()
export class PosterImportRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findExisting(posterTransactionIds: string[]): Promise<Map<string, { id: string; status: string }>> {
    const rows = await this.prisma.posterImportedTransaction.findMany({
      where: { posterTransactionId: { in: posterTransactionIds } },
      select: { id: true, posterTransactionId: true, status: true },
    });
    return new Map(rows.map((r) => [r.posterTransactionId, { id: r.id, status: r.status }]));
  }

  // posterClientId is UNIQUE on Customer, so a Poster client maps to at most one CUP customer by construction.
  // Phase 19: the maps also carry the display name (admin-only preview) — still ONE bounded query each.
  async findCustomersByPosterClientId(posterClientIds: string[]): Promise<Map<string, { id: string; name: string | null }>> {
    const rows = await this.prisma.customer.findMany({ where: { posterClientId: { in: posterClientIds } }, select: { id: true, posterClientId: true, displayName: true } });
    return new Map(rows.map((r) => [r.posterClientId as string, { id: r.id, name: r.displayName }]));
  }

  async findBranchesBySpotId(spotIds: number[]): Promise<Map<number, { id: string; isActive: boolean; name: string }>> {
    const rows = await this.prisma.branch.findMany({ where: { posterSpotId: { in: spotIds } }, select: { id: true, posterSpotId: true, isActive: true, name: true } });
    return new Map(rows.map((r) => [r.posterSpotId, { id: r.id, isActive: r.isActive, name: r.name }]));
  }

  async findProductsByPosterId(posterProductIds: string[]): Promise<Map<string, { id: string; name: string }>> {
    const rows = await this.prisma.product.findMany({ where: { posterProductId: { in: posterProductIds } }, select: { id: true, posterProductId: true, name: true } });
    return new Map(rows.map((r) => [r.posterProductId, { id: r.id, name: r.name }]));
  }

  // --- CUP-originated dedupe --------------------------------------------------------------------------------

  // Coffee Subscription — the CUP-managed subscription consumption lines on these receipts: every redemption whose verified mutation
  // resolved to one of these Poster transaction ids and that is either CONFIRMED or still UNKNOWN (ambiguous). The importer uses this
  // explicit link — never a zero price alone — to keep those lines out of the imported SALE lines and to reconcile the redemption.
  async findSubscriptionRedemptionsForTransactions(posterTransactionIds: string[]): Promise<Map<string, SubscriptionLineRef[]>> {
    const map = new Map<string, SubscriptionLineRef[]>();
    if (posterTransactionIds.length === 0) return map;
    const rows = await this.prisma.subscriptionRedemption.findMany({
      where: { posterTransactionId: { in: posterTransactionIds }, status: { in: ['CONFIRMED', 'UNKNOWN'] } },
      select: { id: true, posterTransactionId: true, posterProductId: true, status: true, reconciliationStatus: true },
      orderBy: { requestedAt: 'asc' },
    });
    for (const r of rows) {
      const key = r.posterTransactionId as string;
      map.set(key, [...(map.get(key) ?? []), { id: r.id, posterProductId: r.posterProductId, status: r.status, reconciliationStatus: r.reconciliationStatus }]);
    }
    return map;
  }

  // Applies what a CLOSED receipt proves about a subscription redemption. A CONFIRMED one is only labelled (MATCHED / LINE_MISSING — a missing
  // line is flagged for an admin, never auto-reversed). An UNKNOWN (ambiguous) one is resolved: its line on the closed receipt means the coffee
  // was really given (CONFIRMED); a closed receipt without it means nothing was added (FAILED, portions released). Idempotent.
  async reconcileSubscriptionRedemption(id: string, lineFound: boolean): Promise<void> {
    const now = new Date();
    await this.prisma.runTransaction(async (tx) => {
      const row = await tx.subscriptionRedemption.findUnique({ where: { id }, select: { status: true, requestedAt: true, posterOrderId: true, subscriptionId: true, reconciliationStatus: true } });
      if (!row) return;
      const label = lineFound ? 'MATCHED' : 'LINE_MISSING';
      if (row.status === 'CONFIRMED') {
        if (row.reconciliationStatus !== label) await tx.subscriptionRedemption.update({ where: { id }, data: { reconciliationStatus: label, reconciledAt: now } });
        return;
      }
      if (row.status !== 'UNKNOWN') return;
      await tx.subscription.update({ where: { id: row.subscriptionId }, data: { usageVersion: { increment: 1 } }, select: { id: true } }); // same lock as a redemption claim
      if (lineFound) {
        const clash = await tx.subscriptionRedemption.findFirst({ where: { redeemedForPosterOrderId: row.posterOrderId }, select: { id: true } });
        if (clash) return; // leave UNKNOWN for an admin rather than double-consume
        await tx.subscriptionRedemption.update({ where: { id }, data: { status: 'CONFIRMED', redeemedAt: row.requestedAt, redeemedForPosterOrderId: row.posterOrderId, reconciliationStatus: label, reconciledAt: now, resolvedBy: 'system:poster-import', resolutionNote: 'Line found on the closed Poster receipt.' } });
      } else {
        await tx.subscriptionRedemption.update({ where: { id }, data: { status: 'FAILED', failureReason: 'POSTER_MUTATION_FAILED', reconciliationStatus: label, reconciledAt: now, resolvedBy: 'system:poster-import', resolutionNote: 'The closed Poster receipt has no such line — nothing was given; portions released.' } });
      }
    });
  }

  async findKnownLinkedTransactionIds(posterTransactionIds: string[]): Promise<Set<string>> {
    const rows = await this.prisma.posterIncomingOrderLink.findMany({ where: { posterTransactionId: { in: posterTransactionIds } }, select: { posterTransactionId: true } });
    return new Set(rows.map((r) => r.posterTransactionId));
  }

  // CUP orders sent to Poster whose receipt link is not cached yet, newest first, bounded.
  async findUnlinkedCupIncomingOrders(createdSince: Date, limit: number): Promise<string[]> {
    const linked = await this.prisma.posterIncomingOrderLink.findMany({ select: { posterIncomingOrderId: true } });
    const rows = await this.prisma.order.findMany({
      where: { posterIncomingOrderId: { not: null, notIn: linked.map((l) => l.posterIncomingOrderId) }, createdAt: { gte: createdSince } },
      select: { posterIncomingOrderId: true },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map((r) => r.posterIncomingOrderId as string);
  }

  async saveLink(posterIncomingOrderId: string, posterTransactionId: string): Promise<void> {
    try {
      await this.prisma.posterIncomingOrderLink.create({ data: { posterIncomingOrderId, posterTransactionId } });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err; // an identical link already exists (concurrent run) — fine
    }
  }

  // --- writes -----------------------------------------------------------------------------------------------

  // Returns false when the row already exists. The unique index on posterTransactionId is the authority: two
  // concurrent creators cannot both win, and the loser learns it via P2002 on THAT column — no "check then insert" reliance.
  // ATOMIC (Phase 19): header + every item row are written inside one DB transaction, so a receipt is either fully present or absent —
  // a failure on any item (including a unique violation on an ITEM, which is NOT "already imported") rolls the header back and is rethrown.
  async createTransaction(data: ImportedTransactionData): Promise<boolean> {
    const { items, ...header } = data;
    try {
      await this.prisma.runTransaction(async (tx) => {
        await tx.posterImportedTransaction.create({ data: { ...header, items: { create: items } } });
      });
      return true;
    } catch (err) {
      if (isUniqueViolation(err) && String((err as { meta?: { target?: unknown } }).meta?.target ?? '').includes('posterTransactionId')) return false;
      throw err;
    }
  }

  // The ONLY mutation of an existing row: UNRESOLVED -> IMPORTED once its lines now resolve. Guarded by
  // status = 'UNRESOLVED' inside the same DB transaction, so an IMPORTED row is never touched.
  async upgradeUnresolved(existingId: string, data: ImportedTransactionData): Promise<boolean> {
    return this.prisma.runTransaction(async (tx) => {
      const { items, posterTransactionId, ...header } = data;
      void posterTransactionId; // identity never changes
      const updated = await tx.posterImportedTransaction.updateMany({ where: { id: existingId, status: 'UNRESOLVED' }, data: header });
      if (updated.count !== 1) return false;
      await tx.posterImportedTransactionItem.deleteMany({ where: { transactionId: existingId } });
      await tx.posterImportedTransactionItem.createMany({ data: items.map((item) => ({ ...item, transactionId: existingId })) });
      return true;
    });
  }
}

function isUniqueViolation(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: string }).code === 'P2002';
}
