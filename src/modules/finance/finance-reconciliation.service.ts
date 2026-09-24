import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '../../common/config/config.service';
import { AnalyticsRepository } from '../analytics/analytics.repository';
import { ImportCategory, ImportDetail, PosterTransactionImportService } from '../poster-import/poster-transaction-import.service';
import { FinancePeriodQuery, resolveFinanceRange } from './finance-period';
import { FinanceRepository } from './finance.repository';

// Every category a paid, closed Poster receipt can land in (excludes UNPAID/REFUND_UNVERIFIED/OTHER, which are
// genuinely non-qualifying, and excludes nothing else — NOT_CLOSED receipts never even reach `categories`).
const QUALIFYING_CATEGORIES: ImportCategory[] = ['IMPORTABLE', 'ALREADY_IMPORTED', 'CUP_ORIGINATED', 'POSSIBLE_CUP_ORIGIN', 'UNRESOLVED', 'UNSUPPORTED_LINE', 'UNMAPPED_BRANCH', 'TOO_RECENT'];
// Independent-POS categories still pending recognition into CUP's canonical revenue (posTotals) — each is its own,
// already-established reason (see poster-transaction-import.service.ts), never a new one invented here.
const PENDING_CATEGORIES: ImportCategory[] = ['IMPORTABLE', 'UNRESOLVED', 'UNSUPPORTED_LINE', 'UNMAPPED_BRANCH', 'POSSIBLE_CUP_ORIGIN', 'TOO_RECENT'];
const EXCLUDED_CATEGORIES: ImportCategory[] = ['UNPAID', 'REFUND_UNVERIFIED', 'OTHER'];
const SCAN_LIMIT = 1000; // MAX_LIMIT in poster-transaction-import.service.ts — the most a read-only scan covers per call

export interface ReconciliationQuery extends FinancePeriodQuery {
  branchId?: string;
}

export interface CategoryAmount {
  category: string;
  count: number;
  amountMinor: number;
}

export interface ReconciliationTransaction {
  posterTransactionId: string;
  occurredAt: string | null;
  totalMinor: number;
  paidMinor: number;
  branchName: string | null;
  customerName: string | null;
  hasPosterClient: boolean;
  category: string;
  outcome: string;
  reason?: string;
}

export interface ReconciliationResult {
  period: { key: string; startDate: string; endDate: string };
  branch: { id: string; name: string } | null;
  status: 'RECONCILED' | 'MISMATCH' | 'INCOMPLETE';
  incompleteReason: string | null;

  posterGrossQualifyingSales: { count: number; amountMinor: number };
  cupOriginatedSales: { count: number; amountMinor: number };
  independentPosSales: {
    total: { count: number; amountMinor: number };
    alreadyRecognized: { count: number; amountMinor: number }; // ALREADY_IMPORTED — already in CUP's canonical revenue today
    pending: { count: number; amountMinor: number; byReason: CategoryAmount[] }; // real sales, not yet reflected in canonical revenue
  };

  customerAttribution: {
    knownCustomer: { count: number; amountMinor: number };
    unknownCustomer: { count: number; amountMinor: number };
    unknownBreakdown: { noPosterClient: { count: number; amountMinor: number }; unlinkedPosterClient: { count: number; amountMinor: number } };
  };

  branchAttribution: {
    attributed: { count: number; amountMinor: number };
    unattributed: { count: number; amountMinor: number };
  };

  excluded: CategoryAmount[];

  recognizedRevenue: { cupRevenueMinor: number; posRevenueMinor: number; totalMinor: number };
  crossCheck: { liveScanAlreadyImportedMinor: number; canonicalPosRevenueMinor: number; differenceMinor: number };

  scanned: number;
  truncated: boolean;
  transactions: ReconciliationTransaction[];
}

// Finance-2 — Revenue Reconciliation: a READ-ONLY verification/explanation layer around the EXISTING canonical
// revenue source (AnalyticsRepository.cupTotals/posTotals, unchanged, still the only thing Finance Overview/P&L
// use). This view reuses PosterTransactionImportService.analyze() — the SAME read-only classification the admin
// import preview and data-quality report already use — so reconciliation and import can never disagree. It never
// writes anything (analyze() is documented as never writing), and never performs a real import.
@Injectable()
export class FinanceReconciliationService {
  constructor(
    private readonly importService: PosterTransactionImportService,
    private readonly analytics: AnalyticsRepository,
    private readonly repository: FinanceRepository,
    private readonly config: ConfigService,
  ) {}

  async getReconciliation(query: ReconciliationQuery, now: Date = new Date()): Promise<ReconciliationResult> {
    const offset = this.config.env.BUSINESS_TIMEZONE_OFFSET_MINUTES;
    const range = resolveFinanceRange(query, now, offset);
    const branch = query.branchId ? await this.repository.findBranchWithSpotId(query.branchId) : null;
    if (query.branchId && !branch) throw new BadRequestException('Unknown branch.');

    let scanned = 0;
    let truncated = false;
    let details: ImportDetail[] = [];
    let incompleteReason: string | null = null;
    try {
      const { summary } = await this.importService.analyze({ since: range.startDate, until: range.endDate, limit: SCAN_LIMIT });
      scanned = summary.scanned;
      truncated = summary.truncated;
      details = branch ? summary.details.filter((d) => d.posterSpotId === branch.posterSpotId) : summary.details;
      if (truncated) incompleteReason = `More than ${SCAN_LIMIT} receipts exist in this window — narrow the period for a complete reconciliation.`;
      if (summary.refundPolicy.deletedInPosterWindow === null) incompleteReason = incompleteReason ?? "Poster's deleted-receipt list could not be read for this window.";
    } catch (err) {
      incompleteReason = `The live Poster read failed: ${err instanceof Error ? err.message.split('\n')[0].slice(0, 200) : 'unknown error'}`;
    }

    const sumBy = (cats: ImportCategory[]): { count: number; amountMinor: number } =>
      details.filter((d) => cats.includes(d.category)).reduce((acc, d) => ({ count: acc.count + 1, amountMinor: acc.amountMinor + (d.totalMinor ?? 0) }), { count: 0, amountMinor: 0 });

    const posterGross = sumBy(QUALIFYING_CATEGORIES);
    const cupOriginated = sumBy(['CUP_ORIGINATED']);
    const alreadyRecognized = sumBy(['ALREADY_IMPORTED']);
    const pending = sumBy(PENDING_CATEGORIES);
    const independentTotal = { count: alreadyRecognized.count + pending.count, amountMinor: alreadyRecognized.amountMinor + pending.amountMinor };

    const pendingByReason: CategoryAmount[] = PENDING_CATEGORIES.map((c) => {
      const s = sumBy([c]);
      return { category: c, count: s.count, amountMinor: s.amountMinor };
    }).filter((c) => c.count > 0);

    const excluded: CategoryAmount[] = EXCLUDED_CATEGORIES.map((c) => {
      const s = sumBy([c]);
      return { category: c, count: s.count, amountMinor: s.amountMinor };
    }).filter((c) => c.count > 0);

    // Customer attribution — only meaningful for independent POS receipts (a CUP-originated receipt's "customer" is
    // the CUP order's own customer, tracked elsewhere; this view is specifically about Poster-side attribution).
    const independentDetails = details.filter((d) => [...PENDING_CATEGORIES, 'ALREADY_IMPORTED'].includes(d.category));
    const known = independentDetails.filter((d) => d.customerName !== null && d.customerName !== undefined);
    const unknown = independentDetails.filter((d) => d.customerName === null || d.customerName === undefined);
    const noPosterClient = unknown.filter((d) => d.hasPosterClient === false);
    const unlinkedPosterClient = unknown.filter((d) => d.hasPosterClient === true);
    const sumDetails = (rows: ImportDetail[]) => ({ count: rows.length, amountMinor: rows.reduce((s, d) => s + (d.totalMinor ?? 0), 0) });

    const branchAttributed = details.filter((d) => [...PENDING_CATEGORIES, 'ALREADY_IMPORTED', 'CUP_ORIGINATED'].includes(d.category) && d.branchName !== null && d.branchName !== undefined);
    const branchUnattributed = details.filter((d) => [...PENDING_CATEGORIES, 'ALREADY_IMPORTED', 'CUP_ORIGINATED'].includes(d.category) && (d.branchName === null || d.branchName === undefined));

    // ---- Canonical revenue (UNCHANGED — the exact same source Finance Overview/P&L already use) + a tautological
    // cross-check: "already imported" from THIS live scan must equal "already imported" from the stored table it
    // scanned against, for the same window/branch. Any non-zero difference is a genuine anomaly, never expected.
    const branchId = branch ? branch.id : null;
    const [cup, pos] = await Promise.all([this.analytics.cupTotals({ from: range.from, to: range.to, branchId }), this.analytics.posTotals({ from: range.from, to: range.to, branchId })]);
    const differenceMinor = alreadyRecognized.amountMinor - pos.revenue;

    const status: ReconciliationResult['status'] = incompleteReason ? 'INCOMPLETE' : differenceMinor !== 0 ? 'MISMATCH' : 'RECONCILED';

    return {
      period: { key: query.period, startDate: range.startDate, endDate: range.endDate },
      branch: branch ? { id: branch.id, name: branch.name } : null,
      status,
      incompleteReason,
      posterGrossQualifyingSales: posterGross,
      cupOriginatedSales: cupOriginated,
      independentPosSales: { total: independentTotal, alreadyRecognized, pending: { ...pending, byReason: pendingByReason } },
      customerAttribution: {
        knownCustomer: sumDetails(known),
        unknownCustomer: sumDetails(unknown),
        unknownBreakdown: { noPosterClient: sumDetails(noPosterClient), unlinkedPosterClient: sumDetails(unlinkedPosterClient) },
      },
      branchAttribution: { attributed: sumDetails(branchAttributed), unattributed: sumDetails(branchUnattributed) },
      excluded,
      recognizedRevenue: { cupRevenueMinor: cup.revenue, posRevenueMinor: pos.revenue, totalMinor: cup.revenue + pos.revenue },
      crossCheck: { liveScanAlreadyImportedMinor: alreadyRecognized.amountMinor, canonicalPosRevenueMinor: pos.revenue, differenceMinor },
      scanned,
      truncated,
      transactions: details.map((d) => ({
        posterTransactionId: d.posterTransactionId,
        occurredAt: d.occurredAt ?? null,
        totalMinor: d.totalMinor ?? 0,
        paidMinor: d.paidMinor ?? 0,
        branchName: d.branchName ?? null,
        customerName: d.customerName ?? null,
        hasPosterClient: d.hasPosterClient ?? false,
        category: d.category,
        outcome: d.outcome,
        reason: d.reason,
      })),
    };
  }
}
