import { useState } from 'react';
import { formatSom } from '../lib/format';
import { findNav } from '../lib/nav';
import { ReportsEmployeesOverview } from '../lib/reportsTypes';
import { rangeParams, useReport } from '../lib/useReport';
import { Column, DataTable, DateRangePicker, DateRangeValue, EmptyState, FilterBar, isRangeReady, PageHeader, SectionCard, StatCard, StatGrid, StatusBadge } from '../ui';
import { Notes, num, PeriodHint, ReportBody } from './reportsShared';
import { SortSelect, SortState } from './reportsProductShared';

type Row = ReportsEmployeesOverview['employees'][number];
type SortKey = 'revenue' | 'receipts' | 'averageReceipt' | 'employeeName';
const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'revenue', label: 'Revenue' },
  { key: 'receipts', label: 'Receipts' },
  { key: 'averageReceipt', label: 'Avg. receipt' },
  { key: 'employeeName', label: 'Employee name' },
];

const columns: Column<Row>[] = [
  {
    key: 'name',
    header: 'Employee',
    cell: (r) => (
      <span className="table__primary">
        {r.employeeName}
        {r.inEmployeeList === false && ' · Historical / Unknown'}
      </span>
    ),
  },
  { key: 'role', header: 'Poster role', low: true, cell: (r) => r.roleName ?? '—' },
  { key: 'branch', header: 'Branch', low: true, cell: () => 'All branches' },
  { key: 'rev', header: 'Revenue', numeric: true, cell: (r) => formatSom(r.revenueMinor) },
  { key: 'rc', header: 'Receipts', numeric: true, cell: (r) => (r.receipts === null ? '—' : num(r.receipts)) },
  { key: 'avg', header: 'Avg. receipt', numeric: true, cell: (r) => (r.averageReceiptMinor === null ? '—' : formatSom(r.averageReceiptMinor)) },
];

// Employees — Poster's own per-waiter sales (descriptive; no scores, no ranking). A Poster employee is not a CUP staff
// account. Poster offers no location filter for this report, so there is no branch selector.
export function ReportsEmployeesPage() {
  const [range, setRange] = useState<DateRangeValue>({ period: 'last7', startDate: '', endDate: '' });
  const [sort, setSort] = useState<SortState<SortKey>>({ by: 'revenue', direction: 'desc' });
  const ready = isRangeReady(range);
  const { item } = findNav('reports-employees');
  const { data, error, loading, reload } = useReport<ReportsEmployeesOverview>('employees', { ...rangeParams(range), sortBy: sort.by, sortDirection: sort.direction }, ready);

  return (
    <>
      <PageHeader description={item.description} title={item.label} />
      <FilterBar>
        <DateRangePicker onChange={setRange} value={range} />
        <SortSelect onChange={setSort} options={SORT_OPTIONS} value={sort} />
        <PeriodHint loading={loading} period={data?.period} />
        <span style={{ alignSelf: 'center' }}>
          <StatusBadge>Source: Poster POS</StatusBadge>
        </span>
      </FilterBar>

      <ReportBody data={data} error={error} loading={loading} ready={ready} reload={reload} title="Employees could not be loaded">
        {(d) =>
          !d.available || !d.summary ? (
            <SectionCard title="Employee sales">
              <EmptyState action={<button className="button-secondary" onClick={reload} type="button">Try again</button>} text={d.unavailableReason === 'malformed_response' ? 'Poster returned a report CUP could not read reliably, so no figures are shown.' : 'Poster could not be reached. No figures are shown rather than zeros.'} title="Employee report is temporarily unavailable." variant="inline" />
            </SectionCard>
          ) : (
            <>
              <StatGrid>
                <StatCard hint="As attributed by Poster" label="Total revenue" strong value={formatSom(d.summary.totalRevenueMinor ?? 0)} />
                <StatCard hint="Poster closed orders" label="Receipts" value={d.summary.totalReceipts === null ? '—' : num(d.summary.totalReceipts)} />
                <StatCard hint="Revenue ÷ receipts" label="Average receipt" value={d.summary.averageReceiptMinor === null ? '—' : formatSom(d.summary.averageReceiptMinor)} />
                <StatCard label="Employees with sales" value={num(d.summary.employeesWithSales)} />
              </StatGrid>
              <SectionCard description="Sales Poster attributes to each Poster employee in the period. Listed in the chosen order — not a ranking or a performance score." flush title="Employee sales">
                <DataTable columns={columns} empty={<EmptyState text="Poster attributed no sales to any employee in this period." title="No employee sales" variant="inline" />} rowKey={(r) => r.employeeId} rows={d.employees} />
              </SectionCard>
              <Notes notes={d.notes} />
            </>
          )
        }
      </ReportBody>
    </>
  );
}
