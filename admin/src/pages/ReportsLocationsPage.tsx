import { useState } from 'react';
import { formatSom } from '../lib/format';
import { findNav } from '../lib/nav';
import { useReportsLocations } from '../lib/useReportsLocations';
import { ReportsLocationsOverview } from '../lib/types';
import { BarChart, Button, ChartContainer, Column, cx, DataTable, DateRangePicker, DateRangeValue, EmptyState, ErrorState, FilterBar, FilterField, HBarList, isRangeReady, LoadingState, PageHeader, SectionCard, StatCard, StatGrid } from '../ui';

const number = (n: number) => n.toLocaleString('ru-RU');

type BranchRow = ReportsLocationsOverview['branches'][number];

// Locations — a REPORT, not a second Finance dashboard (no profit, no ranking, no score). CUP canonical figures
// (from BranchIntelligence/Reports Overview) and Poster's own report are shown as two clearly separate sections;
// they are never added together. branchId is local page state, not a URL query param — this app has no page that
// encodes filter state in the URL today (Finance/Analytics both use plain component state), so Locations follows
// that same convention rather than introducing a new one.
export function ReportsLocationsPage() {
  const [range, setRange] = useState<DateRangeValue>({ period: 'last7', startDate: '', endDate: '' });
  const [branchId, setBranchId] = useState('');
  const ready = isRangeReady(range);
  const { data, error, loading, reload } = useReportsLocations({ ...range, branchId: branchId || undefined }, ready);
  const { item } = findNav('reports-locations');
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
            {loading && ' · updating…'}
          </span>
        )}
      </FilterBar>

      {error && <ErrorState message={error} onRetry={reload} title="Locations could not be loaded" />}
      {!data && !error && ready && <LoadingState variant="page" />}

      {data && !error && (
        <div className={cx('flex min-w-0 flex-col gap-5 transition-opacity duration-200', loading && 'opacity-60')}>
          {data.branch ? <BranchDetail branchName={data.branch.name} data={data} onBack={() => setBranchId('')} /> : <AllBranches data={data} onSelectBranch={setBranchId} />}
          <PosterReferenceCard data={data} />
        </div>
      )}
    </>
  );
}

function AllBranches({ data, onSelectBranch }: { data: ReportsLocationsOverview; onSelectBranch: (id: string) => void }) {
  const columns: Column<BranchRow>[] = [
    { key: 'name', header: 'Branch', cell: (b) => <span className="font-semibold text-black">{b.branchName}</span> },
    { key: 'revenue', header: 'Revenue', numeric: true, cell: (b) => formatSom(b.revenue) },
    { key: 'orders', header: 'Orders', numeric: true, cell: (b) => number(b.orders) },
    { key: 'customers', header: 'Customers', numeric: true, cell: (b) => number(b.customers) },
    { key: 'new', header: 'New', numeric: true, low: true, cell: (b) => number(b.newCustomers) },
    { key: 'returning', header: 'Returning', numeric: true, low: true, cell: (b) => number(b.returningCustomers) },
    { key: 'aov', header: 'Avg receipt', numeric: true, cell: (b) => formatSom(b.averageReceipt) },
    { key: 'cup', header: 'CUP', numeric: true, low: true, cell: (b) => formatSom(b.cupRevenue) },
    { key: 'pos', header: 'POS', numeric: true, low: true, cell: (b) => formatSom(b.posRevenue) },
  ];

  return (
    <>
      <StatGrid>
        <StatCard hint="CUP + independent POS" label="Revenue" strong value={formatSom(data.summary.revenue)} />
        <StatCard label="Orders" value={number(data.summary.orders)} />
        <StatCard label="Customers" value={number(data.summary.customers)} />
        <StatCard hint="Revenue ÷ orders" label="Average receipt" value={formatSom(data.summary.averageReceipt)} />
      </StatGrid>

      {data.notes.length > 0 && (
        <div className="block space-y-1 rounded-md border-l-[3px] px-4 py-3 text-sm leading-relaxed [&_p]:m-0 border-muted-cream bg-neutral-bg text-muted-cream">
          {data.notes.map((n) => (
            <p key={n}>{n}</p>
          ))}
        </div>
      )}

      <SourceMix summary={data.summary} />

      <SectionCard description="Click a branch to see its own trend and breakdown. No ranking — branches are listed as they are, not scored." flush title="Branches">
        <DataTable columns={columns} empty={<EmptyState text="No branch activity in this period." title="No data" variant="inline" />} onRowClick={(b) => onSelectBranch(b.branchId)} rowKey={(b) => b.branchId} rows={data.branches} />
      </SectionCard>

      {data.summary.unattributedOrders > 0 && (
        <SectionCard description="Sales without an explicit branch mapping are included in total revenue above but are not assigned to any branch." title="Unattributed sales">
          <StatGrid>
            <StatCard label="Revenue" value={formatSom(data.summary.unattributedRevenue)} />
            <StatCard label="Orders" value={number(data.summary.unattributedOrders)} />
          </StatGrid>
        </SectionCard>
      )}

      <ChartContainer description="Revenue per business day, all branches combined." title="Revenue over time">
        <BarChart ariaLabel="Daily revenue" data={data.trend.map((d) => ({ label: d.date, value: d.revenue }))} format={formatSom} />
      </ChartContainer>
    </>
  );
}

function BranchDetail({ branchName, data, onBack }: { branchName: string; data: ReportsLocationsOverview; onBack: () => void }) {
  return (
    <>
      <Button onClick={onBack} className="mb-2" variant="secondary">
        ← Back to all locations
      </Button>
      <h2 className="mt-1 mb-0 mx-0">{branchName}</h2>

      <StatGrid>
        <StatCard hint="CUP + independent POS" label="Revenue" strong value={formatSom(data.summary.revenue)} />
        <StatCard label="Orders" value={number(data.summary.orders)} />
        <StatCard label="Customers" value={number(data.summary.customers)} />
        <StatCard hint="Revenue ÷ orders" label="Average receipt" value={formatSom(data.summary.averageReceipt)} />
      </StatGrid>

      {data.notes.length > 0 && (
        <div className="block space-y-1 rounded-md border-l-[3px] px-4 py-3 text-sm leading-relaxed [&_p]:m-0 border-muted-cream bg-neutral-bg text-muted-cream">
          {data.notes.map((n) => (
            <p key={n}>{n}</p>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <ChartContainer description="Revenue per business day at this branch." title="Revenue trend">
          <BarChart ariaLabel="Daily revenue" data={data.trend.map((d) => ({ label: d.date, value: d.revenue }))} format={formatSom} />
        </ChartContainer>
        <ChartContainer description="Orders per business day at this branch." title="Orders trend">
          <BarChart ariaLabel="Daily orders" data={data.trend.map((d) => ({ label: d.date, value: d.orders }))} format={number} />
        </ChartContainer>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <SourceMix summary={data.summary} />
        {data.detail && (
          <SectionCard description="Who bought at this branch in the period (identified customers only)." title="Customer mix">
            {data.detail.customers.new + data.detail.customers.returning > 0 ? (
              <HBarList
                items={[
                  { name: 'New customers', value: data.detail.customers.new, valueLabel: number(data.detail.customers.new) },
                  { name: 'Returning customers', value: data.detail.customers.returning, valueLabel: number(data.detail.customers.returning) },
                ]}
              />
            ) : (
              <EmptyState text="No identified customers bought here in this period." title="No customer activity" variant="inline" />
            )}
          </SectionCard>
        )}
      </div>
    </>
  );
}

// CUP / POS as a two-level hierarchy (Part 9 of the spec): POS's own bar already includes its anonymous subset —
// anonymousPosRevenue is shown as a nested breakout, never a third additive total.
function SourceMix({ summary }: { summary: ReportsLocationsOverview['summary'] }) {
  const identifiedPos = summary.posRevenue - summary.anonymousPosRevenue;
  return (
    <SectionCard description="CUP-originated vs. independent Poster POS sales." title="Source">
      {summary.revenue > 0 ? (
        <HBarList
          items={[
            { name: 'CUP-originated', value: summary.cupRevenue, valueLabel: formatSom(summary.cupRevenue) },
            { name: 'POS — identified customers', value: identifiedPos, valueLabel: formatSom(identifiedPos) },
            { name: 'POS — anonymous customers', value: summary.anonymousPosRevenue, valueLabel: formatSom(summary.anonymousPosRevenue) },
          ]}
        />
      ) : (
        <EmptyState text="No revenue was recorded in this period." title="No sales" variant="inline" />
      )}
    </SectionCard>
  );
}

// Poster's own report, kept visually and structurally separate — a comparison figure, never summed with CUP's
// canonical numbers above. No profit field is read or shown (see poster-reports.service.ts).
function PosterReferenceCard({ data }: { data: ReportsLocationsOverview }) {
  const ref = data.posterReference;
  return (
    <SectionCard description={ref.note} title="Poster reference (comparison only)">
      {ref.available ? (
        <StatGrid>
          <StatCard label="Poster revenue" value={formatSom(ref.revenueMinor)} />
          <StatCard label="Poster receipts" value={number(ref.orders)} />
          <StatCard label="Poster average receipt" value={formatSom(ref.averageReceiptMinor)} />
        </StatGrid>
      ) : (
        <EmptyState text="Poster's report could not be read for this period." title="Unavailable" variant="inline" />
      )}
    </SectionCard>
  );
}
