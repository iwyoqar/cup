import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Delete, Query, UseGuards } from '@nestjs/common';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard';
import { CurrentAdmin } from '../admin-auth/current-admin.decorator';
import { FinanceCashAdjustmentService } from './finance-cash-adjustment.service';
import { FinanceCashFlowService } from './finance-cashflow.service';
import { FinanceCogsRepository } from './finance-cogs.repository';
import { FinanceCogsSyncService } from './finance-cogs-sync.service';
import { FinanceExpenseService } from './finance-expense.service';
import { FinanceInvestmentService } from './finance-investment.service';
import { FinanceLoanService } from './finance-loan.service';
import { FinancePeriodQuery } from './finance-period';
import { FinancePnlService } from './finance-pnl.service';
import { FinanceReconciliationService } from './finance-reconciliation.service';
import { FinanceTaxService } from './finance-tax.service';
import {
  createCashAdjustmentSchema,
  createExpenseCategorySchema,
  createExpenseSchema,
  createInvestmentSchema,
  createLoanPaymentSchema,
  createLoanSchema,
  createTaxRuleSchema,
  listExpensesQuerySchema,
  periodQuerySchema,
  updateExpenseCategorySchema,
  updateExpenseSchema,
  updateInvestmentSchema,
  updateLoanSchema,
  updateTaxRuleSchema,
} from './finance.dto';

function parse<T>(schema: { safeParse: (v: unknown) => { success: boolean; data?: T; error?: unknown } }, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequestException(result.error);
  return result.data as T;
}

// Every route here is Admin-only. This is an accounting CALCULATION engine over CUP's own already-recorded data —
// see each service's own header comment for what is reused (Revenue/COGS) vs newly modelled (Expenses/Loans/
// Taxes/Investments) and what is deliberately left as "Data incomplete" rather than fabricated.
@UseGuards(AdminAuthGuard)
@Controller('admin/finance')
export class FinanceController {
  constructor(
    private readonly pnl: FinancePnlService,
    private readonly cashFlow: FinanceCashFlowService,
    private readonly expenses: FinanceExpenseService,
    private readonly loans: FinanceLoanService,
    private readonly taxes: FinanceTaxService,
    private readonly investments: FinanceInvestmentService,
    private readonly cashAdjustments: FinanceCashAdjustmentService,
    private readonly cogsRepository: FinanceCogsRepository,
    private readonly cogsSync: FinanceCogsSyncService,
    private readonly reconciliation: FinanceReconciliationService,
  ) {}

  private periodQuery(query: Record<string, string | undefined>): FinancePeriodQuery & { branchId?: string } {
    return parse(periodQuerySchema, query);
  }

  // ---- overview / P&L / cash flow ---------------------------------------------------------------------------

  @Get('overview')
  overview(@Query() query: Record<string, string | undefined>) {
    return this.pnl.getOverview(this.periodQuery(query));
  }

  @Get('pnl')
  pnlStatement(@Query() query: Record<string, string | undefined>) {
    return this.pnl.getOverview(this.periodQuery(query));
  }

  @Get('cash-flow')
  cashFlowView(@Query() query: Record<string, string | undefined>) {
    return this.cashFlow.getOverview(this.periodQuery(query));
  }

  // Finance-2 — a read-only verification/explanation layer around the canonical revenue source (cupTotals/
  // posTotals, unchanged). Reuses the SAME live Poster scan (analyze()) the admin import preview already uses;
  // never writes, never performs a real import.
  @Get('reconciliation')
  reconciliationView(@Query() query: Record<string, string | undefined>) {
    return this.reconciliation.getReconciliation(this.periodQuery(query));
  }

  @Get('roi')
  roi(@Query() query: Record<string, string | undefined>) {
    return this.investments.roi(this.periodQuery(query));
  }

  @Get('payback')
  payback() {
    return this.investments.payback();
  }

  // ---- COGS --------------------------------------------------------------------------------------------------

  @Get('cogs-status')
  async cogsStatus() {
    return { productsWithoutRecipe: await this.cogsRepository.countActiveWithoutRecipe() };
  }

  @Post('cogs-sync')
  syncCogs() {
    return this.cogsSync.sync();
  }

  // ---- expense categories -------------------------------------------------------------------------------------

  @Get('expense-categories')
  listCategories(@Query('includeInactive') includeInactive?: string) {
    return this.expenses.listCategories(includeInactive === 'true');
  }

  @Post('expense-categories')
  createCategory(@Body() body: unknown, @CurrentAdmin() admin: { id: string }) {
    return this.expenses.createCategory(parse(createExpenseCategorySchema, body), admin.id);
  }

  @Patch('expense-categories/:id')
  updateCategory(@Param('id') id: string, @Body() body: unknown, @CurrentAdmin() admin: { id: string }) {
    return this.expenses.updateCategory(id, parse(updateExpenseCategorySchema, body), admin.id);
  }

  // ---- expenses -----------------------------------------------------------------------------------------------

  @Get('expenses')
  listExpenses(@Query() query: Record<string, string | undefined>) {
    const q = parse(listExpensesQuerySchema, query);
    return this.expenses.list({
      from: q.startDate ? new Date(q.startDate) : undefined,
      to: q.endDate ? new Date(new Date(q.endDate).getTime() + 86_400_000) : undefined,
      branchId: q.branchId,
      categoryId: q.categoryId,
      cursor: q.cursor,
      limit: q.limit ? Math.min(200, Math.max(1, Number(q.limit))) : 50,
    });
  }

  @Post('expenses')
  createExpense(@Body() body: unknown, @CurrentAdmin() admin: { id: string }) {
    const data = parse(createExpenseSchema, body);
    return this.expenses.create({ ...data, date: new Date(data.date), branchId: data.branchId ?? null, notes: data.notes ?? null, recurrenceInterval: data.recurrenceInterval ?? null, createdBy: admin.id });
  }

  @Patch('expenses/:id')
  updateExpense(@Param('id') id: string, @Body() body: unknown, @CurrentAdmin() admin: { id: string }) {
    const data = parse(updateExpenseSchema, body);
    return this.expenses.update(id, { ...data, date: data.date ? new Date(data.date) : undefined }, admin.id);
  }

  @Delete('expenses/:id')
  deleteExpense(@Param('id') id: string, @CurrentAdmin() admin: { id: string }) {
    return this.expenses.delete(id, admin.id);
  }

  // ---- loans --------------------------------------------------------------------------------------------------

  @Get('loans')
  listLoans() {
    return this.loans.list();
  }

  @Get('loans/:id')
  getLoan(@Param('id') id: string) {
    return this.loans.get(id);
  }

  @Post('loans')
  createLoan(@Body() body: unknown, @CurrentAdmin() admin: { id: string }) {
    const data = parse(createLoanSchema, body);
    return this.loans.create({ ...data, startDate: new Date(data.startDate), notes: data.notes ?? null, createdBy: admin.id }, admin.id);
  }

  @Patch('loans/:id')
  updateLoan(@Param('id') id: string, @Body() body: unknown, @CurrentAdmin() admin: { id: string }) {
    const data = parse(updateLoanSchema, body);
    return this.loans.update(id, { ...data, startDate: data.startDate ? new Date(data.startDate) : undefined }, admin.id);
  }

  @Post('loans/:id/payments')
  recordLoanPayment(@Param('id') id: string, @Body() body: unknown, @CurrentAdmin() admin: { id: string }) {
    const data = parse(createLoanPaymentSchema, body);
    return this.loans.recordPayment({ ...data, loanId: id, date: new Date(data.date), notes: data.notes ?? null, createdBy: admin.id }, admin.id);
  }

  // ---- taxes --------------------------------------------------------------------------------------------------

  @Get('taxes')
  listTaxRules() {
    return this.taxes.list();
  }

  @Post('taxes')
  createTaxRule(@Body() body: unknown, @CurrentAdmin() admin: { id: string }) {
    const data = parse(createTaxRuleSchema, body);
    return this.taxes.create({ ...data, effectiveFrom: new Date(data.effectiveFrom), effectiveTo: data.effectiveTo ? new Date(data.effectiveTo) : null, notes: data.notes ?? null, createdBy: admin.id }, admin.id);
  }

  @Patch('taxes/:id')
  updateTaxRule(@Param('id') id: string, @Body() body: unknown, @CurrentAdmin() admin: { id: string }) {
    const data = parse(updateTaxRuleSchema, body);
    return this.taxes.update(id, { ...data, effectiveFrom: data.effectiveFrom ? new Date(data.effectiveFrom) : undefined, effectiveTo: data.effectiveTo !== undefined ? (data.effectiveTo ? new Date(data.effectiveTo) : null) : undefined }, admin.id);
  }

  // ---- investments ---------------------------------------------------------------------------------------------

  @Get('investments')
  listInvestments() {
    return this.investments.list();
  }

  @Post('investments')
  createInvestment(@Body() body: unknown, @CurrentAdmin() admin: { id: string }) {
    const data = parse(createInvestmentSchema, body);
    return this.investments.create({ ...data, date: new Date(data.date), branchId: data.branchId ?? null, paymentSource: data.paymentSource ?? null, notes: data.notes ?? null, createdBy: admin.id }, admin.id);
  }

  @Patch('investments/:id')
  updateInvestment(@Param('id') id: string, @Body() body: unknown, @CurrentAdmin() admin: { id: string }) {
    const data = parse(updateInvestmentSchema, body);
    return this.investments.update(id, { ...data, date: data.date ? new Date(data.date) : undefined }, admin.id);
  }

  @Delete('investments/:id')
  deleteInvestment(@Param('id') id: string, @CurrentAdmin() admin: { id: string }) {
    return this.investments.delete(id, admin.id);
  }

  // ---- cash adjustments ------------------------------------------------------------------------------------

  @Post('cash-adjustments')
  createCashAdjustment(@Body() body: unknown, @CurrentAdmin() admin: { id: string }) {
    const data = parse(createCashAdjustmentSchema, body);
    return this.cashAdjustments.create({ ...data, date: new Date(data.date), branchId: data.branchId ?? null, createdBy: admin.id }, admin.id);
  }

  @Get('cash-adjustments')
  listCashAdjustments(@Query() query: Record<string, string | undefined>) {
    const q = parse(periodQuerySchema, query);
    // Reuses the same period resolution as every other view (BUSINESS_TIMEZONE_OFFSET_MINUTES), via the cash flow
    // service's own range resolution would require exposing it; simplest here is a direct month-bounded default.
    const now = new Date();
    const from = q.startDate ? new Date(q.startDate) : new Date(now.getFullYear(), now.getMonth(), 1);
    const to = q.endDate ? new Date(new Date(q.endDate).getTime() + 86_400_000) : now;
    return this.cashAdjustments.list(from, to);
  }
}
