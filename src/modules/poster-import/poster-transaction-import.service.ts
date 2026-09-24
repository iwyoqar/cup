import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../../common/config/config.service';
import { addDays, businessDateOf, parseBusinessDate, rangeFor } from '../analytics/analytics-period';
import { PosterService } from '../poster/poster.service';
import { PosterTransaction } from '../poster/poster.types';
import { ImportedTransactionData, PosterImportRepository } from './poster-import.repository';
import { normalizePosterTransaction, NormalizedTransaction } from './poster-transaction-normalizer';

// Phase 11.2 — Poster POS transaction import FOUNDATION. Phase 19 — activation controls on top of the SAME engine (there is no second import path).
//
// What it does: reads closed Poster receipts (READ-ONLY), attributes each to a CUP customer through the explicit chain
//   transaction.client_id -> Customer.posterClientId,   transaction.spot_id -> Branch.posterSpotId,
//   line.product_id -> Product.posterProductId,
// and records it as a PosterImportedTransaction (its own model — never an Order). Customer attribution is the ONE
// optional part of this chain (owner decision, 2026-09-24): a receipt with no Poster client, or an unlinked one, is
// still imported with customerId: null so Analytics/Finance revenue reflects real total sales — see the model's own
// schema comment for why every per-customer consumer stays unaffected. Branch and product resolution remain required.
// Dedupe authority is the Poster transaction id (unique index). A receipt that a CUP order points at (documented
// incoming_order.transaction_id) is CUP-originated and is never imported as an external sale.
//
// What it deliberately does NOT do: touch loyalty, rewards, orders or Poster; use order_source / auto_accept; match by phone, name, amount, time or
// product similarity; treat any receipt as refunded/voided (that Poster behaviour is UNVERIFIED — see REFUND_UNVERIFIED); create customers, products or
// branches; import automatically (nothing calls run() except the admin endpoint, and a write needs the full gate below).
//
// Phase 19 shape: analyze() = the read-only classification of one bounded window (used by the preview, the data-quality report and the import itself);
// run() = analyze() and, only when every write gate passes, the writes the analysis planned. So preview and import can never disagree.

export type ImportOutcome = 'IMPORTABLE' | 'IMPORTED' | 'ALREADY_IMPORTED' | 'CUP_ORIGINATED' | 'UNRESOLVED' | 'SKIPPED' | 'FAILED';

// An exclusive partition of every scanned receipt (their counts add up to `scanned`).
export type ImportCategory =
  | 'IMPORTABLE'
  | 'ALREADY_IMPORTED'
  | 'CUP_ORIGINATED'
  | 'POSSIBLE_CUP_ORIGIN'
  | 'UNRESOLVED'
  | 'UNSUPPORTED_LINE'
  | 'UNMAPPED_BRANCH'
  | 'UNPAID'
  | 'TOO_RECENT'
  | 'REFUND_UNVERIFIED'
  | 'OTHER';

export const IMPORT_CATEGORIES: ImportCategory[] = [
  'IMPORTABLE',
  'ALREADY_IMPORTED',
  'CUP_ORIGINATED',
  'POSSIBLE_CUP_ORIGIN',
  'UNRESOLVED',
  'UNSUPPORTED_LINE',
  'UNMAPPED_BRANCH',
  'UNPAID',
  'TOO_RECENT',
  'REFUND_UNVERIFIED',
  'OTHER',
];

export type ImportDecision = 'IMPORT' | 'SKIP' | 'ALREADY_IMPORTED' | 'CUP_ORIGINATED' | 'UNRESOLVED';

export interface ImportDetailLine {
  posterProductId: string;
  productName: string | null; // null = no CUP product for this Poster product
  quantity: number;
  paidMinor: number;
}

export interface ImportDetail {
  posterTransactionId: string;
  outcome: ImportOutcome;
  reason?: string;
  category: ImportCategory;
  decision: ImportDecision;
  occurredAt?: string;
  posterSpotId?: number;
  branchName?: string | null; // null = the spot has no CUP branch
  customerName?: string | null; // null = no linked CUP customer
  hasPosterClient?: boolean;
  totalMinor?: number;
  paidMinor?: number;
  posterStatus?: string;
  lines?: ImportDetailLine[];
}

export interface ImportSummary {
  mode: 'preview' | 'import';
  window: { since: string; until: string };
  limit: number;
  truncated: boolean; // more receipts existed in the window than `limit`
  scanned: number;
  importable: number; // would be / were written as IMPORTED (preview: nothing was written)
  imported: number; // rows actually written as IMPORTED by this run (always 0 in preview)
  alreadyImported: number;
  cupOriginated: number;
  unresolved: number;
  skipped: number;
  failed: number; // receipts whose write failed (rolled back) — re-running the same import resumes them
  reasons: Record<string, number>;
  cupOrderLinksChecked: number;
  categories: Record<ImportCategory, number>;
  revenueByCategoryMinor: Record<ImportCategory, number>; // sum of receipt totals per category
  partiallyPaid: number; // importable receipts whose paid amount is below the receipt total (informational)
  importedTransactionIds: string[]; // the Poster ids written as IMPORTED by THIS run
  refundPolicy: {
    status: 'REFUND_UNVERIFIED';
    note: string;
    excludedReceipts: number; // negative-amount / negative-quantity receipts kept out of the import
    deletedInPosterWindow: number | null; // Poster's own status-3 receipts in the window (null = the read failed)
    importedButDeletedInPoster: string[]; // already-imported receipts Poster now lists as deleted: reported, never reversed automatically
  };
  posterReads: { transactions: number; deletedTransactions: number; incomingOrderLinks: number };
  details: ImportDetail[];
}

export interface ImportRequest {
  since?: string;
  until?: string;
  limit?: number;
  write: boolean;
  // Write-only gates (see assertWriteRequest): the operator's explicit acknowledgement and the preview count they reviewed.
  acknowledgeRefundPolicy?: boolean;
  expectedImportable?: number;
  actor?: string; // admin id — only for the audit log line
}

interface PlannedWrite {
  data: ImportedTransactionData;
  existingId: string | null;
  detail: ImportDetail;
  audit: boolean; // true = an UNRESOLVED audit row (never counted as an import)
}

interface Analysis {
  summary: ImportSummary;
  plan: PlannedWrite[];
  newLinks: { incomingOrderId: string; transactionId: string }[];
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 1000; // a PREVIEW / report may scan up to this many receipts
const MAX_WRITE_LIMIT = 100; // a real import writes at most this many receipts per request
const MAX_WINDOW_DAYS = 31;
// Bounds the number of getIncomingOrder calls made per run to resolve CUP-order -> receipt links.
const LINK_LOOKBACK_DAYS = 30;
const MAX_LINK_LOOKUPS = 100;

const REFUND_NOTE =
  'Refund / return semantics are UNVERIFIED: Poster exposes no observable trace of a refunded closed receipt in this account. Receipts with a negative amount or quantity are excluded, ' +
  'nothing is ever imported as a negative sale, and an imported receipt is never reversed automatically.';

const emptyCategories = (): Record<ImportCategory, number> => Object.fromEntries(IMPORT_CATEGORIES.map((c) => [c, 0])) as Record<ImportCategory, number>;

export function categoryOf(outcome: ImportOutcome, reason?: string): ImportCategory {
  switch (outcome) {
    case 'IMPORTABLE':
    case 'IMPORTED':
      return 'IMPORTABLE';
    case 'ALREADY_IMPORTED':
      return 'ALREADY_IMPORTED';
    case 'CUP_ORIGINATED':
      return 'CUP_ORIGINATED';
    case 'UNRESOLVED':
      return reason === 'UNMAPPED_PRODUCT' ? 'UNRESOLVED' : 'UNSUPPORTED_LINE';
    case 'FAILED':
      return 'OTHER';
    case 'SKIPPED':
      switch (reason) {
        case 'BRANCH_NOT_MAPPED':
        case 'BRANCH_INACTIVE':
          return 'UNMAPPED_BRANCH';
        case 'NOT_A_PAID_SALE':
          return 'UNPAID';
        case 'TOO_RECENT':
          return 'TOO_RECENT';
        case 'REFUND_UNVERIFIED':
          return 'REFUND_UNVERIFIED';
        case 'APPLICATION_ID_UNLINKED':
          return 'POSSIBLE_CUP_ORIGIN';
        default:
          return 'OTHER';
      }
  }
}

@Injectable()
export class PosterTransactionImportService {
  private readonly logger = new Logger(PosterTransactionImportService.name);

  constructor(
    private readonly poster: PosterService,
    private readonly repository: PosterImportRepository,
    private readonly config: ConfigService,
  ) {}

  // PREVIEW when write=false. A real import needs EVERY gate (assertWriteRequest + the two post-analysis gates); if any fails, nothing is written.
  async run(request: ImportRequest): Promise<ImportSummary> {
    if (request.write) this.assertWriteRequest(request);
    const { summary, plan, newLinks } = await this.analyze(request);
    if (!request.write) return this.finish(summary, request);

    // Post-analysis gates — still before the first write.
    if (summary.categories.UNMAPPED_BRANCH > 0) {
      throw new BadRequestException(`Import refused: ${summary.categories.UNMAPPED_BRANCH} receipt(s) come from a Poster spot with no active CUP branch. Fix the spot -> branch mapping first (nothing was written).`);
    }
    if (request.expectedImportable !== summary.importable) {
      throw new BadRequestException(`Import refused: the window now has ${summary.importable} importable receipt(s) but ${request.expectedImportable} were reviewed. Run the preview again (nothing was written).`);
    }

    await this.persist(summary, plan, newLinks);
    return this.finish(summary, request);
  }

  // Phase 20 — the AUTOMATIC path (webhook processor / reconciliation). The SAME classification (classify) and the SAME atomic, idempotent writes (persist) as the
  // reviewed admin import; what differs is only who decides: there is no human review here, so the policy is "write exactly what the preview would have called
  // IMPORTABLE (plus UNRESOLVED audit rows) and skip everything else per receipt" — never a create, never a guess, never a reversal. Nothing is gated per window
  // (a receipt is judged on its own), and the admin write gates (acknowledgement, reviewed count, 100-receipt cap) do not apply because nothing is a bulk import.
  async importTransactions(raws: PosterTransaction[], options: { linkLookups?: { lookbackDays: number; max: number } } = {}): Promise<ImportSummary> {
    const today = new Date().toISOString().slice(0, 10);
    const ordered = [...raws].sort((a, b) => Number(a.transaction_id) - Number(b.transaction_id));
    const summary = this.newSummary({ since: today, until: today }, ordered.length, false, ordered.length, true);
    const { plan, newLinks } = await this.classify(ordered, summary, [], options.linkLookups);
    await this.persist(summary, plan, newLinks);
    return summary;
  }

  // The write phase: the CUP-order link cache, then one atomic write per receipt (a failure is reported FAILED and the rest continue; re-running resumes).
  private async persist(summary: ImportSummary, plan: PlannedWrite[], newLinks: { incomingOrderId: string; transactionId: string }[]): Promise<void> {
    for (const link of newLinks) await this.repository.saveLink(link.incomingOrderId, link.transactionId);

    for (const item of plan) {
      try {
        // An earlier UNRESOLVED row whose lines now resolve is upgraded in place; otherwise a fresh create. Each is ONE database transaction.
        const written = item.existingId ? await this.repository.upgradeUnresolved(item.existingId, item.data) : await this.repository.createTransaction(item.data);
        if (item.audit) continue; // an UNRESOLVED audit row: kept for review, never counted as an import
        if (written) {
          item.detail.outcome = 'IMPORTED';
          summary.imported += 1;
          summary.importedTransactionIds.push(item.detail.posterTransactionId);
        } else {
          this.retag(summary, item.detail, 'ALREADY_IMPORTED', undefined); // lost a concurrent race — strictly no duplicate
        }
      } catch (err) {
        // Rolled back as a whole; the rest of the batch continues and a re-run of the same import picks this receipt up again.
        this.logger.error(`Poster POS import: receipt ${item.detail.posterTransactionId} was not written (${err instanceof Error ? err.message.split('\n')[0] : 'error'}).`);
        this.retag(summary, item.detail, 'FAILED', 'WRITE_FAILED');
      }
    }
  }

  // The read-only classification. NEVER writes anything (not even the CUP-link cache — those are returned and saved by run() only after the gates).
  async analyze(request: { since?: string; until?: string; limit?: number; write?: boolean }): Promise<Analysis> {
    const window = resolveWindow(request.since, request.until, this.config.env.BUSINESS_TIMEZONE_OFFSET_MINUTES);
    const limit = clampLimit(request.limit);

    // 1. Poster read (dateFrom/dateTo already widened by a day each side — see resolveWindow's own comment), then
    // filtered to the EXACT business-local window by the receipt's own close time — never trusting Poster's own
    // date-string filter to have used the same day boundary this business does.
    const fetched = await this.poster.getClosedTransactions(window.dateFrom, window.dateTo);
    const inWindow = fetched.filter((t) => {
      const closeMs = Number(t.date_close);
      return Number.isFinite(closeMs) && closeMs >= window.from && closeMs < window.to;
    });
    const ordered = [...inWindow].sort((a, b) => Number(a.transaction_id) - Number(b.transaction_id));
    const batch = ordered.slice(0, limit);

    const summary = this.newSummary({ since: window.since, until: window.until }, limit, ordered.length > limit, batch.length, !!request.write);
    const deletedIds = await this.readDeleted(window, summary);
    const { plan, newLinks } = await this.classify(batch, summary, deletedIds);
    return { summary, plan, newLinks };
  }

  private newSummary(window: { since: string; until: string }, limit: number, truncated: boolean, scanned: number, write: boolean): ImportSummary {
    return {
      mode: write ? 'import' : 'preview',
      window: { since: window.since, until: window.until },
      limit,
      truncated,
      scanned,
      importable: 0,
      imported: 0,
      alreadyImported: 0,
      cupOriginated: 0,
      unresolved: 0,
      skipped: 0,
      failed: 0,
      reasons: {},
      cupOrderLinksChecked: 0,
      categories: emptyCategories(),
      revenueByCategoryMinor: emptyCategories(),
      partiallyPaid: 0,
      importedTransactionIds: [],
      refundPolicy: { status: 'REFUND_UNVERIFIED', note: REFUND_NOTE, excludedReceipts: 0, deletedInPosterWindow: null, importedButDeletedInPoster: [] },
      posterReads: { transactions: 1, deletedTransactions: 0, incomingOrderLinks: 0 },
      details: [],
    };
  }

  // The read-only classification of an ALREADY FETCHED batch of Poster receipts (shared by the admin preview / import, the data-quality scan and the Phase 20
  // automatic sync). It fills `summary` and returns the writes it planned; it writes nothing itself.
  private async classify(
    batch: PosterTransaction[],
    summary: ImportSummary,
    deletedIds: string[],
    linkLookups?: { lookbackDays: number; max: number },
  ): Promise<{ plan: PlannedWrite[]; newLinks: { incomingOrderId: string; transactionId: string }[] }> {
    const plan: PlannedWrite[] = [];
    const newLinks: { incomingOrderId: string; transactionId: string }[] = [];
    if (batch.length === 0) return { plan, newLinks };

    // 2. Normalise headers; anything malformed is skipped, never repaired.
    const normalized: { raw: PosterTransaction; tx: NormalizedTransaction }[] = [];
    for (const raw of batch) {
      const result = normalizePosterTransaction(raw);
      if (result.ok) normalized.push({ raw, tx: result.transaction });
      else this.record(summary, { posterTransactionId: String(raw.transaction_id), outcome: 'SKIPPED', reason: result.reason, category: categoryOf('SKIPPED', result.reason), decision: 'SKIP' });
    }
    if (normalized.length === 0) return { plan, newLinks };

    // 3. CUP-originated set: cached links + links resolved NOW from Poster for CUP orders still unlinked (read-only; returned, saved only on a real import).
    const ids = normalized.map((n) => n.tx.posterTransactionId);
    const cupLinked = await this.repository.findKnownLinkedTransactionIds(ids);
    summary.cupOrderLinksChecked = await this.resolveFreshCupLinks(cupLinked, newLinks, linkLookups);
    summary.posterReads.incomingOrderLinks = summary.cupOrderLinksChecked;

    // 4. Bulk identity / mapping lookups (a fixed number of queries, whatever the window size).
    const [existing, customers, branches] = await Promise.all([
      this.repository.findExisting(ids),
      this.repository.findCustomersByPosterClientId([...new Set(normalized.map((n) => n.tx.posterClientId).filter((c): c is string => c !== null))]),
      this.repository.findBranchesBySpotId([...new Set(normalized.map((n) => n.tx.posterSpotId))]),
    ]);
    const products = await this.repository.findProductsByPosterId([...new Set(normalized.flatMap((n) => (n.tx.lines ?? []).map((l) => l.posterProductId)))]);
    await this.flagDeletedButImported(summary, deletedIds);

    const settleMs = this.config.env.POSTER_IMPORT_SETTLE_SECONDS * 1000;
    const now = Date.now();

    // 5. Classify, one receipt at a time (pure in-memory work — every lookup above was bulk).
    for (const { raw, tx } of normalized) {
      const id = tx.posterTransactionId;
      const branch = branches.get(tx.posterSpotId);
      const customer = tx.posterClientId ? customers.get(tx.posterClientId) : undefined;
      const facts: Partial<ImportDetail> = {
        occurredAt: tx.occurredAt.toISOString(),
        posterSpotId: tx.posterSpotId,
        branchName: branch?.name ?? null,
        customerName: customer?.name ?? null,
        hasPosterClient: tx.posterClientId !== null,
        totalMinor: tx.totalMinor,
        paidMinor: tx.paidMinor,
        posterStatus: tx.posterStatus,
        lines: (tx.lines ?? []).map((l) => ({ posterProductId: l.posterProductId, productName: products.get(l.posterProductId)?.name ?? null, quantity: l.quantity, paidMinor: l.posterPayedSumMinor })),
      };
      const skip = (reason: string) => this.record(summary, { posterTransactionId: id, outcome: 'SKIPPED', reason, category: categoryOf('SKIPPED', reason), decision: 'SKIP', ...facts });

      if (cupLinked.has(id)) {
        this.record(summary, { posterTransactionId: id, outcome: 'CUP_ORIGINATED', category: 'CUP_ORIGINATED', decision: 'CUP_ORIGINATED', ...facts });
        continue;
      }
      const already = existing.get(id);
      if (already?.status === 'IMPORTED') {
        this.record(summary, { posterTransactionId: id, outcome: 'ALREADY_IMPORTED', category: 'ALREADY_IMPORTED', decision: 'ALREADY_IMPORTED', ...facts });
        continue;
      }

      // Documented meaning only: status 2 = closed; pay_type 0 = closed without payment.
      if (tx.posterStatus !== '2') { skip('NOT_CLOSED'); continue; }
      if (tx.posterPayType === '0' || tx.paidMinor <= 0 || tx.totalMinor <= 0) { skip('NOT_A_PAID_SALE'); continue; }
      // Owner decision (2026-09-24): the settling wait exists ONLY to give Poster time to report a CUP-created order's
      // receipt link before this receipt might otherwise be imported as a bare POS sale and double-counted (see the
      // CUP_ORIGINATED check above and the APPLICATION_ID_UNLINKED skip below). Poster stamps EVERY receipt created
      // through CUP's own incoming-order API with application_id (UNDOCUMENTED, but consistently observed) — a receipt
      // without it could never be a CUP order in the first place, so there is nothing for it to be confused with and no
      // reason to wait at all. Only an application_id-bearing receipt still needs the wait.
      if (hasApplicationId(raw) && now - tx.occurredAt.getTime() < settleMs) { skip('TOO_RECENT'); continue; }
      // Safety net against double counting a CUP-created receipt whose link CUP could not resolve (lookback / lookup bounds): Poster stamps such receipts with an
      // application_id (UNDOCUMENTED). It is used ONLY to skip — never to import or attribute. This is the ONE case still
      // skipped rather than imported anonymously below: a receipt that LOOKS like it might be a CUP order gets the real
      // link or nothing, never a guessed/anonymous attribution.
      if (hasApplicationId(raw) && !customer) { skip('APPLICATION_ID_UNLINKED'); continue; }

      if (!branch) { skip('BRANCH_NOT_MAPPED'); continue; }
      if (!branch.isActive) { skip('BRANCH_INACTIVE'); continue; }

      // Owner decision (2026-09-24): a receipt with no Poster client, or one whose client is not linked to a CUP
      // customer, is now imported ANONYMOUSLY (customerId: null) instead of being skipped — so Analytics/Finance
      // revenue reflects real total sales, not just the subset attributable to a known customer. Every per-customer
      // consumer (rewards, loyalty2, automations, Customer 360) already filters by a specific real customerId, so
      // an anonymous row is automatically excluded from all of those — see the model's own schema comment.
      const header = { posterTransactionId: id, posterClientId: tx.posterClientId, customerId: customer?.id ?? null, branchId: branch.id, posterSpotId: tx.posterSpotId, posterStatus: tx.posterStatus, posterPayType: tx.posterPayType, occurredAt: tx.occurredAt, totalMinor: tx.totalMinor, paidMinor: tx.paidMinor };

      // Line resolution decides IMPORTED vs UNRESOLVED. An unresolved receipt is never "partly imported as complete".
      let status: 'IMPORTED' | 'UNRESOLVED' = 'IMPORTED';
      let unresolvedReason: string | null = null;
      let items: ImportedTransactionData['items'] = [];
      if (tx.lineProblem) {
        status = 'UNRESOLVED';
        unresolvedReason = tx.lineProblem;
      } else if (!tx.lines || tx.lines.length === 0) {
        skip('NO_LINES');
        continue;
      } else {
        items = tx.lines.map((line) => ({
          lineIndex: line.lineIndex,
          posterProductId: line.posterProductId,
          productId: products.get(line.posterProductId)?.id ?? null,
          quantity: line.quantity,
          posterProductPriceMinor: line.posterProductPriceMinor,
          posterPayedSumMinor: line.posterPayedSumMinor,
        }));
        if (tx.lines.some((l) => l.hasModification)) {
          status = 'UNRESOLVED';
          unresolvedReason = 'MODIFICATION_NOT_SUPPORTED';
        } else if (items.some((i) => i.productId === null)) {
          status = 'UNRESOLVED';
          unresolvedReason = 'UNMAPPED_PRODUCT';
        }
      }

      if (status === 'UNRESOLVED') {
        // Persisted for audit on a real import (new rows only) but never counted as an import. An already-UNRESOLVED row stays as is.
        const detail: ImportDetail = { posterTransactionId: id, outcome: 'UNRESOLVED', reason: unresolvedReason ?? undefined, category: categoryOf('UNRESOLVED', unresolvedReason ?? undefined), decision: 'UNRESOLVED', ...facts };
        this.record(summary, detail);
        if (!already) plan.push({ data: { ...header, status, unresolvedReason, items }, existingId: null, detail, audit: true });
        continue;
      }

      const detail: ImportDetail = { posterTransactionId: id, outcome: 'IMPORTABLE', category: 'IMPORTABLE', decision: 'IMPORT', ...facts };
      this.record(summary, detail);
      if (tx.paidMinor < tx.totalMinor) summary.partiallyPaid += 1;
      plan.push({ data: { ...header, status: 'IMPORTED', unresolvedReason: null, items }, existingId: already?.id ?? null, detail, audit: false });
    }
    return { plan, newLinks };
  }

  // Request-shape gates for a REAL import. Each failure is a 400 raised before Poster is even read.
  private assertWriteRequest(request: ImportRequest): void {
    if (!request.since || !request.until) throw new BadRequestException('A real import needs an explicit since and until (no default window).');
    if (request.limit === undefined) throw new BadRequestException('A real import needs an explicit limit.');
    if (!Number.isInteger(request.limit) || request.limit < 1 || request.limit > MAX_WRITE_LIMIT) throw new BadRequestException(`A real import writes at most ${MAX_WRITE_LIMIT} receipts per request (limit 1-${MAX_WRITE_LIMIT}).`);
    if (request.acknowledgeRefundPolicy !== true) throw new BadRequestException('A real import requires acknowledgeRefundPolicy: true (refund / return semantics are unverified and such receipts are excluded).');
    if (!Number.isInteger(request.expectedImportable) || (request.expectedImportable as number) < 0) throw new BadRequestException('A real import requires expectedImportable — the importable count of the preview that was reviewed.');
  }

  // Read-only: how many receipts Poster itself lists as deleted (documented status 3) in the window. A failed read never fails the preview.
  private async readDeleted(window: { dateFrom: string; dateTo: string }, summary: ImportSummary): Promise<string[]> {
    summary.posterReads.deletedTransactions = 1;
    try {
      const deleted = await this.poster.getDeletedTransactions(window.dateFrom, window.dateTo);
      summary.refundPolicy.deletedInPosterWindow = deleted.length;
      return deleted.map((d) => String(d.transaction_id));
    } catch {
      return [];
    }
  }

  private async flagDeletedButImported(summary: ImportSummary, deletedIds: string[]): Promise<void> {
    if (deletedIds.length === 0) return;
    const rows = await this.repository.findExisting(deletedIds);
    summary.refundPolicy.importedButDeletedInPoster = [...rows.entries()].filter(([, v]) => v.status === 'IMPORTED').map(([k]) => k);
  }

  // Resolves receipt links for CUP orders whose link is not cached, using the documented incoming_order.transaction_id. Nothing is written here.
  private async resolveFreshCupLinks(cupLinked: Set<string>, newLinks: { incomingOrderId: string; transactionId: string }[], bounds?: { lookbackDays: number; max: number }): Promise<number> {
    const since = new Date(Date.now() - (bounds?.lookbackDays ?? LINK_LOOKBACK_DAYS) * 24 * 3600 * 1000);
    const pending = await this.repository.findUnlinkedCupIncomingOrders(since, bounds?.max ?? MAX_LINK_LOOKUPS);
    let checked = 0;
    for (const incomingOrderId of pending) {
      const link = await this.poster.getIncomingOrderTransactionLink(incomingOrderId);
      checked += 1;
      if (link.transactionId) {
        cupLinked.add(link.transactionId);
        newLinks.push({ incomingOrderId, transactionId: link.transactionId });
      }
    }
    return checked;
  }

  private record(summary: ImportSummary, detail: ImportDetail): void {
    summary.details.push(detail);
    switch (detail.outcome) {
      case 'IMPORTABLE': summary.importable += 1; break;
      case 'ALREADY_IMPORTED': summary.alreadyImported += 1; break;
      case 'CUP_ORIGINATED': summary.cupOriginated += 1; break;
      case 'UNRESOLVED': summary.unresolved += 1; break;
      case 'SKIPPED': summary.skipped += 1; break;
      default: break;
    }
    summary.categories[detail.category] += 1;
    summary.revenueByCategoryMinor[detail.category] += detail.totalMinor ?? 0;
    if (detail.reason) summary.reasons[detail.reason] = (summary.reasons[detail.reason] ?? 0) + 1;
    if (detail.reason === 'REFUND_UNVERIFIED') summary.refundPolicy.excludedReceipts += 1;
  }

  // A planned IMPORTABLE receipt that turned out not to be written (concurrent duplicate / write failure): move it to its true bucket.
  private retag(summary: ImportSummary, detail: ImportDetail, outcome: 'ALREADY_IMPORTED' | 'FAILED', reason?: string): void {
    summary.importable -= 1;
    summary.categories.IMPORTABLE -= 1;
    summary.revenueByCategoryMinor.IMPORTABLE -= detail.totalMinor ?? 0;
    detail.outcome = outcome;
    detail.reason = reason;
    detail.category = categoryOf(outcome, reason);
    detail.decision = outcome === 'ALREADY_IMPORTED' ? 'ALREADY_IMPORTED' : 'SKIP';
    summary.categories[detail.category] += 1;
    summary.revenueByCategoryMinor[detail.category] += detail.totalMinor ?? 0;
    if (outcome === 'ALREADY_IMPORTED') summary.alreadyImported += 1;
    else summary.failed += 1;
    if (reason) summary.reasons[reason] = (summary.reasons[reason] ?? 0) + 1;
  }

  private finish(summary: ImportSummary, request: ImportRequest): ImportSummary {
    // Counts only — never customer ids, phones or names in logs.
    this.logger.log(
      `Poster POS import (${summary.mode}${request.actor ? ` by admin ${request.actor}` : ''}) ${summary.window.since}..${summary.window.until}: scanned=${summary.scanned} importable=${summary.importable} imported=${summary.imported} ` +
        `already=${summary.alreadyImported} cupOriginated=${summary.cupOriginated} unresolved=${summary.unresolved} skipped=${summary.skipped} failed=${summary.failed}`,
    );
    return summary;
  }
}

function hasApplicationId(raw: PosterTransaction): boolean {
  const v = raw.application_id;
  if (v === null || v === undefined) return false;
  const s = String(v).trim();
  return s !== '' && s !== '0';
}

// --- bounded input handling -----------------------------------------------------------------------------------

// Step 2.1 (2026-09-24) — a `since`/`until` date string now means a BUSINESS-LOCAL calendar day (the same UTC+5
// convention resolveFinanceRange/analytics-period.ts already established for Finance), not a raw UTC day. Verified
// live in production: 7 receipts at 20:47-21:04 UTC (01:47-02:04 local) were previously attributed to the wrong
// UTC calendar date by a plain single-day scan, producing a real 375,000 so'm daily reconciliation mismatch that a
// multi-day window never showed (the boundary receipt landed inside it either way). Reuses rangeFor/addDays/
// businessDateOf from analytics-period.ts directly — no second date-range implementation.
//
// Poster's own account-timezone interpretation of a plain date string is unverified (and, per
// poster-reconcile.service.ts's own DATE_MARGIN comment, known to differ from this business's UTC+5 offset) — so
// dateFrom/dateTo (sent to Poster's own date-filtered API) are widened by a day on each side, exactly like
// poster-reconcile.service.ts already does for the same reason. This only ever WIDENS what Poster returns, never
// what gets counted: `from`/`to` are the exact business-local instants the fetched batch is filtered against
// immediately after (see analyze()), so a receipt just outside the requested window is still correctly excluded.
export function resolveWindow(since: string | undefined, until: string | undefined, offsetMinutes: number): { since: string; until: string; dateFrom: string; dateTo: string; from: number; to: number } {
  const today = businessDateOf(new Date(), offsetMinutes);
  const untilDate = until ?? today;
  const sinceDate = since ?? addDays(untilDate, -1);
  if (!parseBusinessDate(sinceDate) || !parseBusinessDate(untilDate)) throw new BadRequestException('Dates must be YYYY-MM-DD.');
  if (sinceDate > untilDate) throw new BadRequestException('since must not be after until.');
  const range = rangeFor(sinceDate, untilDate, offsetMinutes);
  if (range.days > MAX_WINDOW_DAYS) throw new BadRequestException(`The window may span at most ${MAX_WINDOW_DAYS} days.`);
  return {
    since: sinceDate,
    until: untilDate,
    dateFrom: addDays(sinceDate, -1).replace(/-/g, ''),
    dateTo: addDays(untilDate, 1).replace(/-/g, ''),
    from: range.from.getTime(),
    to: range.to.getTime(),
  };
}

function clampLimit(limit?: number): number {
  if (limit === undefined) return DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1) throw new BadRequestException('limit must be a positive integer.');
  return Math.min(limit, MAX_LIMIT);
}
