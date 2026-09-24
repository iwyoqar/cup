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
