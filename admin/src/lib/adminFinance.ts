import { apiRequest } from './api';
import {
  FinanceCashFlowOverview,
  FinanceExpense,
  FinanceExpenseCategory,
  FinanceExpensesPage,
  FinanceInvestment,
  FinanceLoan,
  FinancePayback,
  FinancePeriodKey,
  FinancePnlOverview,
  FinanceReconciliation,
  FinanceRoi,
  FinanceTaxRule,
} from './types';

export interface FinanceFilters {
  period: FinancePeriodKey;
  startDate?: string;
  endDate?: string;
  branchId?: string;
}

function periodParams(filters: FinanceFilters): URLSearchParams {
  const params = new URLSearchParams({ period: filters.period });
  if (filters.period === 'custom') {
    if (filters.startDate) params.set('startDate', filters.startDate);
    if (filters.endDate) params.set('endDate', filters.endDate);
  }
  if (filters.branchId) params.set('branchId', filters.branchId);
  return params;
}

export function fetchFinanceOverview(filters: FinanceFilters): Promise<FinancePnlOverview> {
  return apiRequest<FinancePnlOverview>(`/admin/finance/overview?${periodParams(filters).toString()}`);
}

export function fetchFinanceCashFlow(filters: FinanceFilters): Promise<FinanceCashFlowOverview> {
  return apiRequest<FinanceCashFlowOverview>(`/admin/finance/cash-flow?${periodParams(filters).toString()}`);
}

export function fetchFinanceRoi(filters: FinanceFilters): Promise<FinanceRoi> {
  return apiRequest<FinanceRoi>(`/admin/finance/roi?${periodParams(filters).toString()}`);
}

export function fetchFinancePayback(): Promise<FinancePayback> {
  return apiRequest<FinancePayback>('/admin/finance/payback');
}

export function fetchFinanceReconciliation(filters: FinanceFilters): Promise<FinanceReconciliation> {
  return apiRequest<FinanceReconciliation>(`/admin/finance/reconciliation?${periodParams(filters).toString()}`);
}

export function fetchCogsStatus(): Promise<{ productsWithoutRecipe: number }> {
  return apiRequest('/admin/finance/cogs-status');
}

export function triggerCogsSync(): Promise<{ scanned: number; withRecipe: number; withoutRecipe: number }> {
  return apiRequest('/admin/finance/cogs-sync', { method: 'POST' });
}

// ---- expense categories --------------------------------------------------------------------------------------

export function fetchExpenseCategories(includeInactive = false): Promise<FinanceExpenseCategory[]> {
  return apiRequest(`/admin/finance/expense-categories${includeInactive ? '?includeInactive=true' : ''}`);
}

export function createExpenseCategory(input: { name: string; type: 'OPERATING' | 'FINANCIAL' }): Promise<FinanceExpenseCategory> {
  return apiRequest('/admin/finance/expense-categories', { method: 'POST', body: input });
}

export function updateExpenseCategory(id: string, input: Partial<{ name: string; type: 'OPERATING' | 'FINANCIAL'; isActive: boolean }>): Promise<FinanceExpenseCategory> {
  return apiRequest(`/admin/finance/expense-categories/${id}`, { method: 'PATCH', body: input });
}

// ---- expenses -------------------------------------------------------------------------------------------------

export interface ExpenseInput {
  categoryId: string;
  description: string;
  amountMinor: number;
  date: string; // YYYY-MM-DD
  branchId?: string | null;
  isRecurring?: boolean;
  recurrenceInterval?: 'MONTHLY' | null;
  paymentStatus?: 'PAID' | 'UNPAID';
  notes?: string | null;
}

export function fetchExpenses(args: { startDate?: string; endDate?: string; branchId?: string; categoryId?: string; cursor?: string } = {}): Promise<FinanceExpensesPage> {
  const params = new URLSearchParams();
  if (args.startDate) params.set('startDate', args.startDate);
  if (args.endDate) params.set('endDate', args.endDate);
  if (args.branchId) params.set('branchId', args.branchId);
  if (args.categoryId) params.set('categoryId', args.categoryId);
  if (args.cursor) params.set('cursor', args.cursor);
  return apiRequest(`/admin/finance/expenses?${params.toString()}`);
}

export function createExpense(input: ExpenseInput): Promise<FinanceExpense> {
  return apiRequest('/admin/finance/expenses', { method: 'POST', body: input });
}

export function updateExpense(id: string, input: Partial<ExpenseInput>): Promise<FinanceExpense> {
  return apiRequest(`/admin/finance/expenses/${id}`, { method: 'PATCH', body: input });
}

export function deleteExpense(id: string): Promise<void> {
  return apiRequest(`/admin/finance/expenses/${id}`, { method: 'DELETE' });
}

// ---- loans -------------------------------------------------------------------------------------------------

export interface LoanInput {
  lender: string;
  principalMinor: number;
  annualInterestRatePct: number;
  termMonths: number;
  startDate: string;
  notes?: string | null;
}

export function fetchLoans(): Promise<FinanceLoan[]> {
  return apiRequest('/admin/finance/loans');
}

export function createLoan(input: LoanInput): Promise<FinanceLoan> {
  return apiRequest('/admin/finance/loans', { method: 'POST', body: input });
}

export function updateLoan(id: string, input: Partial<LoanInput & { status: 'ACTIVE' | 'PAID_OFF' | 'DEFAULTED' }>): Promise<FinanceLoan> {
  return apiRequest(`/admin/finance/loans/${id}`, { method: 'PATCH', body: input });
}

export function recordLoanPayment(id: string, input: { date: string; principalMinor: number; interestMinor: number; notes?: string | null }): Promise<FinanceLoan> {
  return apiRequest(`/admin/finance/loans/${id}/payments`, { method: 'POST', body: input });
}

// ---- taxes --------------------------------------------------------------------------------------------------

export interface TaxRuleInput {
  name: string;
  ratePct: number;
  calculationBase: 'REVENUE' | 'GROSS_PROFIT' | 'OPERATING_PROFIT';
  effectiveFrom: string;
  effectiveTo?: string | null;
  notes?: string | null;
}

export function fetchTaxRules(): Promise<FinanceTaxRule[]> {
  return apiRequest('/admin/finance/taxes');
}

export function createTaxRule(input: TaxRuleInput): Promise<FinanceTaxRule> {
  return apiRequest('/admin/finance/taxes', { method: 'POST', body: input });
}

export function updateTaxRule(id: string, input: Partial<TaxRuleInput & { isActive: boolean }>): Promise<FinanceTaxRule> {
  return apiRequest(`/admin/finance/taxes/${id}`, { method: 'PATCH', body: input });
}

// ---- investments ---------------------------------------------------------------------------------------------

export interface InvestmentInput {
  category: string;
  description: string;
  amountMinor: number;
  date: string;
  branchId?: string | null;
  paymentSource?: string | null;
  notes?: string | null;
}

export function fetchInvestments(): Promise<FinanceInvestment[]> {
  return apiRequest('/admin/finance/investments');
}

export function createInvestment(input: InvestmentInput): Promise<FinanceInvestment> {
  return apiRequest('/admin/finance/investments', { method: 'POST', body: input });
}

export function updateInvestment(id: string, input: Partial<InvestmentInput>): Promise<FinanceInvestment> {
  return apiRequest(`/admin/finance/investments/${id}`, { method: 'PATCH', body: input });
}

export function deleteInvestment(id: string): Promise<void> {
  return apiRequest(`/admin/finance/investments/${id}`, { method: 'DELETE' });
}

// ---- cash adjustments -----------------------------------------------------------------------------------------

export function createCashAdjustment(input: { date: string; amountMinor: number; reason: string; branchId?: string | null }): Promise<void> {
  return apiRequest('/admin/finance/cash-adjustments', { method: 'POST', body: input });
}
