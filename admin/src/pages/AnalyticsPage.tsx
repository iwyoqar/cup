import { useState } from 'react';
import { formatSom } from '../lib/format';
import { findNav } from '../lib/nav';
import { useAnalyticsOverview } from '../lib/useAnalyticsOverview';
import { AnalyticsOverview } from '../lib/types';
import { BarChart, ChartContainer, Column, cx, DataTable, DateRangePicker, DateRangeValue, EmptyState, ErrorState, FilterBar, FilterField, HBarList, isRangeReady, KeyValue, LoadingState, PageHeader, SectionCard, StatCard, StatGrid, StatusBadge } from '../ui';

const number = (n: number) => n.toLocaleString('ru-RU');
const percent = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—');

type Product = AnalyticsOverview['topProducts'][number];

// Phase 17 — Analytics V1's data, presented two ways from ONE page (no duplicate implementation): "Sales" leads with revenue, orders and what sells;
// "Analytics" leads with customers, sources and product mix. The backend computes every figure; this page only formats and draws them.
export function AnalyticsPage({ view }: { view: 'sales' | 'analytics' }) {
  const [range, setRange] = useState<DateRangeValue>({ period: 'last7', startDate: '', endDate: '' });
  const [branchId, setBranchId] = useState('');
  const ready = isRangeReady(range);
  const { data, error, loading, reload } = useAnalyticsOverview({ ...range, branchId: branchId || undefined }, ready);
  const { item } = findNav(view);
  const branches = data?.filters.branches ?? [];

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
          {view === 'sales' ? <SalesView data={data} /> : <AnalyticsView data={data} />}
        </div>
      )}
    </>
  );
}

function productColumns(revenueTotal: number): Column<Product>[] {
  return [
    { key: 'name', header: 'Product', cell: (p) => <span className="font-semibold text-black">{p.name}</span> },
    { key: 'qty', header: 'Qty', numeric: true, cell: (p) => number(p.quantity) },
    { key: 'revenue', header: 'Revenue', numeric: true, cell: (p) => formatSom(p.revenue) },
    { key: 'share', header: 'Share of revenue', numeric: true, low: true, cell: (p) => percent(p.revenue, revenueTotal) },
  ];
}

function ProductsCard({ data }: { data: AnalyticsOverview }) {
  return (
    <SectionCard description="Ranked by revenue in the selected period." flush title="Top products">
      <DataTable
        columns={productColumns(data.revenue)}
        empty={<EmptyState text="Nothing was sold in this period." title="No products yet" variant="inline" />}
        rowKey={(p) => p.name}
        rows={data.topProducts}
      />
    </SectionCard>
  );
}

function SourceCard({ data }: { data: AnalyticsOverview }) {
  const { cup, pos } = data.sourceBreakdown;
  const total = cup.revenue + pos.revenue;
  return (
    <SectionCard description="Where the revenue was recorded." title="Sales source">
      {total > 0 ? (
        <HBarList
          items={[
            { name: 'CUP orders', value: cup.revenue, valueLabel: formatSom(cup.revenue), hint: `${number(cup.orders)} orders` },
            ...(pos.importedDataExists ? [{ name: 'Poster POS', value: pos.revenue, valueLabel: formatSom(pos.revenue), hint: `${number(pos.purchases)} purchases` }] : []),
          ]}
        />
      ) : (
        <EmptyState text="No revenue was recorded in this period." title="No sales" variant="inline" />
      )}
      {!pos.importedDataExists && <p className="text-[13px] leading-snug text-muted">No Poster POS receipts have been imported for this period yet.</p>}
    </SectionCard>
  );
}

function SalesView({ data }: { data: AnalyticsOverview }) {
  return (
    <>
      <StatGrid>
        <StatCard hint="CUP + imported POS" label="Revenue" strong value={formatSom(data.revenue)} />
        <StatCard label="Orders" value={number(data.orders)} />
        <StatCard hint="Revenue ÷ orders" label="Average order" value={formatSom(data.averageOrder)} />
        <StatCard label="Customers" value={number(data.customers)} />
      </StatGrid>
      <ChartContainer description="Revenue per business day." title="Daily sales">
        <BarChart ariaLabel="Daily revenue" data={data.revenueByDay.map((d) => ({ label: d.date, value: d.revenue }))} format={formatSom} />
      </ChartContainer>
      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <ProductsCard data={data} />
        <SourceCard data={data} />
      </div>
    </>
  );
}

function AnalyticsView({ data }: { data: AnalyticsOverview }) {
  const totalCustomers = data.newCustomers + data.returningCustomers;
  return (
    <>
      <StatGrid>
        <StatCard label="Customers" strong value={number(data.customers)} />
        <StatCard label="New customers" value={number(data.newCustomers)} />
        <StatCard label="Returning customers" value={number(data.returningCustomers)} />
        <StatCard hint="Returning ÷ (new + returning)" label="Repeat share" value={percent(data.returningCustomers, totalCustomers)} />
      </StatGrid>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <SectionCard description="Who bought in this period." title="Customers">
          {totalCustomers > 0 ? (
            <HBarList
              items={[
                { name: 'New customers', value: data.newCustomers, valueLabel: number(data.newCustomers), hint: percent(data.newCustomers, totalCustomers) },
                { name: 'Returning customers', value: data.returningCustomers, valueLabel: number(data.returningCustomers), hint: percent(data.returningCustomers, totalCustomers) },
              ]}
            />
          ) : (
            <EmptyState text="No customers bought in this period." title="No customer activity" variant="inline" />
          )}
          <KeyValue
            rows={[
              { key: 'orders', label: 'Orders', value: number(data.orders) },
              { key: 'aov', label: 'Average order', value: formatSom(data.averageOrder) },
              { key: 'rev', label: 'Revenue', value: formatSom(data.revenue) },
            ]}
          />
        </SectionCard>
        <SourceCard data={data} />
      </div>
      <ProductsCard data={data} />
      <ChartContainer description="Revenue per business day — the latest day is highlighted." title="Revenue trend">
        <BarChart ariaLabel="Daily revenue" data={data.revenueByDay.map((d) => ({ label: d.date, value: d.revenue }))} format={formatSom} />
      </ChartContainer>
      {!data.sourceBreakdown.pos.importedDataExists && (
        <div className="block space-y-1 rounded-md border-l-[3px] px-4 py-3 text-sm leading-relaxed [&_p]:m-0 border-muted-cream bg-neutral-bg text-muted-cream">
          <StatusBadge>Note</StatusBadge> Poster POS receipts appear here after they are imported (POS Import) or synced automatically (Continuous Sync).
        </div>
      )}
    </>
  );
}
