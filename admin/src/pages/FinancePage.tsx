import { useEffect, useState } from 'react';
import { fetchCogsStatus, fetchFinanceCashFlow, fetchFinanceOverview, fetchFinancePayback, fetchFinanceRoi, triggerCogsSync } from '../lib/adminFinance';
import { ApiError } from '../lib/api';
import { formatSom } from '../lib/format';
import { findNav } from '../lib/nav';
import { FinanceCashFlowOverview, FinancePayback, FinancePnlOverview, FinanceRoi } from '../lib/types';
import { FinancePeriodPicker, FinanceRangeValue, isFinanceRangeReady } from '../components/FinancePeriodPicker';
import { FinanceExpensesTab } from '../components/FinanceExpensesTab';
import { FinanceLoansTab } from '../components/FinanceLoansTab';
import { FinanceTaxesTab } from '../components/FinanceTaxesTab';
import { FinanceInvestmentsTab } from '../components/FinanceInvestmentsTab';
import { FinanceReconciliationTab } from '../components/FinanceReconciliationTab';
import { ChartContainer, BarChart, EmptyState, ErrorState, FilterBar, FilterField, KeyValue, LoadingState, PageHeader, SectionCard, StatCard, StatGrid, StatusBadge, Tabs } from '../ui';

const number = (n: number) => n.toLocaleString('ru-RU');
type Tab = 'overview' | 'pnl' | 'cashflow' | 'reconciliation' | 'expenses' | 'loans' | 'taxes' | 'investments';

export function FinancePage() {
  const [tab, setTab] = useState<Tab>('overview');
  const [range, setRange] = useState<FinanceRangeValue>({ period: 'thisMonth', startDate: '', endDate: '' });
  const [branchId, setBranchId] = useState('');
  const { item } = findNav('finance');
  const ready = isFinanceRangeReady(range);

  return (
    <>
      <PageHeader description={item.description} title={item.label} />
      <Tabs
        active={tab}
        label="Finance sections"
        onChange={setTab}
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'pnl', label: 'P&L' },
          { id: 'cashflow', label: 'Cash Flow' },
          { id: 'reconciliation', label: 'Reconciliation' },
          { id: 'expenses', label: 'Expenses' },
          { id: 'loans', label: 'Loans' },
          { id: 'taxes', label: 'Taxes' },
          { id: 'investments', label: 'Investment & Payback' },
        ]}
      />

      {(tab === 'overview' || tab === 'pnl' || tab === 'cashflow' || tab === 'reconciliation') && (
        <FilterBar>
          <FinancePeriodPicker onChange={setRange} value={range} />
          <FilterField label="Branch">
            <select className="select" onChange={(e) => setBranchId(e.target.value)} value={branchId}>
              <option value="">All branches</option>
              <BranchOptions />
            </select>
          </FilterField>
        </FilterBar>
      )}

      {tab === 'overview' && <OverviewTab branchId={branchId || undefined} ready={ready} {...range} />}
      {tab === 'pnl' && <PnlTab branchId={branchId || undefined} ready={ready} {...range} />}
      {tab === 'cashflow' && <CashFlowTab branchId={branchId || undefined} ready={ready} {...range} />}
      {tab === 'reconciliation' && <FinanceReconciliationTab branchId={branchId || undefined} ready={ready} {...range} />}
      {tab === 'expenses' && <FinanceExpensesTab />}
      {tab === 'loans' && <FinanceLoansTab />}
      {tab === 'taxes' && <FinanceTaxesTab />}
      {tab === 'investments' && <FinanceInvestmentsTab />}
    </>
  );
}

// A tiny local cache so the branch <select> doesn't refetch on every render — filters.branches comes back on every
// overview/pnl/cashflow response anyway, this just avoids an empty dropdown before the first response lands.
let cachedBranches: { id: string; name: string }[] = [];
function BranchOptions() {
  const [branches, setBranches] = useState(cachedBranches);
  useEffect(() => {
    fetchFinanceOverview({ period: 'today' })
      .then((o) => {
        cachedBranches = o.filters.branches;
        setBranches(o.filters.branches);
      })
      .catch(() => undefined);
  }, []);
  return (
    <>
      {branches.map((b) => (
        <option key={b.id} value={b.id}>
          {b.name}
        </option>
      ))}
    </>
  );
}

interface TabProps extends FinanceRangeValue {
  branchId?: string;
  ready: boolean;
}

function useFinanceData<T>(fetcher: () => Promise<T>, deps: unknown[], ready: boolean) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetcher()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.backendMessage : "Ma'lumotni yuklab bo'lmadi");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error, loading };
}

function CogsBanner({ data }: { data: FinancePnlOverview }) {
  const [syncing, setSyncing] = useState(false);
  const [synced, setSynced] = useState<string | null>(null);
  if (data.cogs.complete) return null;
  const handleSync = async () => {
    setSyncing(true);
    try {
      const status = await fetchCogsStatus();
      await triggerCogsSync();
      setSynced(`${status.productsWithoutRecipe} product(s) were checked against Poster.`);
    } catch {
      setSynced('Sync failed — try again shortly.');
    } finally {
      setSyncing(false);
    }
  };
  return (
    <div className="callout">
      <StatusBadge tone="warn">COGS data incomplete</StatusBadge> {data.cogs.missingRecipeProducts.length} product(s) sold in this period have no recipe configured in Poster yet, so their cost is not
      counted — gross profit shown here is an upper bound. Add a recipe (Poster's "Dishes") for: {data.cogs.missingRecipeProducts.slice(0, 5).map((p) => p.name).join(', ')}
      {data.cogs.missingRecipeProducts.length > 5 ? ', …' : ''}.{' '}
      <button className="button-secondary button--sm" disabled={syncing} onClick={handleSync} type="button">
        {syncing ? 'Checking…' : 'Re-check Poster now'}
      </button>
      {synced && <span className="hint-text"> {synced}</span>}
    </div>
  );
}

function OverviewTab({ ready, ...filters }: TabProps) {
  const { data, error, loading } = useFinanceData(() => fetchFinanceOverview(filters), [filters.period, filters.startDate, filters.endDate, filters.branchId], ready);
  const [payback, setPayback] = useState<FinancePayback | null>(null);
  useEffect(() => {
    fetchFinancePayback().then(setPayback).catch(() => undefined);
  }, []);

  if (error) return <ErrorState message={error} title="Finance overview could not be loaded" />;
  if (!data) return <LoadingState variant="page" />;

  return (
    <div className="stack" style={{ opacity: loading ? 0.6 : 1 }}>
      <CogsBanner data={data} />
      <StatGrid>
        <StatCard hint="CUP + imported POS" label="Revenue" strong value={formatSom(data.revenue)} />
        <StatCard hint={data.cogs.complete ? undefined : 'incomplete — see banner'} label="COGS" value={formatSom(data.cogs.amountMinor)} />
        <StatCard hint={`${data.grossMarginPct ?? '—'}% margin`} label="Gross Profit" value={formatSom(data.grossProfit)} />
        <StatCard hint={`${data.operatingMarginPct ?? '—'}% margin`} label="Operating Profit" value={formatSom(data.operatingProfit)} />
        <StatCard label="Taxes" value={formatSom(data.taxes.total)} />
        <StatCard label="Interest" value={formatSom(data.interest)} />
        <StatCard hint={`${data.netMarginPct ?? '—'}% margin`} label="Net Profit" strong value={formatSom(data.netProfit)} />
        {payback && payback.status === 'OK' && <StatCard hint={`due ~${payback.estimatedPaybackDate}`} label="Payback progress" value={`${payback.paybackProgressPct}%`} />}
      </StatGrid>
      <div className="grid-2">
        <SectionCard description="Ranked by gross profit (revenue minus its known theoretical cost)." title="Most profitable products">
          {data.topGrossProfitProducts.length > 0 ? (
            <KeyValue rows={data.topGrossProfitProducts.map((p) => ({ key: p.name, label: `${p.name} (×${number(p.quantity)})`, value: formatSom(p.grossProfitMinor) }))} />
          ) : (
            <EmptyState text="No product has a known cost yet in this period." title="No data" variant="inline" />
          )}
        </SectionCard>
        <SectionCard description="Operating expenses, grouped by category." title="Where the money went">
          {data.operatingExpenses.byCategory.length > 0 ? (
            <KeyValue rows={data.operatingExpenses.byCategory.sort((a, b) => b.amountMinor - a.amountMinor).map((c) => ({ key: c.categoryId, label: c.categoryName, value: formatSom(c.amountMinor) }))} />
          ) : (
            <EmptyState text="No operating expenses recorded in this period." title="No expenses" variant="inline" />
          )}
        </SectionCard>
      </div>
    </div>
  );
}

function PnlTab({ ready, ...filters }: TabProps) {
  const { data, error, loading } = useFinanceData(() => fetchFinanceOverview(filters), [filters.period, filters.startDate, filters.endDate, filters.branchId], ready);
  if (error) return <ErrorState message={error} title="P&L could not be loaded" />;
  if (!data) return <LoadingState variant="page" />;

  const line = (label: string, value: number, strong?: boolean, negative?: boolean) => ({
    key: label,
    label: <span style={strong ? { fontWeight: 600 } : undefined}>{label}</span>,
    value: <span style={strong ? { fontWeight: 600 } : undefined}>{negative ? `− ${formatSom(value)}` : formatSom(value)}</span>,
  });

  return (
    <div className="stack" style={{ opacity: loading ? 0.6 : 1 }}>
      <CogsBanner data={data} />
      <SectionCard description={`${data.period.startDate} → ${data.period.endDate}${data.branch ? ` · ${data.branch.name}` : ' · All branches'}`} title="Profit & Loss statement">
        <KeyValue
          rows={[
            line('Revenue', data.revenue),
            line('COGS', data.cogs.amountMinor, false, true),
            line('Gross Profit', data.grossProfit, true),
            ...data.operatingExpenses.byCategory.map((c) => line(`  ${c.categoryName}`, c.amountMinor, false, true)),
            line('Operating Profit', data.operatingProfit, true),
            ...data.taxes.lines.map((t) => line(`  Tax: ${t.name} (${t.ratePct}% of ${t.calculationBase.toLowerCase().replace('_', ' ')})`, t.amountMinor, false, true)),
            line('Interest', data.interest, false, true),
            ...data.otherFinancialCosts.byCategory.map((c) => line(`  ${c.categoryName}`, c.amountMinor, false, true)),
            line('Net Profit', data.netProfit, true),
          ]}
        />
      </SectionCard>
      {!data.cogs.complete && (
        <SectionCard description="Sold in this period, no Poster recipe configured yet — excluded from COGS above." title="Products with unknown cost">
          <KeyValue rows={data.cogs.missingRecipeProducts.map((p, i) => ({ key: `${p.name}-${i}`, label: p.name, value: `×${number(p.quantity)}` }))} />
        </SectionCard>
      )}
    </div>
  );
}

function CashFlowTab({ ready, ...filters }: TabProps) {
  const { data, error, loading } = useFinanceData(() => fetchFinanceCashFlow(filters), [filters.period, filters.startDate, filters.endDate, filters.branchId], ready);
  const [roi, setRoi] = useState<FinanceRoi | null>(null);
  useEffect(() => {
    if (!ready) return;
    fetchFinanceRoi(filters)
      .then(setRoi)
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.period, filters.startDate, filters.endDate, filters.branchId, ready]);

  if (error) return <ErrorState message={error} title="Cash flow could not be loaded" />;
  if (!data) return <LoadingState variant="page" />;

  return (
    <div className="stack" style={{ opacity: loading ? 0.6 : 1 }}>
      <StatGrid>
        <StatCard hint="not reconciled against a real statement — see note below" label="Opening balance" value={formatSom(data.openingBalance)} />
        <StatCard label="Cash in" value={formatSom(data.cashIn.total)} />
        <StatCard label="Cash out" value={formatSom(data.cashOut.total)} />
        <StatCard label="Net cash flow" strong value={formatSom(data.netCashFlow)} />
        <StatCard label="Closing balance" strong value={formatSom(data.closingBalance)} />
        {roi && roi.roiPct !== null && <StatCard hint="Net Profit ÷ total investment" label="ROI (period)" value={`${roi.roiPct}%`} />}
      </StatGrid>
      <ChartContainer description="Cash out, by category." title="Cash outflow breakdown">
        <BarChart
          ariaLabel="Cash outflow"
          data={[
            { label: 'Operating expenses (paid)', value: data.cashOut.operatingExpensesPaid },
            { label: 'Financial expenses (paid)', value: data.cashOut.financialExpensesPaid },
            { label: 'Loan principal', value: data.cashOut.loanPrincipal },
            { label: 'Loan interest', value: data.cashOut.loanInterest },
            { label: 'Investments', value: data.cashOut.investments },
            { label: 'Manual adjustments', value: data.cashOut.manualAdjustments },
          ]}
          format={formatSom}
        />
      </ChartContainer>
      <SectionCard title="What this view does not cover">
        <ul className="hint-text" style={{ margin: 0, paddingLeft: '1.1em' }}>
          {data.limitations.map((l) => (
            <li key={l} style={{ marginBottom: 'var(--space-1)' }}>
              {l}
            </li>
          ))}
        </ul>
      </SectionCard>
    </div>
  );
}
