import { useEffect, useState } from 'react';
import { fetchFinanceOverview, fetchFinancePayback } from '../lib/adminFinance';
import { formatSom } from '../lib/format';
import { findNav } from '../lib/nav';
import { FinancePayback } from '../lib/types';
import { FinanceCogsBanner } from '../components/FinanceCogsBanner';
import { FinanceFilterBar } from '../components/FinanceFilterBar';
import { FinanceRangeValue, isFinanceRangeReady } from '../components/FinancePeriodPicker';
import { useFinanceData } from '../components/useFinanceData';
import { cx, EmptyState, ErrorState, KeyValue, LoadingState, PageHeader, SectionCard, StatCard, StatGrid } from '../ui';

const number = (n: number) => n.toLocaleString('ru-RU');

export function FinanceOverviewPage() {
  const { item } = findNav('finance');
  const [range, setRange] = useState<FinanceRangeValue>({ period: 'thisMonth', startDate: '', endDate: '' });
  const [branchId, setBranchId] = useState('');
  const ready = isFinanceRangeReady(range);
  const filters = { ...range, branchId: branchId || undefined };

  const { data, error, loading } = useFinanceData(() => fetchFinanceOverview(filters), [filters.period, filters.startDate, filters.endDate, filters.branchId], ready);
  const [payback, setPayback] = useState<FinancePayback | null>(null);
  useEffect(() => {
    fetchFinancePayback().then(setPayback).catch(() => undefined);
  }, []);

  return (
    <>
      <PageHeader description={item.description} title={item.label} />
      <FinanceFilterBar branchId={branchId} onBranchChange={setBranchId} onRangeChange={setRange} range={range} />

      {error && <ErrorState message={error} title="Finance overview could not be loaded" />}
      {!data && !error && <LoadingState variant="page" />}

      {data && (
        <div className={cx('flex min-w-0 flex-col gap-5 transition-opacity duration-200', loading && 'opacity-60')}>
          <FinanceCogsBanner data={data} />
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
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
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
      )}
    </>
  );
}
