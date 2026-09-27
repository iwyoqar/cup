import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '../../common/config/config.service';
import { AnalyticsRepository, QueryRange } from '../analytics/analytics.repository';
import { FinanceRepository } from './finance.repository';
import { FinancePeriodQuery, resolveFinanceRange } from './finance-period';
import { FinancePnlRepository } from './finance-pnl.repository';

export interface PnlQuery extends FinancePeriodQuery {
  branchId?: string;
}

export interface TaxLine {
  ruleId: string;
  name: string;
  ratePct: number;
  calculationBase: string;
  baseAmountMinor: number;
  amountMinor: number;
}

export interface ExpenseLine {
  categoryId: string;
  categoryName: string;
  amountMinor: number;
}

export interface PnlOverview {
  period: { key: string; startDate: string; endDate: string };
  branch: { id: string; name: string } | null;
  filters: { branches: { id: string; name: string }[] };

  revenue: number;
  // Coffee Subscription: revenue = sales (CUP orders + imported POS, unchanged) + subscription sales (provider-confirmed payments, cash basis).
  revenueBreakdown: { salesMinor: number; subscriptionSalesMinor: number };
  cogs: { amountMinor: number; complete: boolean; missingRecipeProducts: { name: string; quantity: number }[]; subscriptionConsumptionMinor: number };
  subscriptions: { salesRevenueMinor: number; redemptions: number; portionsConsumed: number; consumptionCogsMinor: number; notes: string[] };
  grossProfit: number;
  grossMarginPct: number | null;

  operatingExpenses: { total: number; byCategory: ExpenseLine[] };
  operatingProfit: number;
  operatingMarginPct: number | null;

  taxes: { total: number; lines: TaxLine[] };
  interest: number;
  otherFinancialCosts: { total: number; byCategory: ExpenseLine[] };

  netProfit: number;
  netMarginPct: number | null;

  // Answers "which products generate the most gross profit" — only meaningful for a product with a known cost
  // (hasRecipe); a product without one is excluded here (it already appears in cogs.missingRecipeProducts).
  topGrossProfitProducts: { name: string; quantity: number; revenueMinor: number; costMinor: number; grossProfitMinor: number }[];
}

const TOP_PRODUCTS = 8;

// Finance-1 — the P&L waterfall: Revenue (reused verbatim from AnalyticsRepository, the project's
// one already-deduped CUP+POS revenue source) - COGS (read live from Poster recipes, see
// finance-cogs-sync.service.ts) = Gross Profit; - Operating Expenses = Operating Profit; - Taxes -
// Interest - Other Financial Costs = Net Profit. Nothing here re-derives revenue from raw
// orders/transactions a second time.
@Injectable()
export class FinancePnlService {
  constructor(
    private readonly analytics: AnalyticsRepository,
    private readonly repository: FinancePnlRepository,
    private readonly financeRepository: FinanceRepository,
    private readonly config: ConfigService,
  ) {}

  async getOverview(query: PnlQuery, now: Date = new Date()): Promise<PnlOverview> {
    const offset = this.config.env.BUSINESS_TIMEZONE_OFFSET_MINUTES;
    const range = resolveFinanceRange(query, now, offset);

    const branch = query.branchId ? await this.financeRepository.findBranch(query.branchId) : null;
    if (query.branchId && !branch) throw new BadRequestException('Unknown branch.');
    const q: QueryRange = { from: range.from, to: range.to, branchId: branch ? branch.id : null };

    const [branches, cup, pos, cupProducts, posProducts, expenseCategories, interest, taxRules, subscriptionSales, subscriptionConsumption] = await Promise.all([
      this.financeRepository.findActiveBranches(),
      this.analytics.cupTotals(q),
      this.analytics.posTotals(q),
      this.analytics.cupProducts(q),
      this.analytics.posProducts(q),
      this.repository.expensesByCategory(range.from, range.to, q.branchId),
      this.repository.loanInterestTotal(range.from, range.to),
      this.financeRepository.findActiveTaxRulesOverlapping(range.from, range.to),
      q.branchId ? Promise.resolve(0) : this.repository.subscriptionSalesTotal(range.from, range.to),
      this.repository.subscriptionConsumption(range.from, range.to, q.branchId),
    ]);

    const salesRevenue = cup.revenue + pos.revenue;
    const revenue = salesRevenue + subscriptionSales;

    // ---- COGS: quantity (from Analytics' own per-product aggregates) x theoreticalCostMinor (from Product, read
    // live from Poster's recipe). A product with no recipe contributes 0 and is listed in missingRecipeProducts —
    // never estimated.
    const quantityByProduct = new Map<string, number>();
    const revenueByProduct = new Map<string, number>();
    for (const row of [...cupProducts, ...posProducts]) {
      quantityByProduct.set(row.productId, (quantityByProduct.get(row.productId) ?? 0) + row.quantity);
      revenueByProduct.set(row.productId, (revenueByProduct.get(row.productId) ?? 0) + row.revenue);
    }
    const costs = await this.repository.productCosts([...new Set([...quantityByProduct.keys(), ...subscriptionConsumption.map((c) => c.productId)])]);
    let cogsMinor = 0;
    let cogsComplete = true;
    const missingRecipeProducts: { name: string; quantity: number }[] = [];
    const productGrossProfits: PnlOverview['topGrossProfitProducts'] = [];
    for (const [productId, quantity] of quantityByProduct) {
      const cost = costs.get(productId);
      const productRevenue = revenueByProduct.get(productId) ?? 0;
      if (!cost || !cost.hasRecipe || cost.theoreticalCostMinor === null) {
        cogsComplete = false;
        missingRecipeProducts.push({ name: cost?.name ?? '—', quantity });
        continue;
      }
      const costMinor = cost.theoreticalCostMinor * quantity;
      cogsMinor += costMinor;
      productGrossProfits.push({ name: cost.name, quantity, revenueMinor: productRevenue, costMinor, grossProfitMinor: productRevenue - costMinor });
    }
    // Coffee Subscription consumption: its own COGS line (zero revenue), never mixed into per-product gross profit above.
    let subscriptionCogsMinor = 0;
    for (const c of subscriptionConsumption) {
      const cost = costs.get(c.productId);
      if (!cost || !cost.hasRecipe || cost.theoreticalCostMinor === null) {
        cogsComplete = false;
        missingRecipeProducts.push({ name: `${cost?.name ?? '—'} (subscription)`, quantity: c.quantity });
        continue;
      }
      subscriptionCogsMinor += cost.theoreticalCostMinor * c.quantity;
    }
    cogsMinor += subscriptionCogsMinor;
    productGrossProfits.sort((a, b) => b.grossProfitMinor - a.grossProfitMinor);
    missingRecipeProducts.sort((a, b) => b.quantity - a.quantity);

    const grossProfit = revenue - cogsMinor;

    // ---- Operating expenses: only ExpenseCategory.type === 'OPERATING' lines feed Operating Profit; 'FINANCIAL'
    // ones (bank fees, penalties, ...) are held out and applied after Operating Profit instead — see below.
    const operatingLines = expenseCategories.filter((c) => c.type === 'OPERATING').map((c) => ({ categoryId: c.categoryId, categoryName: c.categoryName, amountMinor: c.amountMinor }));
    const operatingTotal = operatingLines.reduce((s, l) => s + l.amountMinor, 0);
    const operatingProfit = grossProfit - operatingTotal;

    const financialLines = expenseCategories.filter((c) => c.type === 'FINANCIAL').map((c) => ({ categoryId: c.categoryId, categoryName: c.categoryName, amountMinor: c.amountMinor }));
    const financialTotal = financialLines.reduce((s, l) => s + l.amountMinor, 0);

    // ---- Taxes: each active rule, applied only if the WHOLE queried period is inside its effective window (a
    // rule that starts/ends mid-period is skipped and reported, never prorated/guessed).
    const taxLines: TaxLine[] = [];
    for (const rule of taxRules) {
      if (rule.effectiveFrom > range.from || (rule.effectiveTo && rule.effectiveTo < range.to)) continue; // partial overlap only — do not prorate
      const base = rule.calculationBase === 'REVENUE' ? revenue : rule.calculationBase === 'GROSS_PROFIT' ? grossProfit : operatingProfit;
      const amountMinor = Math.round((base * rule.ratePct) / 100);
      taxLines.push({ ruleId: rule.id, name: rule.name, ratePct: rule.ratePct, calculationBase: rule.calculationBase, baseAmountMinor: base, amountMinor });
    }
    const taxesTotal = taxLines.reduce((s, l) => s + l.amountMinor, 0);

    const netProfit = operatingProfit - taxesTotal - interest - financialTotal;

    return {
      period: { key: query.period, startDate: range.startDate, endDate: range.endDate },
      branch,
      filters: { branches },
      revenue,
      revenueBreakdown: { salesMinor: salesRevenue, subscriptionSalesMinor: subscriptionSales },
      cogs: { amountMinor: cogsMinor, complete: cogsComplete, missingRecipeProducts, subscriptionConsumptionMinor: subscriptionCogsMinor },
      subscriptions: {
        salesRevenueMinor: subscriptionSales,
        redemptions: subscriptionConsumption.reduce((s, c) => s + c.quantity, 0),
        portionsConsumed: subscriptionConsumption.reduce((s, c) => s + c.portions, 0),
        consumptionCogsMinor: subscriptionCogsMinor,
        notes: [
          'Subscription sales are recognized when paid (cash basis); deferred recognition over the subscription period is not supported yet.',
          'No payment provider is integrated yet, so subscription sales are 0; manual admin activations are never revenue.',
          'Subscription coffee adds no revenue; its theoretical cost is included in COGS.',
          ...(q.branchId ? ['Subscription sales are not branch-bound and are excluded from a branch-filtered P&L.'] : []),
        ],
      },
      grossProfit,
      grossMarginPct: revenue > 0 ? round2((grossProfit / revenue) * 100) : null,
      operatingExpenses: { total: operatingTotal, byCategory: operatingLines },
      operatingProfit,
      operatingMarginPct: revenue > 0 ? round2((operatingProfit / revenue) * 100) : null,
      taxes: { total: taxesTotal, lines: taxLines },
      interest,
      otherFinancialCosts: { total: financialTotal, byCategory: financialLines },
      netProfit,
      netMarginPct: revenue > 0 ? round2((netProfit / revenue) * 100) : null,
      topGrossProfitProducts: productGrossProfits.slice(0, TOP_PRODUCTS),
    };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
