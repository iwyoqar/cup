import { z } from 'zod';
import { EXPENSE_CATEGORY_TYPES, EXPENSE_PAYMENT_STATUSES, EXPENSE_RECURRENCE_INTERVALS, TAX_CALCULATION_BASES } from '../../common/enums/finance';

const moneyMinor = z.number().int().positive();
const isoDate = z.string().min(1); // parsed with `new Date(...)`, validated in the service layer

export const periodQuerySchema = z
  .object({
    period: z.enum(['today', 'yesterday', 'thisWeek', 'thisMonth', 'lastMonth', 'custom']),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    branchId: z.string().min(1).optional(),
  })
  .strict();

export const createExpenseCategorySchema = z.object({ name: z.string().trim().min(1).max(100), type: z.enum(EXPENSE_CATEGORY_TYPES), sortOrder: z.number().int().optional() }).strict();
export const updateExpenseCategorySchema = z
  .object({ name: z.string().trim().min(1).max(100).optional(), type: z.enum(EXPENSE_CATEGORY_TYPES).optional(), sortOrder: z.number().int().optional(), isActive: z.boolean().optional() })
  .strict();

export const createExpenseSchema = z
  .object({
    categoryId: z.string().min(1),
    description: z.string().trim().min(1).max(300),
    amountMinor: moneyMinor,
    date: isoDate,
    branchId: z.string().min(1).nullable().optional(),
    isRecurring: z.boolean().optional(),
    recurrenceInterval: z.enum(EXPENSE_RECURRENCE_INTERVALS).nullable().optional(),
    paymentStatus: z.enum(EXPENSE_PAYMENT_STATUSES).optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
  })
  .strict();

export const updateExpenseSchema = z
  .object({
    categoryId: z.string().min(1).optional(),
    description: z.string().trim().min(1).max(300).optional(),
    amountMinor: moneyMinor.optional(),
    date: isoDate.optional(),
    branchId: z.string().min(1).nullable().optional(),
    isRecurring: z.boolean().optional(),
    recurrenceInterval: z.enum(EXPENSE_RECURRENCE_INTERVALS).nullable().optional(),
    paymentStatus: z.enum(EXPENSE_PAYMENT_STATUSES).optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
  })
  .strict();

export const listExpensesQuerySchema = z
  .object({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    branchId: z.string().min(1).optional(),
    categoryId: z.string().min(1).optional(),
    cursor: z.string().min(1).optional(),
    limit: z.string().regex(/^\d+$/).optional(),
  })
  .strict();

export const createLoanSchema = z
  .object({
    lender: z.string().trim().min(1).max(200),
    principalMinor: moneyMinor,
    annualInterestRatePct: z.number().min(0).max(1000),
    termMonths: z.number().int().positive(),
    startDate: isoDate,
    notes: z.string().trim().max(1000).nullable().optional(),
  })
  .strict();

export const updateLoanSchema = z
  .object({
    lender: z.string().trim().min(1).max(200).optional(),
    principalMinor: moneyMinor.optional(),
    annualInterestRatePct: z.number().min(0).max(1000).optional(),
    termMonths: z.number().int().positive().optional(),
    startDate: isoDate.optional(),
    status: z.enum(['ACTIVE', 'PAID_OFF', 'DEFAULTED']).optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
  })
  .strict();

export const createLoanPaymentSchema = z
  .object({
    date: isoDate,
    principalMinor: z.number().int().min(0),
    interestMinor: z.number().int().min(0),
    notes: z.string().trim().max(1000).nullable().optional(),
  })
  .strict();

export const createTaxRuleSchema = z
  .object({
    name: z.string().trim().min(1).max(150),
    ratePct: z.number().min(0).max(100),
    calculationBase: z.enum(TAX_CALCULATION_BASES),
    effectiveFrom: isoDate,
    effectiveTo: isoDate.nullable().optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
  })
  .strict();

export const updateTaxRuleSchema = z
  .object({
    name: z.string().trim().min(1).max(150).optional(),
    ratePct: z.number().min(0).max(100).optional(),
    calculationBase: z.enum(TAX_CALCULATION_BASES).optional(),
    isActive: z.boolean().optional(),
    effectiveFrom: isoDate.optional(),
    effectiveTo: isoDate.nullable().optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
  })
  .strict();

export const createInvestmentSchema = z
  .object({
    category: z.string().trim().min(1).max(100),
    description: z.string().trim().min(1).max(300),
    amountMinor: moneyMinor,
    date: isoDate,
    branchId: z.string().min(1).nullable().optional(),
    paymentSource: z.string().trim().max(200).nullable().optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
  })
  .strict();

export const updateInvestmentSchema = z
  .object({
    category: z.string().trim().min(1).max(100).optional(),
    description: z.string().trim().min(1).max(300).optional(),
    amountMinor: moneyMinor.optional(),
    date: isoDate.optional(),
    branchId: z.string().min(1).nullable().optional(),
    paymentSource: z.string().trim().max(200).nullable().optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
  })
  .strict();

export const createCashAdjustmentSchema = z
  .object({
    date: isoDate,
    amountMinor: z.number().int().refine((n) => n !== 0, 'amountMinor cannot be zero'),
    reason: z.string().trim().min(1).max(300),
    branchId: z.string().min(1).nullable().optional(),
  })
  .strict();
