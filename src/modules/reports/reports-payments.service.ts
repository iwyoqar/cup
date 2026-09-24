import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '../../common/config/config.service';
import { AnalyticsRepository } from '../analytics/analytics.repository';
import { OverviewQuery } from '../analytics/analytics.service';
import { resolveAnalyticsRange } from '../analytics/analytics-period';
import { BranchIntelligenceRepository } from '../branch-intelligence/branch-intelligence.repository';
import { PosterReportsService } from './poster-reports.service';

export interface ReportsPaymentRow {
  paymentId: string; // Poster's own payment-field id (e.g. "cash", "card") — stable key, independent of the display name
  name: string;
  amountMinor: number; // whole UZS
  sharePercent: number; // of the listed methods' combined amount, 2 decimals; display only, never used in money math
}

export interface ReportsPaymentsOverview {
  period: { key: OverviewQuery['period']; startDate: string; endDate: string; timezoneOffsetMinutes: number };
  branch: { id: string; name: string } | null;
  filters: { branches: { id: string; name: string }[] };
  branchFilterSupported: boolean;
  source: 'POSTER';
  available: boolean;
  unavailableReason: 'poster_unavailable' | 'malformed_response' | null;
  // null (never 0) whenever available=false — a missing Poster read is never shown as a real zero.
  totalPaymentsMinor: number | null; // Poster's own all-methods total (payed_sum_sum)
  methodsTotalMinor: number | null; // sum of the rows below — equals totalPaymentsMinor unless Poster's two figures differ
  payments: ReportsPaymentRow[]; // non-zero methods only, largest first
  cupRevenueMinor: number; // CUP canonical revenue for the same range/branch — REFERENCE ONLY, never combined with the above
  warnings: string[];
}

// Reports Phase B2 — "How were sales paid?". Payment methods come from Poster (dash.getPaymentsReport via
// PosterReportsService), the only system holding the complete payment-method history. This is OBSERVATIONAL: nothing
// here feeds AnalyticsRepository, Finance, Branch Intelligence or any other report's revenue. CUP's canonical revenue
// is read (AnalyticsService.getOverview — unchanged) only to show it side by side and to flag a discrepancy; the two
// figures are never added, netted or substituted for each other.
@Injectable()
export class ReportsPaymentsService {
  constructor(
    private readonly analyticsRepository: AnalyticsRepository,
    private readonly branchIntelligenceRepository: BranchIntelligenceRepository,
    private readonly posterReports: PosterReportsService,
    private readonly config: ConfigService,
  ) {}

  async getPayments(query: OverviewQuery, now: Date = new Date()): Promise<ReportsPaymentsOverview> {
    const offset = this.config.env.BUSINESS_TIMEZONE_OFFSET_MINUTES;
    // Same canonical resolver as every other Reports page — invalid custom ranges throw BadRequestException here.
    const range = resolveAnalyticsRange(query, now, offset);
    const dateFromYmd = range.startDate.replace(/-/g, '');
    const dateToYmd = range.endDate.replace(/-/g, '');

    // Branch → Poster spot via the existing Branch.posterSpotId mapping only (dash.getPaymentsReport documents spot_id).
    const allBranches = await this.branchIntelligenceRepository.listBranches();
    const branch = query.branchId ? allBranches.find((b) => b.id === query.branchId) : undefined;
    if (query.branchId && !branch) throw new BadRequestException('Unknown branch.');
    const spotId = branch ? String(branch.posterSpotId) : undefined;

    // Phase H: CUP revenue = AnalyticsRepository.cupTotals + posTotals — exactly the two figures AnalyticsService.getOverview
    // adds for its `revenue` — instead of running the whole Analytics overview (customers, products, daily series) for one number.
    const q = { from: range.from, to: range.to, branchId: branch ? branch.id : null };
    const [cup, pos, poster] = await Promise.all([this.analyticsRepository.cupTotals(q), this.analyticsRepository.posTotals(q), this.posterReports.getPaymentsBreakdown(dateFromYmd, dateToYmd, spotId)]);
    const overview = { revenue: cup.revenue + pos.revenue };

    const base = {
      period: { key: query.period, startDate: range.startDate, endDate: range.endDate, timezoneOffsetMinutes: offset },
      branch: branch ? { id: branch.id, name: branch.name } : null,
      filters: { branches: allBranches.filter((b) => b.isActive).map((b) => ({ id: b.id, name: b.name })) },
      branchFilterSupported: true,
      source: 'POSTER' as const,
      cupRevenueMinor: overview.revenue,
    };

    if (!poster.available) {
      return { ...base, available: false, unavailableReason: poster.reason, totalPaymentsMinor: null, methodsTotalMinor: null, payments: [], warnings: [] };
    }

    const rows = poster.methods.filter((m) => m.rawAmount !== 0);
    const methodsTotalMinor = rows.reduce((sum, m) => sum + m.amountMinor, 0);
    const payments: ReportsPaymentRow[] = rows
      .map((m) => ({
        paymentId: m.paymentId,
        name: m.name,
        amountMinor: m.amountMinor,
        // Integer basis points on Poster's exact raw scale, then /100 for display.
        sharePercent: poster.rawMethodsSum !== 0 ? Math.round((m.rawAmount * 10_000) / poster.rawMethodsSum) / 100 : 0,
      }))
      .sort((a, b) => b.amountMinor - a.amountMinor || a.paymentId.localeCompare(b.paymentId));

    const warnings: string[] = [];
    if (poster.rawMethodsSum !== poster.rawTotal) {
      warnings.push("Poster's payment total differs from the sum of its payment methods (e.g. gift-certificate or points payments may be counted differently by Poster). Both figures are shown as Poster reports them.");
    }
    // Magnitude guard: dash.getPaymentsReport is documented in kopecks (/100 applied in poster-money.ts), but its sibling
    // dash.getSpotsSales — also documented in kopecks — was verified live to return whole so'm. A ~100x gap against CUP's
    // own revenue for the same range is the signature of that unit mismatch, so it is called out explicitly, never
    // silently "corrected" by switching scale.
    const ratio = overview.revenue > 0 && poster.totalMinor > 0 ? poster.totalMinor / overview.revenue : null;
    if (ratio !== null && (ratio > 20 || ratio < 0.05)) {
      warnings.push("Poster's payment total is more than 20x away from CUP revenue for the same period. This usually indicates a unit mismatch in Poster's report; treat these amounts as unverified.");
    } else if (poster.totalMinor !== overview.revenue) {
      warnings.push('Payment totals are sourced from Poster and may differ from CUP revenue due to source and period semantics (Poster account days vs. CUP business days, and sales recorded in only one system).');
    }

    return { ...base, available: true, unavailableReason: null, totalPaymentsMinor: poster.totalMinor, methodsTotalMinor, payments, warnings };
  }
}
