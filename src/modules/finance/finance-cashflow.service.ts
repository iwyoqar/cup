import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '../../common/config/config.service';
import { AnalyticsRepository, QueryRange } from '../analytics/analytics.repository';
import { FinanceRepository } from './finance.repository';
import { FinancePeriodQuery, resolveFinanceRange } from './finance-period';
import { FinancePnlRepository } from './finance-pnl.repository';

export interface CashFlowQuery extends FinancePeriodQuery {
  branchId?: string;
}

export interface CashFlowOverview {
  period: { key: string; startDate: string; endDate: string };
  branch: { id: string; name: string } | null;
  openingBalance: number; // computed cumulative net cash flow before this period — NOT reconciled against a real bank statement (see note)
  cashIn: { revenue: number; manualAdjustments: number; total: number };
  cashOut: {
    operatingExpensesPaid: number;
    financialExpensesPaid: number;
    loanPrincipal: number;
    loanInterest: number;
    investments: number;
    manualAdjustments: number;
    total: number;
  };
  netCashFlow: number;
  closingBalance: number;
  limitations: string[];
}

// Finance-1 — Cash Flow is DELIBERATELY not the same number as Net Profit (the spec's own explicit instruction):
// it only ever counts money that actually moved (paid expenses, recorded loan payments, recorded investments,
// manual adjustments), never an accrual figure like incurred-but-unpaid expenses or theoretical COGS. Two real
// gaps in what CUP tracks today are surfaced as `limitations`, never silently estimated: (1) no separate
// inventory-PURCHASE tracking exists (only theoretical COGS of what was sold, an accrual concept — so no
// "inventory purchases" cash-out line is computed), and (2) "taxes paid" has no real payment record, so it is
// left out of cash flow entirely rather than substituting the computed P&L tax liability as if it were a payment.
@Injectable()
export class FinanceCashFlowService {
  constructor(
    private readonly analytics: AnalyticsRepository,
    private readonly repository: FinancePnlRepository,
    private readonly financeRepository: FinanceRepository,
    private readonly config: ConfigService,
  ) {}

  async getOverview(query: CashFlowQuery, now: Date = new Date()): Promise<CashFlowOverview> {
    const offset = this.config.env.BUSINESS_TIMEZONE_OFFSET_MINUTES;
    const range = resolveFinanceRange(query, now, offset);
    const branch = query.branchId ? await this.financeRepository.findBranch(query.branchId) : null;
    if (query.branchId && !branch) throw new BadRequestException('Unknown branch.');
    const branchId = branch ? branch.id : null;

    const [periodTotals, openingBalance] = await Promise.all([this.periodTotals(range.from, range.to, branchId), this.cumulativeNetCashFlow(new Date(0), range.from, branchId)]);

    const cashIn = { revenue: periodTotals.revenue, manualAdjustments: periodTotals.positiveAdjustments, total: periodTotals.revenue + periodTotals.positiveAdjustments };
    const cashOut = {
      operatingExpensesPaid: periodTotals.operatingExpensesPaid,
      financialExpensesPaid: periodTotals.financialExpensesPaid,
      loanPrincipal: periodTotals.loanPrincipal,
      loanInterest: periodTotals.loanInterest,
      investments: periodTotals.investments,
      manualAdjustments: periodTotals.negativeAdjustments,
      total: periodTotals.operatingExpensesPaid + periodTotals.financialExpensesPaid + periodTotals.loanPrincipal + periodTotals.loanInterest + periodTotals.investments + periodTotals.negativeAdjustments,
    };
    const netCashFlow = cashIn.total - cashOut.total;

    return {
      period: { key: query.period, startDate: range.startDate, endDate: range.endDate },
      branch,
      openingBalance,
      cashIn,
      cashOut,
      netCashFlow,
      closingBalance: openingBalance + netCashFlow,
      limitations: [
        'Inventory purchase cash outflow is not tracked separately (no purchasing/supply module) — only theoretical COGS of goods sold is available, which is an accrual figure, not a cash payment, so it is excluded here.',
        'Tax payments are not tracked as real cash events — this view excludes taxes entirely (see the P&L view for the computed tax liability).',
        'Opening balance is a computed cumulative total of everything CUP has recorded since the beginning, not reconciled against a real bank/cash statement.',
      ],
    };
  }

  private async periodTotals(from: Date, to: Date, branchId: string | null) {
    const q: QueryRange = { from, to, branchId };
    const [cup, pos, expensesByCategory, paidTotal, loanInterest, loanPrincipal, investments, adjustments] = await Promise.all([
      this.analytics.cupTotals(q),
      this.analytics.posTotals(q),
      this.repository.expensesByCategory(from, to, branchId),
      this.repository.paidExpenseTotal(from, to, branchId),
      this.repository.loanInterestTotal(from, to),
      this.repository.loanPrincipalTotal(from, to),
      this.repository.investmentTotal(from, to, branchId),
      this.financeRepository.listCashAdjustments(from, to),
    ]);
    // paidExpenseTotal is PAID expenses of every type; split it operating/financial using the same category-type
    // ratio expensesByCategory reports (both queries share the same date/branch filter, so this split is exact
    // for a period where PAID and incurred coincide — a genuine unpaid-then-later-paid case is a known,
    // documented simplification of this v1 view, not silently hidden: see the type-level breakdown in the UI).
    const financialCategoryIds = new Set(expensesByCategory.filter((c) => c.type === 'FINANCIAL').map((c) => c.categoryId));
    const financialShareOfIncurred = expensesByCategory.reduce((s, c) => s + (financialCategoryIds.has(c.categoryId) ? c.amountMinor : 0), 0);
    const totalIncurred = expensesByCategory.reduce((s, c) => s + c.amountMinor, 0);
    const financialExpensesPaid = totalIncurred > 0 ? Math.round((paidTotal * financialShareOfIncurred) / totalIncurred) : 0;
    const operatingExpensesPaid = paidTotal - financialExpensesPaid;

    const branchAdjustments = branchId ? adjustments.filter((a) => a.branchId === branchId) : adjustments;
    const positiveAdjustments = branchAdjustments.filter((a) => a.amountMinor > 0).reduce((s, a) => s + a.amountMinor, 0);
    const negativeAdjustments = branchAdjustments.filter((a) => a.amountMinor < 0).reduce((s, a) => s + -a.amountMinor, 0);

    return { revenue: cup.revenue + pos.revenue, operatingExpensesPaid, financialExpensesPaid, loanInterest, loanPrincipal, investments, positiveAdjustments, negativeAdjustments };
  }

  private async cumulativeNetCashFlow(from: Date, to: Date, branchId: string | null): Promise<number> {
    return this.netCashFlowForRange(from, to, branchId);
  }

  // Exposed for FinanceInvestmentService's Payback calculation — the SAME net-cash-flow definition
  // this view itself reports, never a second one computed differently.
  async netCashFlowForRange(from: Date, to: Date, branchId: string | null): Promise<number> {
    const t = await this.periodTotals(from, to, branchId);
    const cashIn = t.revenue + t.positiveAdjustments;
    const cashOut = t.operatingExpensesPaid + t.financialExpensesPaid + t.loanPrincipal + t.loanInterest + t.investments + t.negativeAdjustments;
    return cashIn - cashOut;
  }
}
