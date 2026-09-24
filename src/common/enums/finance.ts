// Stored as plain String columns (not Prisma enums) — same portability rule as order-status.ts
// (the sqlite connector does not support Prisma enums).

export const EXPENSE_CATEGORY_TYPES = ['OPERATING', 'FINANCIAL'] as const;
export type ExpenseCategoryType = (typeof EXPENSE_CATEGORY_TYPES)[number];
export function isExpenseCategoryType(value: string): value is ExpenseCategoryType {
  return (EXPENSE_CATEGORY_TYPES as readonly string[]).includes(value);
}

export const EXPENSE_PAYMENT_STATUSES = ['PAID', 'UNPAID'] as const;
export type ExpensePaymentStatus = (typeof EXPENSE_PAYMENT_STATUSES)[number];
export function isExpensePaymentStatus(value: string): value is ExpensePaymentStatus {
  return (EXPENSE_PAYMENT_STATUSES as readonly string[]).includes(value);
}

// Only MONTHLY is supported for now — matches every example in the spec (rent, salaries,
// marketing). Widen this union (never repurpose an existing value) if a real need for a
// different cadence shows up.
export const EXPENSE_RECURRENCE_INTERVALS = ['MONTHLY'] as const;
export type ExpenseRecurrenceInterval = (typeof EXPENSE_RECURRENCE_INTERVALS)[number];
export function isExpenseRecurrenceInterval(value: string): value is ExpenseRecurrenceInterval {
  return (EXPENSE_RECURRENCE_INTERVALS as readonly string[]).includes(value);
}

export const LOAN_STATUSES = ['ACTIVE', 'PAID_OFF', 'DEFAULTED'] as const;
export type LoanStatus = (typeof LOAN_STATUSES)[number];
export function isLoanStatus(value: string): value is LoanStatus {
  return (LOAN_STATUSES as readonly string[]).includes(value);
}

// What a TaxRule's rate is applied to. Deliberately a small, explicit set rather than a free
// string — the finance aggregation service switches on this value, so an unrecognized base must
// be a validation error, never silently ignored.
export const TAX_CALCULATION_BASES = ['REVENUE', 'GROSS_PROFIT', 'OPERATING_PROFIT'] as const;
export type TaxCalculationBase = (typeof TAX_CALCULATION_BASES)[number];
export function isTaxCalculationBase(value: string): value is TaxCalculationBase {
  return (TAX_CALCULATION_BASES as readonly string[]).includes(value);
}
