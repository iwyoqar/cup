import { useState } from 'react';
import { formatSom } from '../lib/format';
import { findNav } from '../lib/nav';
import { useReportsPayments } from '../lib/useReportsPayments';
import { ReportsPaymentRow, ReportsPaymentsOverview } from '../lib/types';
import {
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
  StatusBadge,
} from '../ui';

const share = (p: number) => `${p.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

const columns: Column<ReportsPaymentRow>[] = [
  { key: 'name', header: 'Method', cell: (p) => <span className="table__primary">{p.name}</span> },
  { key: 'amount', header: 'Amount', numeric: true, cell: (p) => formatSom(p.amountMinor) },
  { key: 'share', header: 'Share', numeric: true, cell: (p) => share(p.sharePercent) },
];

// Payments — "How were sales paid?". Every amount is Poster's own payment report, normalized by the backend; this
// page is observational and never feeds a revenue figure. CUP revenue appears only as a labelled comparison. When
// Poster can't be read, the page says so instead of showing zeros.
export function ReportsPaymentsPage() {
  const [range, setRange] = useState<DateRangeValue>({ period: 'last7', startDate: '', endDate: '' });
  const [branchId, setBranchId] = useState('');
  const ready = isRangeReady(range);
  const { data, error, loading, reload } = useReportsPayments({ ...range, branchId: branchId || undefined }, ready);
  const { item } = findNav('reports-payments');
  const branches = data?.filters.branches ?? [];

  return (
    <>
      <PageHeader description={item.description} title={item.label} />

      <FilterBar>
        <DateRangePicker onChange={setRange} value={range} />
        {(data?.branchFilterSupported ?? true) && (
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
        )}
        {data && !error && (
          <span className="hint-text" style={{ alignSelf: 'center' }}>
            {data.period.startDate === data.period.endDate ? data.period.startDate : `${data.period.startDate} → ${data.period.endDate}`}
            {loading && ' · updating…'}
          </span>
        )}
        <span style={{ alignSelf: 'center' }}>
          <StatusBadge>Source: Poster POS</StatusBadge>
        </span>
      </FilterBar>

      {error && <ErrorState message={error} onRetry={reload} title="Payments could not be loaded" />}
      {!data && !error && ready && <LoadingState variant="page" />}

      {data && !error && (
        <div className="stack" style={{ opacity: loading ? 0.6 : 1, transition: 'opacity var(--motion-base) var(--ease)' }}>
          {data.available ? <PaymentsReport data={data} /> : <Unavailable data={data} onRetry={reload} />}
        </div>
      )}
    </>
  );
}

function Unavailable({ data, onRetry }: { data: ReportsPaymentsOverview; onRetry: () => void }) {
  const text =
    data.unavailableReason === 'malformed_response'
      ? "Poster returned a payment report CUP could not read reliably, so no figures are shown."
      : 'Poster could not be reached for this period. No figures are shown rather than showing zeros.';
  return (
    <SectionCard title="Payment summary">
      <EmptyState
        action={
          <button className="button-secondary" onClick={onRetry} type="button">
            Try again
          </button>
        }
        text={text}
        title="Payment report is temporarily unavailable."
        variant="inline"
      />
    </SectionCard>
  );
}

function PaymentsReport({ data }: { data: ReportsPaymentsOverview }) {
  const total = data.totalPaymentsMinor ?? 0;
  const methodsDiffer = data.methodsTotalMinor !== null && data.methodsTotalMinor !== data.totalPaymentsMinor;

  return (
    <>
      <SectionCard description={data.branch ? `Poster's payment report for ${data.branch.name}.` : "Poster's payment report for all locations combined."} title="Payment summary">
        <StatGrid>
          <StatCard hint="As reported by Poster" label="Poster payment total" strong value={formatSom(total)} />
          <StatCard label="Payment methods used" value={data.payments.length.toLocaleString('ru-RU')} />
          {methodsDiffer && <StatCard hint="Sum of the methods listed below" label="Methods total" value={formatSom(data.methodsTotalMinor ?? 0)} />}
          <StatCard hint="Canonical CUP + POS revenue — comparison only" label="CUP revenue" value={formatSom(data.cupRevenueMinor)} />
        </StatGrid>
      </SectionCard>

      {data.warnings.length > 0 && (
        <div className="callout">
          {data.warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
        </div>
      )}

      {data.payments.length === 0 ? (
        <SectionCard title="Payment methods">
          <EmptyState text="Poster recorded no payments in this period." title="No payments" variant="inline" />
        </SectionCard>
      ) : (
        <div className="grid-2">
          <SectionCard description="Amount and share of each method Poster reported. Methods with no payments are omitted." flush title="Payment methods">
            <DataTable columns={columns} rowKey={(p) => p.paymentId} rows={data.payments} />
          </SectionCard>
          <ChartContainer description="Share of the listed methods' combined amount." title="Distribution">
            <HBarList items={data.payments.map((p) => ({ name: p.name, value: p.amountMinor, valueLabel: share(p.sharePercent), hint: formatSom(p.amountMinor) }))} />
          </ChartContainer>
        </div>
      )}
    </>
  );
}
