import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '../../common/config/config.service';
import { CreateInvestmentData, FinanceRepository, UpdateInvestmentData } from './finance.repository';
import { FinanceCashFlowService } from './finance-cashflow.service';
import { FinancePeriodQuery, resolveFinanceRange } from './finance-period';
import { FinancePnlRepository } from './finance-pnl.repository';
import { FinancePnlService } from './finance-pnl.service';

export interface PaybackView {
  totalInvestmentMinor: number;
  cumulativeCashFlowMinor: number;
  remainingInvestmentMinor: number;
  paybackProgressPct: number | null;
  estimatedPaybackMonths: number | null;
  estimatedPaybackDate: string | null;
  status: 'NO_INVESTMENT_RECORDED' | 'INSUFFICIENT_HISTORY' | 'NEGATIVE_CASH_FLOW' | 'OK';
  note: string;
}

const MIN_MONTHS_FOR_ESTIMATE = 1;

// Finance-1 — Payback and ROI, computed only from real recorded Investment rows and the SAME net
// cash flow FinanceCashFlowService itself reports (never a second, differently-defined cash flow).
// Never fabricates an estimate: NO_INVESTMENT_RECORDED / INSUFFICIENT_HISTORY / NEGATIVE_CASH_FLOW
// are all explicit, reported states, per the spec's own "do not fabricate an estimate" instruction.
@Injectable()
export class FinanceInvestmentService {
  constructor(
    private readonly repository: FinanceRepository,
    private readonly pnlRepository: FinancePnlRepository,
    private readonly cashFlow: FinanceCashFlowService,
    private readonly pnl: FinancePnlService,
    private readonly config: ConfigService,
  ) {}

  list() {
    return this.repository.listInvestments();
  }

  async get(id: string) {
    const investment = await this.repository.findInvestmentById(id);
    if (!investment) throw new NotFoundException('Investment not found.');
    return investment;
  }

  async create(data: CreateInvestmentData, actorId: string) {
    if (data.amountMinor <= 0) throw new BadRequestException('amountMinor must be positive.');
    const investment = await this.repository.createInvestment(data);
    await this.repository.recordAudit(actorId, 'FINANCE_INVESTMENT_CREATED', investment.id);
    return investment;
  }

  async update(id: string, data: UpdateInvestmentData, actorId: string) {
    const existing = await this.repository.findInvestmentById(id);
    if (!existing) throw new NotFoundException('Investment not found.');
    const updated = await this.repository.updateInvestment(id, data);
    await this.repository.recordAudit(actorId, 'FINANCE_INVESTMENT_UPDATED', id);
    return updated;
  }

  async delete(id: string, actorId: string): Promise<void> {
    const existing = await this.repository.findInvestmentById(id);
    if (!existing) throw new NotFoundException('Investment not found.');
    await this.repository.deleteInvestment(id);
    await this.repository.recordAudit(actorId, 'FINANCE_INVESTMENT_DELETED', id);
  }

  async payback(now: Date = new Date()): Promise<PaybackView> {
    const [totalInvestmentMinor, earliestDate] = await Promise.all([this.pnlRepository.totalInitialInvestment(), this.pnlRepository.earliestInvestmentDate()]);
    if (totalInvestmentMinor <= 0 || !earliestDate) {
      return { totalInvestmentMinor: 0, cumulativeCashFlowMinor: 0, remainingInvestmentMinor: 0, paybackProgressPct: null, estimatedPaybackMonths: null, estimatedPaybackDate: null, status: 'NO_INVESTMENT_RECORDED', note: 'No investment has been recorded yet — enter the initial investment first.' };
    }
    const monthsElapsed = monthsBetween(earliestDate, now);
    const cumulativeCashFlowMinor = await this.cashFlow.netCashFlowForRange(earliestDate, now, null);
    const remainingInvestmentMinor = Math.max(0, totalInvestmentMinor - cumulativeCashFlowMinor);
    const paybackProgressPct = Math.min(100, Math.max(0, round2((cumulativeCashFlowMinor / totalInvestmentMinor) * 100)));

    if (monthsElapsed < MIN_MONTHS_FOR_ESTIMATE) {
      return { totalInvestmentMinor, cumulativeCashFlowMinor, remainingInvestmentMinor, paybackProgressPct, estimatedPaybackMonths: null, estimatedPaybackDate: null, status: 'INSUFFICIENT_HISTORY', note: `Only ${monthsElapsed} month(s) of history since the first investment — not enough to project a reliable payback period yet.` };
    }
    const avgMonthlyNetCashFlow = cumulativeCashFlowMinor / monthsElapsed;
    if (avgMonthlyNetCashFlow <= 0) {
      return { totalInvestmentMinor, cumulativeCashFlowMinor, remainingInvestmentMinor, paybackProgressPct, estimatedPaybackMonths: null, estimatedPaybackDate: null, status: 'NEGATIVE_CASH_FLOW', note: 'Average monthly net cash flow since the first investment is zero or negative — payback cannot be projected from current performance.' };
    }
    const estimatedPaybackMonths = round2(totalInvestmentMinor / avgMonthlyNetCashFlow);
    const paybackDate = new Date(earliestDate);
    paybackDate.setUTCMonth(paybackDate.getUTCMonth() + Math.ceil(estimatedPaybackMonths));
    return {
      totalInvestmentMinor,
      cumulativeCashFlowMinor,
      remainingInvestmentMinor,
      paybackProgressPct,
      estimatedPaybackMonths,
      estimatedPaybackDate: paybackDate.toISOString().slice(0, 10),
      status: 'OK',
      note: `Based on average net cash flow over the ${monthsElapsed} month(s) since the first recorded investment.`,
    };
  }

  // ROI = Net Profit (for the selected period) / total recorded Investment × 100. Deliberately NOT the same metric
  // as Payback (cumulative, time-to-recover) or ROAS (marketing spend efficiency, not modelled here at all).
  async roi(query: FinancePeriodQuery, now: Date = new Date()): Promise<{ period: { key: string; startDate: string; endDate: string }; netProfitMinor: number; totalInvestmentMinor: number; roiPct: number | null }> {
    const offset = this.config.env.BUSINESS_TIMEZONE_OFFSET_MINUTES;
    const range = resolveFinanceRange(query, now, offset);
    const [overview, totalInvestmentMinor] = await Promise.all([this.pnl.getOverview({ ...query }, now), this.pnlRepository.totalInitialInvestment()]);
    return {
      period: { key: query.period, startDate: range.startDate, endDate: range.endDate },
      netProfitMinor: overview.netProfit,
      totalInvestmentMinor,
      roiPct: totalInvestmentMinor > 0 ? round2((overview.netProfit / totalInvestmentMinor) * 100) : null,
    };
  }
}

function monthsBetween(from: Date, to: Date): number {
  return Math.max(0, (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth()));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
