import { Injectable } from '@nestjs/common';
import { PosterImportReportRepository } from './poster-import-report.repository';
import { ImportCategory, PosterTransactionImportService } from './poster-transaction-import.service';
import { PosterSpotMappingService } from './poster-spot-mapping.service';

// Categories whose receipts CUP can attribute to a branch, a customer and products (they are, or would be, POS purchases).
const ATTRIBUTED: ImportCategory[] = ['IMPORTABLE', 'ALREADY_IMPORTED'];
// Real sales CUP is choosing not to (or cannot yet) attribute to a branch/products — their revenue is the "unattributed
// revenue" the report exposes. Customer linkage is NOT part of this grouping (owner decision, 2026-09-24): an
// anonymous receipt (no Poster client, or an unlinked one) is now imported as IMPORTABLE/ALREADY_IMPORTED like any
// other — see the separate `customers` block below for customer-linkage visibility specifically.
const UNATTRIBUTED: ImportCategory[] = ['UNMAPPED_BRANCH', 'UNRESOLVED', 'UNSUPPORTED_LINE', 'POSSIBLE_CUP_ORIGIN'];

// Phase 19 — the attribution data-quality report. Three read-only parts: (1) the spot -> branch mapping, (2) what is already stored in
// poster_imported_transactions, (3) an optional LIVE scan of one bounded Poster window using the very same classification the import uses (so the report
// and the import cannot disagree). No internal ids are exposed except the branch id already used by Admin.
@Injectable()
export class PosterImportQualityService {
  constructor(
    private readonly mapping: PosterSpotMappingService,
    private readonly importService: PosterTransactionImportService,
    private readonly repository: PosterImportReportRepository,
  ) {}

  async report(window: { since?: string; until?: string; limit?: number; live: boolean }) {
    const [mapping, stats, links, events] = await Promise.all([this.mapping.report(), this.repository.importedStats(), this.repository.customerLinkStats(), this.repository.unattributedEvents()]);
    const branchNames = new Map(mapping.spots.filter((s) => s.branch).map((s) => [s.branch!.id, s.branch!.name]));

    let live: unknown = { available: false, reason: 'Live scan not requested.' };
    if (window.live) {
      try {
        const { summary } = await this.importService.analyze({ since: window.since, until: window.until, limit: window.limit });
        const sum = (cats: ImportCategory[], src: Record<ImportCategory, number>) => cats.reduce((n, c) => n + src[c], 0);
        live = {
          available: true,
          window: summary.window,
          scanned: summary.scanned,
          truncated: summary.truncated,
          transactions: summary.categories,
          revenueMinor: summary.revenueByCategoryMinor,
          attribution: {
            attributedTransactions: sum(ATTRIBUTED, summary.categories),
            unattributedTransactions: sum(UNATTRIBUTED, summary.categories),
            attributedRevenueMinor: sum(ATTRIBUTED, summary.revenueByCategoryMinor),
            unattributedRevenueMinor: sum(UNATTRIBUTED, summary.revenueByCategoryMinor),
            note: 'Attributed = a paid receipt with a mapped active branch and mapped products (importable or already imported) — a CUP customer link is no longer required (see customers below). Unattributed = a real receipt CUP cannot yet attribute to a branch/products. Unpaid, too-recent, CUP-originated and refund-excluded receipts are in neither group.',
          },
          customers: { receiptsWithLinkedCustomer: summary.details.filter((d) => d.customerName !== null && d.customerName !== undefined).length, receiptsWithoutPosterClient: summary.details.filter((d) => d.hasPosterClient === false).length, receiptsWithUnlinkedPosterClient: summary.details.filter((d) => d.hasPosterClient === true && (d.customerName === null || d.customerName === undefined)).length },
          products: { unresolvedReceipts: summary.categories.UNRESOLVED, unsupportedLineReceipts: summary.categories.UNSUPPORTED_LINE },
          partiallyPaidReceipts: summary.partiallyPaid,
          refund: summary.refundPolicy,
          posterReads: summary.posterReads,
        };
      } catch (err) {
        live = { available: false, reason: err instanceof Error ? err.message.split('\n')[0].slice(0, 200) : 'The Poster read failed.' };
      }
    }

    return {
      generatedAt: new Date().toISOString(),
      branch: { ...mapping.counts, importReady: mapping.importReady },
      customer: { customers: links.total, linkedToPoster: links.linkedToPoster, notLinked: links.total - links.linkedToPoster },
      product: { importedLinesMapped: stats.itemLines.mapped, importedLinesUnmapped: stats.itemLines.unmapped, unresolvedReceipts: stats.unresolvedReasons.filter((r) => r.reason === 'UNMAPPED_PRODUCT').reduce((n, r) => n + r.count, 0), modifiersNote: 'A receipt line that uses a Poster modifier is UNRESOLVED (MODIFICATION_NOT_SUPPORTED); modifiers are not interpreted.' },
      stored: {
        byStatus: stats.byStatus,
        unresolvedReasons: stats.unresolvedReasons,
        imported: stats.imported,
        importedWithoutItems: stats.importedWithoutItems, // an IMPORTED row must always have its lines: anything but 0 needs review
        span: stats.span,
        perBranch: stats.perBranch.map((b) => ({ branch: branchNames.get(b.branchId) ?? 'Unknown branch', count: b.count, totalMinor: b.totalMinor })),
      },
      live,
      unattributedEvents: {
        ...events,
        note: 'Events with no purchase link are shown here and never assigned to a branch (see Branch Intelligence). They remain in all-branches figures.',
      },
      refund: {
        policy: 'REFUND_UNVERIFIED',
        excludedByShape: 'Receipts with a negative amount or quantity',
        neverAutomatic: 'An imported receipt is never reversed automatically; a receipt Poster later lists as deleted is reported (importedButDeletedInPoster), not changed.',
      },
    };
  }
}
