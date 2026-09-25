import { useState } from 'react';
import { formatSom } from '../lib/format';
import { findNav } from '../lib/nav';
import { useReportsOverview } from '../lib/useReportsOverview';
import { ReportsOverview } from '../lib/types';
import { BarChart, ChartContainer, cx, DateRangePicker, DateRangeValue, EmptyState, ErrorState, FilterBar, FilterField, HBarList, isRangeReady, LoadingState, PageHeader, SectionCard, StatCard, StatGrid } from '../ui';

const number = (n: number) => n.toLocaleString('ru-RU');
const percent = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—');

function SourceBreakdown({ data }: { data: ReportsOverview }) {
  const { cupOriginated, independentPos, anonymousPos } = data.sourceBreakdown;
  const total = cupOriginated.revenue + independentPos.revenue + anonymousPos.revenue;
  return (
    <SectionCard description="Where the revenue was recorded — CUP orders vs. independent Poster POS sales." title="Revenue source">
      {total > 0 ? (
        <HBarList
          items={[
            { name: 'CUP-originated', value: cupOriginated.revenue, valueLabel: formatSom(cupOriginated.revenue), hint: `${number(cupOriginated.orders)} orders` },
            ...(data.sourceBreakdown.importedDataExists
              ? [
                  { name: 'Independent POS (identified)', value: independentPos.revenue, valueLabel: formatSom(independentPos.revenue), hint: `${number(independentPos.purchases)} purchases` },
                  { name: 'Independent POS (anonymous)', value: anonymousPos.revenue, valueLabel: formatSom(anonymousPos.revenue), hint: `${number(anonymousPos.purchases)} purchases` },
                ]
              : []),
          ]}
        />
      ) : (
        <EmptyState text="No revenue was recorded in this period." title="No sales" variant="inline" />
      )}
      {!data.sourceBreakdown.importedDataExists && <p className="text-[13px] leading-snug text-muted">No Poster POS receipts have been imported for this period yet.</p>}
    </SectionCard>
  );
}

export function ReportsOverviewPage() {
  const [range, setRange] = useState<DateRangeValue>({ period: 'last7', startDate: '', endDate: '' });
  const [branchId, setBranchId] = useState('');
  const ready = isRangeReady(range);
  const { data, error, loading, reload } = useReportsOverview('overview', { ...range, branchId: branchId || undefined }, ready);
  const { item } = findNav('reports-overview');
  const branches = data?.filters.branches ?? [];
  const totalCustomers = data ? data.newCustomers + data.returningCustomers : 0;

  return (
    <>
      <PageHeader description={item.description} title={item.label} />

      <FilterBar>
        <DateRangePicker onChange={setRange} value={range} />
        <FilterField label="Branch">
          <select className="" onChange={(e) => setBranchId(e.target.value)} value={branchId}>
            <option value="">All branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </FilterField>
        {data && !error && (
          <span className="text-[13px] leading-snug text-muted self-center">
            {data.period.startDate === data.period.endDate ? data.period.startDate : `${data.period.startDate} → ${data.period.endDate}`}
            {data.branch ? ` · ${data.branch.name}` : ' · All branches'}
            {loading && ' · updating…'}
          </span>
        )}
      </FilterBar>

      {error && <ErrorState message={error} onRetry={reload} title="The figures could not be loaded" />}
      {!data && !error && ready && <LoadingState variant="page" />}

      {data && !error && (
        <div className={cx('flex min-w-0 flex-col gap-5 transition-opacity duration-200', loading && 'opacity-60')}>
          <StatGrid>
            <StatCard hint="CUP + independent POS" label="Revenue" strong value={formatSom(data.revenue)} />
            <StatCard label="Orders / Receipts" value={number(data.orders)} />
            <StatCard label="Customers" value={number(data.customers)} />
            <StatCard label="New customers" value={number(data.newCustomers)} />
            <StatCard label="Returning customers" value={number(data.returningCustomers)} />
            <StatCard hint="Revenue ÷ orders" label="Average order" value={formatSom(data.averageOrder)} />
          </StatGrid>

          {data.notes.length > 0 && (
            <div className="block space-y-1 rounded-md border-l-[3px] px-4 py-3 text-sm leading-relaxed [&_p]:m-0 border-muted-cream bg-neutral-bg text-muted-cream">
              {data.notes.map((n) => (
                <p key={n}>{n}</p>
              ))}
            </div>
          )}

          <ChartContainer description="Revenue per business day." title="Revenue over time">
            <BarChart ariaLabel="Daily revenue" data={data.revenueByDay.map((d) => ({ label: d.date, value: d.revenue }))} format={formatSom} />
          </ChartContainer>
          <ChartContainer description="Orders and receipts per business day (CUP + Poster POS)." title="Orders over time">
            <BarChart ariaLabel="Daily orders" data={data.ordersByDay.map((d) => ({ label: d.date, value: d.orders }))} format={number} />
          </ChartContainer>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <SectionCard description="Who bought in this period (identified customers only)." title="Customer mix">
              {totalCustomers > 0 ? (
                <HBarList
                  items={[
                    { name: 'New customers', value: data.newCustomers, valueLabel: number(data.newCustomers), hint: percent(data.newCustomers, totalCustomers) },
                    { name: 'Returning customers', value: data.returningCustomers, valueLabel: number(data.returningCustomers), hint: percent(data.returningCustomers, totalCustomers) },
                  ]}
                />
              ) : (
                <EmptyState text="No identified customers bought in this period." title="No customer activity" variant="inline" />
              )}
            </SectionCard>
            <SourceBreakdown data={data} />
          </div>
        </div>
      )}
    </>
  );
}
