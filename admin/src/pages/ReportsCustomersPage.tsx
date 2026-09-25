import { useEffect, useState } from 'react';
import { CustomerDetailView } from '../components/CustomerDetailView';
import { formatDate, formatSom } from '../lib/format';
import { findNav } from '../lib/nav';
import { ReportsCustomersOverview } from '../lib/reportsTypes';
import { rangeParams, useReport } from '../lib/useReport';
import { Column, DataTable, DateRangePicker, DateRangeValue, EmptyState, FilterBar, isRangeReady, KeyValue, PageHeader, Pagination, SearchInput, SectionCard, StatCard, StatGrid } from '../ui';
import { BranchSelect, num, PeriodHint, pctOrDash, ReportBody } from './reportsShared';
import { SortSelect, SortState } from './reportsProductShared';

type Row = ReportsCustomersOverview['rows'][number];
type SortKey = 'revenue' | 'purchases' | 'units' | 'averageCheck' | 'lastPurchase' | 'firstPurchase';
const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'revenue', label: 'Revenue' },
  { key: 'purchases', label: 'Purchases' },
  { key: 'units', label: 'Units' },
  { key: 'averageCheck', label: 'Avg. check' },
  { key: 'lastPurchase', label: 'Last purchase' },
  { key: 'firstPurchase', label: 'First purchase' },
];

const columns: Column<Row>[] = [
  { key: 'name', header: 'Customer', cell: (r) => <span className="font-semibold text-black">{r.name ?? '—'}{!r.isActive && ' (deactivated)'}</span> },
  { key: 'phone', header: 'Phone', low: true, cell: (r) => r.phone ?? '—' },
  { key: 'p', header: 'Purchases', numeric: true, cell: (r) => num(r.purchases) },
  { key: 'u', header: 'Units', numeric: true, low: true, cell: (r) => num(r.units) },
  { key: 'r', header: 'Revenue', numeric: true, cell: (r) => formatSom(r.revenueMinor) },
  { key: 'a', header: 'Avg. check', numeric: true, low: true, cell: (r) => formatSom(r.averageCheckMinor) },
  { key: 'src', header: 'CUP / POS', low: true, cell: (r) => `${num(r.source.cupPurchases)} / ${num(r.source.posPurchases)}` },
  { key: 'last', header: 'Last purchase', low: true, cell: (r) => formatDate(r.lastPurchaseAt) },
  { key: 'lc', header: 'Current lifecycle', low: true, cell: (r) => r.currentLifecycle ?? '—' },
];

// Customers — identified customers only (CUP orders + imported POS receipts linked to a customer). Customer-less POS
// sales are never rows; they are shown as a separate "Anonymous POS" figure. Paging, search and sort run on the server.
export function ReportsCustomersPage() {
  const [range, setRange] = useState<DateRangeValue>({ period: 'last30', startDate: '', endDate: '' });
  const [branchId, setBranchId] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortState<SortKey>>({ by: 'revenue', direction: 'desc' });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const ready = isRangeReady(range);
  const { item } = findNav('reports-customers');

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);
  useEffect(() => setPage(1), [range, branchId, search, sort]);

  const { data, error, loading, reload } = useReport<ReportsCustomersOverview>('customers', { ...rangeParams(range), branchId, search, sortBy: sort.by, sortDirection: sort.direction, page, limit: 50 }, ready);

  if (selected) return <CustomerDetailView backLabel="Back to Customers report" customerId={selected} onBack={() => setSelected(null)} readOnly />;

  return (
    <>
      <PageHeader description={item.description} title={item.label} />
      <FilterBar>
        <DateRangePicker onChange={setRange} value={range} />
        <BranchSelect branches={data?.filters.branches ?? []} onChange={setBranchId} value={branchId} />
        <SortSelect onChange={setSort} options={SORT_OPTIONS} value={sort} />
        <SearchInput label="Search customers" onChange={setSearchInput} placeholder="Name or phone" value={searchInput} />
        <PeriodHint loading={loading} period={data?.period} />
      </FilterBar>

      <ReportBody data={data} error={error} loading={loading} ready={ready} reload={reload} title="Customers could not be loaded">
        {(d) => (
          <>
            <StatGrid>
              <StatCard hint="Distinct customers with purchases" label="Identified customers" strong value={num(d.summary.identifiedCustomers)} />
              <StatCard hint="CUP + POS linked to a customer" label="Customer revenue" value={formatSom(d.summary.customerRevenueMinor)} />
              <StatCard hint="POS receipts with no customer" label="Anonymous POS revenue" value={formatSom(d.anonymousPos.revenueMinor)} />
              <StatCard hint="Customer revenue ÷ purchases" label="Avg. customer purchase" value={d.summary.averageCustomerPurchaseMinor === null ? '—' : formatSom(d.summary.averageCustomerPurchaseMinor)} />
              <StatCard hint="First-ever purchase in this period" label="New customers" value={num(d.summary.newCustomers)} />
              <StatCard hint="Bought before this period too" label="Returning customers" value={num(d.summary.returningCustomers)} />
              <StatCard hint="Of total Analytics revenue" label="Customer revenue share" value={pctOrDash(d.summary.customerRevenueSharePercent)} />
            </StatGrid>

            <SectionCard
              description="One purchase = one CUP order or one imported POS receipt. Dates are within the selected period. Lifecycle is Growth Intelligence's current state (as of today), not a period figure. Click a customer to open Customer 360 (read-only)."
              flush
              title="Customers"
            >
              <DataTable
                columns={columns}
                empty={<EmptyState text={d.anonymousPos.purchases > 0 ? 'Sales in this period were anonymous POS receipts only — see below.' : search ? 'No customer matches this search.' : 'No purchases in this period.'} title="No identified customers" variant="inline" />}
                onRowClick={(r) => setSelected(r.customerId)}
                rowKey={(r) => r.customerId}
                rows={d.rows}
              />
              <Pagination busy={loading} onPage={setPage} page={d.pagination.page} pages={d.pagination.totalPages} total={d.pagination.total} />
            </SectionCard>

            <SectionCard description="POS receipts with no linked CUP customer. They count toward revenue and product sales, never toward customers." title="Anonymous POS">
              <StatGrid>
                <StatCard label="Anonymous purchases" value={num(d.anonymousPos.purchases)} />
                <StatCard label="Anonymous units" value={num(d.anonymousPos.units)} />
                <StatCard label="Anonymous revenue" value={formatSom(d.anonymousPos.revenueMinor)} />
                <StatCard label="Share of revenue" value={pctOrDash(d.anonymousPos.sharePercent)} />
              </StatGrid>
            </SectionCard>

            <SectionCard description="Analytics revenue for the same period and branch, split by attribution." title="Reconciliation">
              <KeyValue
                rows={[
                  { key: 'c', label: 'Analytics revenue', value: formatSom(d.reconciliation.canonicalRevenueMinor) },
                  { key: 'i', label: 'Identified customer revenue', value: formatSom(d.reconciliation.customerRevenueMinor) },
                  { key: 'a', label: 'Anonymous POS revenue', value: formatSom(d.reconciliation.anonymousPosRevenueMinor) },
                  { key: 'u', label: 'Unexplained difference', value: formatSom(d.reconciliation.unexplainedMinor) },
                  { key: 'n', label: 'Customers (Analytics / this report)', value: `${num(d.reconciliation.analyticsCustomers)} / ${num(d.reconciliation.reportCustomers)}` },
                ]}
              />
            </SectionCard>
          </>
        )}
      </ReportBody>
    </>
  );
}
