import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface ExpenseCategoryTotal {
  categoryId: string;
  categoryName: string;
  type: string; // ExpenseCategoryType
  amountMinor: number;
}

// COGS and Expenses — the two P&L inputs Analytics never had to compute (Revenue is reused
// as-is from AnalyticsRepository; see finance-pnl.service.ts).
@Injectable()
export class FinancePnlRepository {
  constructor(private readonly prisma: PrismaService) {}

  // Product-level cost lookup for the product ids Analytics' cupProducts/posProducts already
  // aggregated quantity for — COGS is quantity (from Analytics) times theoreticalCostMinor (from
  // here), never re-summed from raw order/transaction rows a second time.
  async productCosts(productIds: string[]): Promise<Map<string, { hasRecipe: boolean; theoreticalCostMinor: number | null; name: string }>> {
    if (productIds.length === 0) return new Map();
    const rows = await this.prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, hasRecipe: true, theoreticalCostMinor: true, name: true } });
    return new Map(rows.map((r) => [r.id, { hasRecipe: r.hasRecipe, theoreticalCostMinor: r.theoreticalCostMinor, name: r.name }]));
  }

  // Coffee Subscription — money actually received for subscriptions: purchases PAID through a payment provider, by paidAt (cash basis, the
  // same basis CUP Finance uses for every sale). Manual admin activations are not payments and never count. Subscriptions are not tied to
  // a branch, so a branch-filtered view has no subscription sales (see the P&L note).
  async subscriptionSalesTotal(from: Date, to: Date): Promise<number> {
    const r = await this.prisma.subscriptionPurchase.aggregate({ where: { status: 'PAID', activationSource: 'PAYMENT', paidAt: { gte: from, lt: to } }, _sum: { amountMinor: true } });
    return r._sum.amountMinor ?? 0;
  }

  // Coffee Subscription — what was physically CONSUMED under subscriptions: one unit of the product per CONFIRMED redemption (by redeemedAt,
  // at the branch it was made). Zero revenue by definition; its theoretical cost is COGS. These units never reach the imported POS sale lines
  // (the importer keeps them out), so they are counted exactly once — here.
  async subscriptionConsumption(from: Date, to: Date, branchId: string | null): Promise<{ productId: string; quantity: number; portions: number }[]> {
    const rows = await this.prisma.subscriptionRedemption.groupBy({
      by: ['productId'],
      where: { status: 'CONFIRMED', redeemedAt: { gte: from, lt: to }, ...(branchId ? { branchId } : {}) },
      _count: { _all: true },
      _sum: { portionCost: true },
    });
    return rows.map((r) => ({ productId: r.productId, quantity: r._count._all, portions: r._sum.portionCost ?? 0 }));
  }

  // Operating expenses grouped by category (the P&L's "Rent / Salaries / Marketing / ..." line
  // items) — an expense counts in the period it was INCURRED (its own `date`), regardless of
  // paymentStatus; Cash Flow (finance-cashflow.service.ts) is the one that cares whether it was
  // actually paid.
  async expensesByCategory(from: Date, to: Date, branchId: string | null): Promise<ExpenseCategoryTotal[]> {
    const rows = await this.prisma.expense.groupBy({
      by: ['categoryId'],
      where: { date: { gte: from, lt: to }, ...(branchId ? { branchId } : {}) },
      _sum: { amountMinor: true },
    });
    if (rows.length === 0) return [];
    const categories = await this.prisma.expenseCategory.findMany({ where: { id: { in: rows.map((r) => r.categoryId) } }, select: { id: true, name: true, type: true } });
    const byId = new Map(categories.map((c) => [c.id, c]));
    return rows.map((r) => {
      const c = byId.get(r.categoryId);
      return { categoryId: r.categoryId, categoryName: c?.name ?? '—', type: c?.type ?? 'OPERATING', amountMinor: r._sum.amountMinor ?? 0 };
    });
  }

  async loanInterestTotal(from: Date, to: Date): Promise<number> {
    const r = await this.prisma.loanPayment.aggregate({ where: { date: { gte: from, lt: to } }, _sum: { interestMinor: true } });
    return r._sum.interestMinor ?? 0;
  }

  async loanPrincipalTotal(from: Date, to: Date): Promise<number> {
    const r = await this.prisma.loanPayment.aggregate({ where: { date: { gte: from, lt: to } }, _sum: { principalMinor: true } });
    return r._sum.principalMinor ?? 0;
  }

  async investmentTotal(from: Date, to: Date, branchId: string | null): Promise<number> {
    const r = await this.prisma.investment.aggregate({ where: { date: { gte: from, lt: to }, ...(branchId ? { branchId } : {}) }, _sum: { amountMinor: true } });
    return r._sum.amountMinor ?? 0;
  }

  async cashAdjustmentTotal(from: Date, to: Date, branchId: string | null): Promise<number> {
    const r = await this.prisma.cashAdjustment.aggregate({ where: { date: { gte: from, lt: to }, ...(branchId ? { branchId } : {}) }, _sum: { amountMinor: true } });
    return r._sum.amountMinor ?? 0;
  }

  // Expenses actually PAID in the period (Cash Flow outflow) — distinct from expensesByCategory,
  // which counts every incurred expense regardless of payment status.
  async paidExpenseTotal(from: Date, to: Date, branchId: string | null): Promise<number> {
    const r = await this.prisma.expense.aggregate({ where: { date: { gte: from, lt: to }, paymentStatus: 'PAID', ...(branchId ? { branchId } : {}) }, _sum: { amountMinor: true } });
    return r._sum.amountMinor ?? 0;
  }

  totalInitialInvestment(): Promise<number> {
    return this.prisma.investment.aggregate({ _sum: { amountMinor: true } }).then((r) => r._sum.amountMinor ?? 0);
  }

  earliestInvestmentDate(): Promise<Date | null> {
    return this.prisma.investment.aggregate({ _min: { date: true } }).then((r) => r._min.date);
  }
}
