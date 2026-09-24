import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface CreateExpenseCategoryData {
  name: string;
  type: string;
  sortOrder?: number;
}
export interface UpdateExpenseCategoryData {
  name?: string;
  type?: string;
  sortOrder?: number;
  isActive?: boolean;
}

export interface CreateExpenseData {
  categoryId: string;
  description: string;
  amountMinor: number;
  date: Date;
  branchId?: string | null;
  isRecurring?: boolean;
  recurrenceInterval?: string | null;
  paymentStatus?: string;
  notes?: string | null;
  createdBy: string;
}
export interface UpdateExpenseData {
  categoryId?: string;
  description?: string;
  amountMinor?: number;
  date?: Date;
  branchId?: string | null;
  isRecurring?: boolean;
  recurrenceInterval?: string | null;
  paymentStatus?: string;
  notes?: string | null;
}

export interface CreateLoanData {
  lender: string;
  principalMinor: number;
  annualInterestRatePct: number;
  termMonths: number;
  startDate: Date;
  notes?: string | null;
  createdBy: string;
}
export interface UpdateLoanData {
  lender?: string;
  principalMinor?: number;
  annualInterestRatePct?: number;
  termMonths?: number;
  startDate?: Date;
  status?: string;
  notes?: string | null;
}
export interface CreateLoanPaymentData {
  loanId: string;
  date: Date;
  principalMinor: number;
  interestMinor: number;
  notes?: string | null;
  createdBy: string;
}

export interface CreateTaxRuleData {
  name: string;
  ratePct: number;
  calculationBase: string;
  effectiveFrom: Date;
  effectiveTo?: Date | null;
  notes?: string | null;
  createdBy: string;
}
export interface UpdateTaxRuleData {
  name?: string;
  ratePct?: number;
  calculationBase?: string;
  isActive?: boolean;
  effectiveFrom?: Date;
  effectiveTo?: Date | null;
  notes?: string | null;
}

export interface CreateInvestmentData {
  category: string;
  description: string;
  amountMinor: number;
  date: Date;
  branchId?: string | null;
  paymentSource?: string | null;
  notes?: string | null;
  createdBy: string;
}
export interface UpdateInvestmentData {
  category?: string;
  description?: string;
  amountMinor?: number;
  date?: Date;
  branchId?: string | null;
  paymentSource?: string | null;
  notes?: string | null;
}

export interface CreateCashAdjustmentData {
  date: Date;
  amountMinor: number;
  reason: string;
  branchId?: string | null;
  createdBy: string;
}

@Injectable()
export class FinanceRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ---- audit -----------------------------------------------------------------------------------------------
  // StaffScanEvent is the SHARED admin/staff audit table (customerId/branchId both optional) — reused directly
  // rather than adding a second finance-only audit table. See prisma/schema.prisma's own comment on this table.
  recordAudit(actorId: string, action: string, result: string) {
    return this.prisma.staffScanEvent.create({ data: { actorType: 'ADMIN', actorId, action, result, customerId: null, branchId: null } });
  }

  // ---- expense categories -----------------------------------------------------------------------------------

  findAllExpenseCategories(includeInactive: boolean) {
    return this.prisma.expenseCategory.findMany({ where: includeInactive ? {} : { isActive: true }, orderBy: { sortOrder: 'asc' } });
  }

  findExpenseCategoryById(id: string) {
    return this.prisma.expenseCategory.findUnique({ where: { id } });
  }

  createExpenseCategory(data: CreateExpenseCategoryData) {
    return this.prisma.expenseCategory.create({ data: { name: data.name, type: data.type, sortOrder: data.sortOrder ?? 0 } });
  }

  updateExpenseCategory(id: string, data: UpdateExpenseCategoryData) {
    return this.prisma.expenseCategory.update({ where: { id }, data });
  }

  // ---- expenses ----------------------------------------------------------------------------------------------

  createExpense(data: CreateExpenseData) {
    return this.prisma.expense.create({ data });
  }

  updateExpense(id: string, data: UpdateExpenseData) {
    return this.prisma.expense.update({ where: { id }, data });
  }

  findExpenseById(id: string) {
    return this.prisma.expense.findUnique({ where: { id }, include: { category: true, branch: true } });
  }

  async deleteExpense(id: string): Promise<void> {
    await this.prisma.expense.delete({ where: { id } });
  }

  async listExpenses(args: { from?: Date; to?: Date; branchId?: string; categoryId?: string; cursor?: string; limit: number }) {
    const where = {
      ...(args.from || args.to ? { date: { ...(args.from ? { gte: args.from } : {}), ...(args.to ? { lt: args.to } : {}) } } : {}),
      ...(args.branchId ? { branchId: args.branchId } : {}),
      ...(args.categoryId ? { categoryId: args.categoryId } : {}),
    };
    const rows = await this.prisma.expense.findMany({
      where,
      include: { category: true, branch: true },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      take: args.limit + 1,
      ...(args.cursor ? { cursor: { id: args.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > args.limit;
    return { rows: rows.slice(0, args.limit), nextCursor: hasMore ? rows[args.limit].id : null };
  }

  // Recurring-expense generation (finance-recurring-expense.job.ts): the most recent recurring row for a given
  // (categoryId, description, branchId) "series" — the template the next occurrence is copied from.
  async findLatestRecurringExpense(categoryId: string, description: string, branchId: string | null) {
    return this.prisma.expense.findFirst({
      where: { categoryId, description, branchId, isRecurring: true },
      orderBy: { date: 'desc' },
    });
  }

  async findAllRecurringSeries() {
    // One row per distinct (categoryId, description, branchId) series, represented by its latest occurrence.
    const rows = await this.prisma.expense.findMany({ where: { isRecurring: true }, orderBy: { date: 'desc' } });
    const seen = new Set<string>();
    const latest: typeof rows = [];
    for (const r of rows) {
      const key = `${r.categoryId}:${r.description}:${r.branchId ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      latest.push(r);
    }
    return latest;
  }

  // ---- loans -------------------------------------------------------------------------------------------------

  createLoan(data: CreateLoanData) {
    return this.prisma.loan.create({ data });
  }

  updateLoan(id: string, data: UpdateLoanData) {
    return this.prisma.loan.update({ where: { id }, data });
  }

  findLoanById(id: string) {
    return this.prisma.loan.findUnique({ where: { id }, include: { payments: { orderBy: { date: 'desc' } } } });
  }

  listLoans() {
    return this.prisma.loan.findMany({ include: { payments: true }, orderBy: { startDate: 'desc' } });
  }

  createLoanPayment(data: CreateLoanPaymentData) {
    return this.prisma.loanPayment.create({ data });
  }

  // ---- tax rules -----------------------------------------------------------------------------------------------

  createTaxRule(data: CreateTaxRuleData) {
    return this.prisma.taxRule.create({ data });
  }

  updateTaxRule(id: string, data: UpdateTaxRuleData) {
    return this.prisma.taxRule.update({ where: { id }, data });
  }

  findTaxRuleById(id: string) {
    return this.prisma.taxRule.findUnique({ where: { id } });
  }

  listTaxRules() {
    return this.prisma.taxRule.findMany({ orderBy: { effectiveFrom: 'desc' } });
  }

  // Rules that could apply to ANY moment within [from, to) — the P&L service still checks
  // per-rule effectiveFrom/effectiveTo against the exact period before including it (a rule that
  // starts or ends mid-period is flagged, never silently prorated).
  findActiveTaxRulesOverlapping(from: Date, to: Date) {
    return this.prisma.taxRule.findMany({
      where: { isActive: true, effectiveFrom: { lt: to }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }] },
    });
  }

  // ---- investments ---------------------------------------------------------------------------------------------

  createInvestment(data: CreateInvestmentData) {
    return this.prisma.investment.create({ data });
  }

  updateInvestment(id: string, data: UpdateInvestmentData) {
    return this.prisma.investment.update({ where: { id }, data });
  }

  findInvestmentById(id: string) {
    return this.prisma.investment.findUnique({ where: { id } });
  }

  async deleteInvestment(id: string): Promise<void> {
    await this.prisma.investment.delete({ where: { id } });
  }

  listInvestments() {
    return this.prisma.investment.findMany({ include: { branch: true }, orderBy: { date: 'desc' } });
  }

  // ---- cash adjustments -------------------------------------------------------------------------------------

  createCashAdjustment(data: CreateCashAdjustmentData) {
    return this.prisma.cashAdjustment.create({ data });
  }

  listCashAdjustments(from: Date, to: Date) {
    return this.prisma.cashAdjustment.findMany({ where: { date: { gte: from, lt: to } }, orderBy: { date: 'desc' } });
  }

  // ---- reference -----------------------------------------------------------------------------------------------

  findActiveBranches() {
    return this.prisma.branch.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
  }

  findBranch(id: string) {
    return this.prisma.branch.findUnique({ where: { id }, select: { id: true, name: true } });
  }

  // Finance-2 (Reconciliation) — the live Poster scan (poster-transaction-import.service.ts's analyze()) reports each
  // receipt's Poster posterSpotId, not a CUP branchId; this is how a branch filter on the reconciliation view is
  // applied to that scan's in-memory details, without re-scanning per branch.
  findBranchWithSpotId(id: string) {
    return this.prisma.branch.findUnique({ where: { id }, select: { id: true, name: true, posterSpotId: true } });
  }
}
