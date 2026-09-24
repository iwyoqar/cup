-- Finance & Accounting v1: Expense/ExpenseCategory (incl. its `type` column), Loan/LoanPayment,
-- TaxRule, Investment, CashAdjustment, plus Product.hasRecipe/theoreticalCostMinor/costSyncedAt
-- (COGS cache, read live from Poster's own recipe data). Hand-authored to mirror the two applied
-- SQLite migrations combined (prisma/migrations/20260924070136_finance_accounting_v1 and
-- 20260924070304_finance_expense_category_type), adjusted for Postgres syntax — see
-- 0002_customer_isactive's own note on why (`prisma migrate diff --from-migrations` needs a live
-- shadow database not available in this environment).

CREATE TABLE "expense_categories" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'OPERATING',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "expense_categories_name_key" ON "expense_categories"("name");

CREATE TABLE "expenses" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "categoryId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "branchId" TEXT,
    "isRecurring" BOOLEAN NOT NULL DEFAULT false,
    "recurrenceInterval" TEXT,
    "paymentStatus" TEXT NOT NULL DEFAULT 'PAID',
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "expenses_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "expense_categories" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "expenses_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "expenses_date_idx" ON "expenses"("date");
CREATE INDEX "expenses_categoryId_date_idx" ON "expenses"("categoryId", "date");
CREATE INDEX "expenses_branchId_date_idx" ON "expenses"("branchId", "date");

CREATE TABLE "loans" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "lender" TEXT NOT NULL,
    "principalMinor" INTEGER NOT NULL,
    "annualInterestRatePct" DOUBLE PRECISION NOT NULL,
    "termMonths" INTEGER NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "loan_payments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "loanId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "principalMinor" INTEGER NOT NULL,
    "interestMinor" INTEGER NOT NULL,
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "loan_payments_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "loans" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "loan_payments_loanId_date_idx" ON "loan_payments"("loanId", "date");

CREATE TABLE "tax_rules" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "ratePct" DOUBLE PRECISION NOT NULL,
    "calculationBase" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "tax_rules_isActive_effectiveFrom_idx" ON "tax_rules"("isActive", "effectiveFrom");

CREATE TABLE "investments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "branchId" TEXT,
    "paymentSource" TEXT,
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "investments_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "investments_date_idx" ON "investments"("date");

CREATE TABLE "cash_adjustments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" TIMESTAMP(3) NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "branchId" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cash_adjustments_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "cash_adjustments_date_idx" ON "cash_adjustments"("date");

ALTER TABLE "products" ADD COLUMN "hasRecipe" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "products" ADD COLUMN "theoreticalCostMinor" INTEGER;
ALTER TABLE "products" ADD COLUMN "costSyncedAt" TIMESTAMP(3);
