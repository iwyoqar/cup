import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateLoanData, CreateLoanPaymentData, FinanceRepository, UpdateLoanData } from './finance.repository';

export interface LoanView {
  id: string;
  lender: string;
  principalMinor: number;
  annualInterestRatePct: number;
  termMonths: number;
  startDate: Date;
  status: string;
  notes: string | null;
  estimatedMonthlyPaymentMinor: number;
  outstandingPrincipalMinor: number;
  totalPrincipalPaidMinor: number;
  totalInterestPaidMinor: number;
  paymentsMade: number;
  nextEstimatedPaymentDate: string | null; // YYYY-MM-DD, null once fully paid off or the count reaches termMonths
}

// Standard fixed-rate amortization. principalMinor stays an integer minor-unit the whole way
// through; only the final rounding to a payment amount happens in float space, matching how a
// real bank quotes a fixed monthly payment (never compounds a rounding error into the ledger,
// since actual LoanPayment rows are what the ledger sums, not this estimate).
function monthlyPayment(principalMinor: number, annualRatePct: number, termMonths: number): number {
  if (termMonths <= 0) return principalMinor;
  const r = annualRatePct / 100 / 12;
  if (r === 0) return Math.round(principalMinor / termMonths);
  const payment = (principalMinor * r) / (1 - Math.pow(1 + r, -termMonths));
  return Math.round(payment);
}

@Injectable()
export class FinanceLoanService {
  constructor(private readonly repository: FinanceRepository) {}

  async list(): Promise<LoanView[]> {
    const loans = await this.repository.listLoans();
    return loans.map((l) => this.toView(l));
  }

  async get(id: string): Promise<LoanView> {
    const loan = await this.repository.findLoanById(id);
    if (!loan) throw new NotFoundException('Loan not found.');
    return this.toView(loan);
  }

  async create(data: CreateLoanData, actorId: string) {
    if (data.principalMinor <= 0) throw new BadRequestException('principalMinor must be positive.');
    if (data.annualInterestRatePct < 0) throw new BadRequestException('annualInterestRatePct cannot be negative.');
    if (data.termMonths <= 0) throw new BadRequestException('termMonths must be positive.');
    const loan = await this.repository.createLoan(data);
    await this.repository.recordAudit(actorId, 'FINANCE_LOAN_CREATED', loan.id);
    return this.get(loan.id);
  }

  async update(id: string, data: UpdateLoanData, actorId: string) {
    const existing = await this.repository.findLoanById(id);
    if (!existing) throw new NotFoundException('Loan not found.');
    await this.repository.updateLoan(id, data);
    await this.repository.recordAudit(actorId, 'FINANCE_LOAN_UPDATED', id);
    return this.get(id);
  }

  async recordPayment(data: CreateLoanPaymentData, actorId: string) {
    const loan = await this.repository.findLoanById(data.loanId);
    if (!loan) throw new NotFoundException('Loan not found.');
    if (data.principalMinor < 0 || data.interestMinor < 0) throw new BadRequestException('Payment amounts cannot be negative.');
    const outstanding = loan.principalMinor - loan.payments.reduce((s, p) => s + p.principalMinor, 0);
    if (data.principalMinor > outstanding) throw new BadRequestException(`Principal payment (${data.principalMinor}) exceeds outstanding balance (${outstanding}).`);
    await this.repository.createLoanPayment(data);
    const newOutstanding = outstanding - data.principalMinor;
    if (newOutstanding <= 0 && loan.status === 'ACTIVE') await this.repository.updateLoan(loan.id, { status: 'PAID_OFF' });
    await this.repository.recordAudit(actorId, 'FINANCE_LOAN_PAYMENT_RECORDED', data.loanId);
    return this.get(data.loanId);
  }

  private toView(loan: { id: string; lender: string; principalMinor: number; annualInterestRatePct: number; termMonths: number; startDate: Date; status: string; notes: string | null; payments: { principalMinor: number; interestMinor: number }[] }): LoanView {
    const totalPrincipalPaidMinor = loan.payments.reduce((s, p) => s + p.principalMinor, 0);
    const totalInterestPaidMinor = loan.payments.reduce((s, p) => s + p.interestMinor, 0);
    const outstandingPrincipalMinor = loan.principalMinor - totalPrincipalPaidMinor;
    const paymentsMade = loan.payments.length;
    let nextEstimatedPaymentDate: string | null = null;
    if (loan.status === 'ACTIVE' && outstandingPrincipalMinor > 0 && paymentsMade < loan.termMonths) {
      const next = new Date(loan.startDate);
      next.setUTCMonth(next.getUTCMonth() + paymentsMade + 1);
      nextEstimatedPaymentDate = next.toISOString().slice(0, 10);
    }
    return {
      id: loan.id,
      lender: loan.lender,
      principalMinor: loan.principalMinor,
      annualInterestRatePct: loan.annualInterestRatePct,
      termMonths: loan.termMonths,
      startDate: loan.startDate,
      status: loan.status,
      notes: loan.notes,
      estimatedMonthlyPaymentMinor: monthlyPayment(loan.principalMinor, loan.annualInterestRatePct, loan.termMonths),
      outstandingPrincipalMinor,
      totalPrincipalPaidMinor,
      totalInterestPaidMinor,
      paymentsMade,
      nextEstimatedPaymentDate,
    };
  }
}
