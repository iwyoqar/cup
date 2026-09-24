import { useState } from 'react';
import { formatSom } from '../lib/format';
import { findNav } from '../lib/nav';
import { useReportsOverview } from '../lib/useReportsOverview';
import { ReportsOverview } from '../lib/types';
import {
  BarChart,
  ChartContainer,
  Column,
  DataTable,
  DateRangePicker,
  DateRangeValue,
  EmptyState,
  ErrorState,
  FilterBar,
  FilterField,
  HBarList,
  isRangeReady,
  LoadingState,
  PageHeader,
  SectionCard,
  StatCard,
  StatGrid,
} from '../ui';

const number = (n: number) => n.toLocaleString('ru-RU');

type Product = ReportsOverview['topProducts'][number];

// Top products by revenue (CUP DB only, no Poster profit figure — Part 7's explicit rule: Sales never shows
// profitability, that is Finance/Products-phase territory).
function productColumns(revenueTotal: number): Column<Product>[] {
  return [
    { key: 'name', header: 'Product', cell: (p) => <span className="table__primary">{p.name}</span> },
    { key: 'qty', header: 'Qty', numeric: true, cell: (p) => number(p.quantity) },
    { key: 'revenue', header: 'Revenue', numeric: true, cell: (p) => formatSom(p.revenue) },
    { key: 'share', header: 'Share of revenue', numeric: true, low: true, cell: (p) => (revenueTotal > 0 ? `${Math.round((p.revenue / revenueTotal) * 100)}%` : '—') },
  ];
}

export function ReportsSalesPage() {
  const [range, setRange] = useState<DateRangeValue>({ period: 'last7', startDate: '', endDate: '' });
  const [branchId, setBranchId] = useState('');
  const ready = isRangeReady(range);
  const { data, error, loading, reload } = useReportsOverview('sales', { ...range, branchId: branchId || undefined }, ready);
  const { item } = findNav('reports-sales');
  const branches = data?.filters.branches ?? [];

  return (
    <>
      <PageHeader description={item.description} title={item.label} />

      <FilterBar>
        <DateRangePicker onChange={setRange} value={range} />
        <FilterField label="Branch">
          <select className="select" onChange={(e) => setBranchId(e.target.value)} value={branchId}>
            <option value="">All branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </FilterField>
        {data && !error && (
          <span className="hint-text" style={{ alignSelf: 'center' }}>
            {data.period.startDate === data.period.endDate ? data.period.startDate : `${data.period.startDate} → ${data.period.endDate}`}
            {data.branch ? ` · ${data.branch.name}` : ' · All branches'}
            {loading && ' · updating…'}
          </span>
        )}
      </FilterBar>

      {error && <ErrorState message={error} onRetry={reload} title="Sales could not be loaded" />}
      {!data && !error && ready && <LoadingState variant="page" />}

      {data && !error && (
        <div className="stack" style={{ opacity: loading ? 0.6 : 1, transition: 'opacity var(--motion-base) var(--ease)' }}>
          <StatGrid>
            <StatCard hint="CUP + independent POS" label="Revenue" strong value={formatSom(data.revenue)} />
            <StatCard label="Orders / Receipts" value={number(data.orders)} />
            <StatCard label="Customers" value={number(data.customers)} />
            <StatCard hint="Revenue ÷ orders" label="Average receipt" value={formatSom(data.averageOrder)} />
            <StatCard label="New customers" value={number(data.newCustomers)} />
            <StatCard label="Returning customers" value={number(data.returningCustomers)} />
          </StatGrid>

          {data.notes.length > 0 && (
            <div className="callout">
              {data.notes.map((n) => (
                <p key={n}>{n}</p>
              ))}
            </div>
          )}

          <div className="grid-2">
            <ChartContainer description="Revenue per business day." title="Revenue trend">
              <BarChart ariaLabel="Daily revenue" data={data.revenueByDay.map((d) => ({ label: d.date, value: d.revenue }))} format={formatSom} />
            </ChartContainer>
            <ChartContainer description="Orders and receipts per business day." title="Orders trend">
              <BarChart ariaLabel="Daily orders" data={data.ordersByDay.map((d) => ({ label: d.date, value: d.orders }))} format={number} />
            </ChartContainer>
          </div>

          <SectionCard description="Where the revenue was recorded — CUP orders vs. independent Poster POS sales." title="Source">
            {data.revenue > 0 ? (
              <HBarList
                items={[
                  { name: 'CUP-originated', value: data.sourceBreakdown.cupOriginated.revenue, valueLabel: formatSom(data.sourceBreakdown.cupOriginated.revenue), hint: `${number(data.sourceBreakdown.cupOriginated.orders)} orders` },
                  ...(data.sourceBreakdown.importedDataExists
                    ? [
                        {
                          name: 'Independent POS (identified)',
                          value: data.sourceBreakdown.independentPos.revenue,
                          valueLabel: formatSom(data.sourceBreakdown.independentPos.revenue),
                          hint: `${number(data.sourceBreakdown.independentPos.purchases)} purchases`,
                        },
                        {
                          name: 'Independent POS (anonymous)',
                          value: data.sourceBreakdown.anonymousPos.revenue,
                          valueLabel: formatSom(data.sourceBreakdown.anonymousPos.revenue),
                          hint: `${number(data.sourceBreakdown.anonymousPos.purchases)} purchases`,
                        },
                      ]
                    : []),
                ]}
              />
            ) : (
              <EmptyState text="No revenue was recorded in this period." title="No sales" variant="inline" />
            )}
          </SectionCard>

          <SectionCard description="Ranked by revenue in the selected period. Product cost/profit is not shown here — see Finance." flush title="Top products">
            <DataTable
              columns={productColumns(data.revenue)}
              empty={<EmptyState text="Nothing was sold in this period." title="No products yet" variant="inline" />}
              rowKey={(p) => p.name}
              rows={data.topProducts}
            />
          </SectionCard>
        </div>
      )}
    </>
  );
}
