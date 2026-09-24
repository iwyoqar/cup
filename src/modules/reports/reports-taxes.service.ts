import { Injectable } from '@nestjs/common';
import { ConfigService } from '../../common/config/config.service';
import { AnalyticsPeriod, resolveAnalyticsRange } from '../analytics/analytics-period';
import { FinancePnlService } from '../finance/finance-pnl.service';
import { FinanceTaxService } from '../finance/finance-tax.service';
import { PosterReportsService, PosterTaxConfig } from './poster-reports.service';

export interface TaxesReportQuery {
  period: AnalyticsPeriod;
  startDate?: string;
  endDate?: string;
  branchId?: string;
}

export interface ReportsCupTaxRule {
  ruleId: string;
  name: string;
  ratePct: number;
  calculationBase: string; // REVENUE | GROSS_PROFIT | OPERATING_PROFIT — shown as-is
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
  applied: boolean; // true when Finance's own P&L applied it to this period
  baseAmountMinor: number | null; // Finance's base figure (null when not applied)
  liabilityMinor: number | null; // Finance's calculated liability (null when not applied)
  notAppliedReason: 'INACTIVE' | 'NOT_IN_EFFECT' | 'PARTIAL_PERIOD_NOT_PRORATED' | null;
}

export interface ReportsTaxesOverview {
  period: { key: AnalyticsPeriod; startDate: string; endDate: string; timezoneOffsetMinutes: number };
  branch: { id: string; name: string } | null;
  filters: { branches: { id: string; name: string }[] };
  poster: {
    source: 'POSTER';
    available: boolean;
    unavailableReason: 'poster_unavailable' | 'malformed_response' | null;
    reportsAmounts: false; // finance.getTaxes is a configuration list — Poster reports no tax amount through it
    taxes: PosterTaxConfig[];
  };
  cup: {
    source: 'CUP_FINANCE';
    calculatedLiabilityMinor: number;
    appliedRules: number;
    activeRules: number;
    rules: ReportsCupTaxRule[];
    scopeNote: string;
  };
  actualTaxPaid: { tracked: false };
  notes: string[];
}

// Reports Phase E — Taxes. Two sources, never merged, never subtracted from each other:
//   Poster POS  — finance.getTaxes: Poster's configured tax list (names, rates, types). It has no period and no amounts.
//   CUP Finance — FinancePnlService.getOverview().taxes: the EXACT liability Finance's P&L computes (no second tax engine
//                 here; Reports periods are passed to Finance as the equivalent custom business-date range, which resolves
//                 to identical UTC instants because both resolvers share rangeFor()).
// Actual tax payments are not tracked anywhere in CUP, so nothing is labelled "paid".
@Injectable()
export class ReportsTaxesService {
  constructor(
    private readonly pnl: FinancePnlService,
    private readonly taxRules: FinanceTaxService,
    private readonly posterReports: PosterReportsService,
    private readonly config: ConfigService,
  ) {}

  async getTaxes(query: TaxesReportQuery, now: Date = new Date()): Promise<ReportsTaxesOverview> {
    const offset = this.config.env.BUSINESS_TIMEZONE_OFFSET_MINUTES;
    const range = resolveAnalyticsRange(query, now, offset);
    // FinancePnlService validates branchId itself (400 "Unknown branch.").
    const [pnl, rules, poster] = await Promise.all([
      this.pnl.getOverview({ period: 'custom', startDate: range.startDate, endDate: range.endDate, branchId: query.branchId }, now),
      this.taxRules.list(),
      this.posterReports.getTaxes(),
    ]);

    const appliedById = new Map(pnl.taxes.lines.map((l) => [l.ruleId, l]));
    const cupRules: ReportsCupTaxRule[] = rules.map((r) => {
      const line = appliedById.get(r.id);
      // Explanation only, mirroring the condition in FinancePnlService (which alone decides what is applied).
      const overlaps = r.effectiveFrom < range.to && (!r.effectiveTo || r.effectiveTo >= range.from);
      const notAppliedReason: ReportsCupTaxRule['notAppliedReason'] = line ? null : !r.isActive ? 'INACTIVE' : !overlaps ? 'NOT_IN_EFFECT' : 'PARTIAL_PERIOD_NOT_PRORATED';
      return {
        ruleId: r.id,
        name: r.name,
        ratePct: r.ratePct,
        calculationBase: r.calculationBase,
        effectiveFrom: r.effectiveFrom.toISOString(),
        effectiveTo: r.effectiveTo ? r.effectiveTo.toISOString() : null,
        isActive: r.isActive,
        applied: !!line,
        baseAmountMinor: line ? line.baseAmountMinor : null,
        liabilityMinor: line ? line.amountMinor : null,
        notAppliedReason,
      };
    });
    cupRules.sort((a, b) => Number(b.applied) - Number(a.applied) || a.name.localeCompare(b.name) || a.ruleId.localeCompare(b.ruleId));

    const notes = [
      "Poster's finance.getTaxes returns Poster's configured taxes (name, rate, type) — not tax amounts for a period — so no Poster tax total is shown and Poster and CUP figures are not compared.",
      'CUP calculated liability is computed by CUP Finance from its configured tax rules — it is not a record of tax actually paid.',
    ];
    if (cupRules.some((r) => r.notAppliedReason === 'PARTIAL_PERIOD_NOT_PRORATED')) notes.push('A rule that is only in effect for part of the selected period is not applied — CUP Finance does not prorate tax rules.');

    return {
      period: { key: query.period, startDate: range.startDate, endDate: range.endDate, timezoneOffsetMinutes: offset },
      branch: pnl.branch,
      filters: pnl.filters,
      poster: poster.available
        ? { source: 'POSTER', available: true, unavailableReason: null, reportsAmounts: false, taxes: poster.taxes }
        : { source: 'POSTER', available: false, unavailableReason: poster.reason, reportsAmounts: false, taxes: [] },
      cup: {
        source: 'CUP_FINANCE',
        calculatedLiabilityMinor: pnl.taxes.total,
        appliedRules: pnl.taxes.lines.length,
        activeRules: rules.filter((r) => r.isActive).length,
        rules: cupRules,
        scopeNote: pnl.branch
          ? `Tax rules are global; this liability is Finance's calculation on ${pnl.branch.name}'s own revenue/profit figures.`
          : 'Tax rules are global; this liability is calculated on all-branch revenue/profit figures.',
      },
      actualTaxPaid: { tracked: false },
      notes,
    };
  }
}
