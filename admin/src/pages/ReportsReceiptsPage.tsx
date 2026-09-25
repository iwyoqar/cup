import { useEffect, useState } from 'react';
import { formatDateTime, formatSom } from '../lib/format';
import { findNav } from '../lib/nav';
import { ReportsReceiptDetail, ReportsReceiptRow, ReportsReceiptsOverview } from '../lib/reportsTypes';
import { ReportsSource } from '../lib/types';
import { apiRequest, ApiError } from '../lib/api';
import { rangeParams, useReport } from '../lib/useReport';
import { Button, Column, DataTable, DateRangePicker, DateRangeValue, EmptyState, FilterBar, FilterField, isRangeReady, KeyValue, Modal, PageHeader, SearchInput, SectionCard, StatCard, StatGrid } from '../ui';
import { BranchSelect, Notes, num, PeriodHint, ReportBody } from './reportsShared';
import { SourceSelect } from './reportsProductShared';

type Status = 'all' | 'paid' | 'unpaid';
const LIMIT = 50;

const columns: Column<ReportsReceiptRow>[] = [
  { key: 'd', header: 'Date', cell: (r) => formatDateTime(r.occurredAt) },
  { key: 'id', header: 'Receipt', cell: (r) => <span className="font-semibold text-black">{r.source === 'POS' ? `#${r.receiptId}` : `…${r.receiptId.slice(-8)}`}</span> },
  { key: 's', header: 'Source', cell: (r) => r.source },
  { key: 'c', header: 'Customer', cell: (r) => r.customerName ?? (r.customerId ? '—' : 'Anonymous') },
  { key: 'b', header: 'Branch', low: true, cell: (r) => r.branchName ?? 'Unattributed' },
  { key: 'i', header: 'Items', numeric: true, low: true, cell: (r) => num(r.items) },
  { key: 't', header: 'Total', numeric: true, cell: (r) => formatSom(r.totalMinor) },
  { key: 'p', header: 'Paid', numeric: true, low: true, cell: (r) => (r.paidMinor === null ? '—' : formatSom(r.paidMinor)) },
  { key: 'st', header: 'Status', low: true, cell: (r) => r.status },
  { key: 'pm', header: 'Payment', low: true, cell: (r) => r.paymentMethod ?? '—' },
];

// Receipts — individual qualifying receipts (CUP orders + imported POS receipts), read-only. Server-side filters, search
// and cursor pagination (never an unbounded history in the browser). Payment data exists only for POS receipts.
export function ReportsReceiptsPage() {
  const [range, setRange] = useState<DateRangeValue>({ period: 'last7', startDate: '', endDate: '' });
  const [branchId, setBranchId] = useState('');
  const [source, setSource] = useState<ReportsSource>('all');
  const [status, setStatus] = useState<Status>('all');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [cursors, setCursors] = useState<string[]>([]); // stack of cursors for the pages already visited
  const [selected, setSelected] = useState<ReportsReceiptRow | null>(null);
  const ready = isRangeReady(range);
  const { item } = findNav('reports-receipts');

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);
  useEffect(() => setCursors([]), [range, branchId, source, status, search]);

  const cursor = cursors[cursors.length - 1];
  const { data, error, loading, reload } = useReport<ReportsReceiptsOverview>('receipts', { ...rangeParams(range), branchId, source, status, search, cursor, limit: LIMIT }, ready);
  const pageNo = cursors.length + 1;

  return (
    <>
      <PageHeader description={item.description} title={item.label} />
      <FilterBar>
        <DateRangePicker onChange={setRange} value={range} />
        <BranchSelect branches={data?.filters.branches ?? []} onChange={setBranchId} value={branchId} />
        <SourceSelect onChange={setSource} value={source} />
        <FilterField label="Payment">
          <select className="" onChange={(e) => setStatus(e.target.value as Status)} value={status}>
            <option value="all">All receipts</option>
            <option value="paid">Paid (POS)</option>
            <option value="unpaid">Closed without payment (POS)</option>
          </select>
        </FilterField>
        <SearchInput label="Search receipts" onChange={setSearchInput} placeholder="Receipt, customer or phone" value={searchInput} />
        <PeriodHint loading={loading} period={data?.period} />
      </FilterBar>

      <ReportBody data={data} error={error} loading={loading} ready={ready} reload={reload} title="Receipts could not be loaded">
        {(d) => (
          <>
            <StatGrid>
              <StatCard hint={`${num(d.summary.cupReceipts)} CUP · ${num(d.summary.posReceipts)} POS`} label="Receipts" strong value={num(d.summary.receipts)} />
              <StatCard label="Revenue" value={formatSom(d.summary.revenueMinor)} />
              <StatCard hint="POS receipts only" label="Paid" value={formatSom(d.summary.paidMinor)} />
              <StatCard hint="POS closed without payment" label="Unpaid" value={num(d.summary.unpaidReceipts)} />
              <StatCard label="Identified customers" value={num(d.summary.identifiedCustomers)} />
              <StatCard hint="Not counted as customers" label="Anonymous POS receipts" value={num(d.summary.anonymousPosReceipts)} />
            </StatGrid>

            <SectionCard description="Newest first. Click a receipt for its line items (read-only)." flush title="Receipts">
              <DataTable columns={columns} empty={<EmptyState text={search ? 'No receipt matches this search.' : 'No receipts were recorded for these filters.'} title="No receipts" variant="inline" />} onRowClick={setSelected} rowKey={(r) => `${r.source}:${r.receiptId}`} rows={d.rows} />
              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-4 py-3 text-[13px] text-muted">
                <span className="mr-auto">{num(d.page.total)} total · page {pageNo} of {Math.max(1, Math.ceil(d.page.total / LIMIT))}</span>
                <Button disabled={loading || cursors.length === 0} onClick={() => setCursors((c) => c.slice(0, -1))} size="sm" variant="secondary">
                  Previous
                </Button>
                <Button disabled={loading || !d.page.nextCursor} onClick={() => d.page.nextCursor && setCursors((c) => [...c, d.page.nextCursor as string])} size="sm" variant="secondary">
                  Next
                </Button>
              </div>
            </SectionCard>

            <SectionCard description="Receipt totals against Analytics revenue for the same period, branch and source." title="Reconciliation">
              <KeyValue
                rows={[
                  { key: 'a', label: 'Analytics revenue', value: formatSom(d.reconciliation.analyticsRevenueMinor) },
                  { key: 'r', label: 'Receipts total', value: formatSom(d.reconciliation.receiptsRevenueMinor) },
                  { key: 'c', label: 'Comparable', value: d.reconciliation.comparable ? 'Yes' : 'No — a search, customer or payment filter narrows the receipts' },
                ]}
              />
            </SectionCard>
            <Notes notes={d.notes} />
          </>
        )}
      </ReportBody>

      {selected && <ReceiptDetail onClose={() => setSelected(null)} row={selected} />}
    </>
  );
}

function ReceiptDetail({ row, onClose }: { row: ReportsReceiptRow; onClose: () => void }) {
  const [detail, setDetail] = useState<ReportsReceiptDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    apiRequest<ReportsReceiptDetail>(`/admin/reports/receipts/${row.source}/${encodeURIComponent(row.receiptId)}`, { signal: controller.signal })
      .then(setDetail)
      .catch((err) => {
        if (!controller.signal.aborted) setError(err instanceof ApiError && err.status === 404 ? 'Receipt not found.' : "Receipt details couldn't be loaded.");
      });
    return () => controller.abort();
  }, [row.source, row.receiptId]);

  return (
    <Modal onClose={onClose} title={row.source === 'POS' ? `Receipt #${row.receiptId}` : 'CUP order'} wide>
      <KeyValue
        rows={[
          { key: 'src', label: 'Source', value: row.source },
          { key: 'cup', label: 'CUP order ID', value: row.cupOrderId ?? '—' },
          { key: 'ptx', label: 'Poster transaction ID', value: row.posterTransactionId ?? '—' },
          { key: 'd', label: 'Date/time', value: formatDateTime(row.occurredAt) },
          { key: 'c', label: 'Customer', value: row.customerName ?? (row.customerId ? '—' : 'Anonymous') },
          { key: 'b', label: 'Branch', value: row.branchName ?? 'Unattributed' },
          { key: 's', label: 'Status', value: row.status },
          { key: 'p', label: 'Payment', value: row.paymentMethod ?? '—' },
          { key: 't', label: 'Total', value: formatSom(row.totalMinor) },
          { key: 'pd', label: 'Paid', value: row.paidMinor === null ? '—' : formatSom(row.paidMinor) },
        ]}
      />
      <h3 className="mt-4 mb-2 mx-0">Line items</h3>
      {error && <p className="text-[13px] font-semibold text-err">{error}</p>}
      {!detail && !error && <p className="text-[13px] leading-snug text-muted">Loading…</p>}
      {detail && (
        <DataTable
          columns={[
            { key: 'p', header: 'Product', cell: (l) => <span className="font-semibold text-black">{l.product}{l.isRewardItem ? ' (free reward)' : ''}</span> },
            { key: 'q', header: 'Quantity', numeric: true, cell: (l) => num(l.quantity) },
            { key: 'u', header: 'Unit price', numeric: true, cell: (l) => formatSom(l.unitPriceMinor) },
            { key: 't', header: 'Total', numeric: true, cell: (l) => formatSom(l.totalMinor) },
          ]}
          empty={<EmptyState text="This receipt has no line items stored." title="No lines" variant="inline" />}
          rowKey={(l) => `${l.posterProductId}-${l.product}-${l.quantity}-${l.totalMinor}`}
          rows={detail.lines}
        />
      )}
    </Modal>
  );
}
