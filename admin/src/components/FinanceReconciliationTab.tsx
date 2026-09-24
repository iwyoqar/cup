import { useEffect, useState } from 'react';
import { fetchFinanceReconciliation } from '../lib/adminFinance';
import { ApiError } from '../lib/api';
import { formatDateTime, formatSom } from '../lib/format';
import { FinanceReconciliation, FinanceReconciliationTransaction } from '../lib/types';
import { Column, DataTable, EmptyState, ErrorState, KeyValue, LoadingState, SectionCard, StatCard, StatGrid, StatusBadge } from '../ui';
import { FinanceRangeValue } from './FinancePeriodPicker';

const number = (n: number) => n.toLocaleString('ru-RU');

const CATEGORY_LABEL: Record<string, string> = {
  IMPORTABLE: 'Not yet imported (ready)',
  ALREADY_IMPORTED: 'Already imported',
  CUP_ORIGINATED: 'CUP-originated',
  POSSIBLE_CUP_ORIGIN: 'Possible CUP order (unresolved)',
  UNRESOLVED: 'Unresolved product',
  UNSUPPORTED_LINE: 'Unsupported line (modifier)',
  UNMAPPED_BRANCH: 'Unmapped branch',
  TOO_RECENT: 'Still settling',
  UNPAID: 'Unpaid',
  REFUND_UNVERIFIED: 'Refund-like (excluded)',
  OTHER: 'Other',
};

const STATUS_TONE: Record<FinanceReconciliation['status'], 'ok' | 'err' | 'warn'> = { RECONCILED: 'ok', MISMATCH: 'err', INCOMPLETE: 'warn' };

interface Props extends FinanceRangeValue {
  branchId?: string;
  ready: boolean;
}

export function FinanceReconciliationTab({ ready, ...filters }: Props) {
  const [data, setData] = useState<FinanceReconciliation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchFinanceReconciliation(filters)
      .then((r) => {
        if (!cancelled) setData(r);
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
  }, [filters.period, filters.startDate, filters.endDate, filters.branchId, ready]);

  if (error) return <ErrorState message={error} title="Reconciliation could not be loaded" />;
  if (!data) return <LoadingState variant="page" />;

  const rows = filter ? data.transactions.filter((t) => t.category === filter) : data.transactions;

  const columns: Column<FinanceReconciliationTransaction>[] = [
    { key: 'id', header: 'Poster #', cell: (t) => t.posterTransactionId },
    { key: 'at', header: 'Occurred', low: true, cell: (t) => (t.occurredAt ? formatDateTime(t.occurredAt) : '—') },
    { key: 'branch', header: 'Branch', low: true, cell: (t) => t.branchName ?? 'Unattributed' },
    { key: 'customer', header: 'Customer', cell: (t) => t.customerName ?? (t.hasPosterClient ? 'Unlinked Poster customer' : 'No customer') },
    { key: 'category', header: 'Category', cell: (t) => CATEGORY_LABEL[t.category] ?? t.category },
    { key: 'amount', header: 'Amount', numeric: true, cell: (t) => formatSom(t.totalMinor) },
  ];

  return (
    <div className="stack" style={{ opacity: loading ? 0.6 : 1 }}>
      <SectionCard
        actions={<StatusBadge dot tone={STATUS_TONE[data.status]}>{data.status}</StatusBadge>}
        description={
          data.status === 'RECONCILED'
            ? "This is a verification layer only — it never changes Overview/P&L's revenue, which comes from the same canonical source shown below."
            : data.status === 'INCOMPLETE'
              ? data.incompleteReason ?? 'The live Poster read could not fully cover this period.'
              : `Live-scanned "already imported" total does not match the stored revenue CUP already recognizes for this period — a genuine discrepancy, not expected.`
        }
        title="Reconciliation status"
      >
        {data.status === 'MISMATCH' && (
          <KeyValue
            rows={[
              { key: 'live', label: 'Live scan — already imported', value: formatSom(data.crossCheck.liveScanAlreadyImportedMinor) },
              { key: 'stored', label: 'Stored — canonical POS revenue', value: formatSom(data.crossCheck.canonicalPosRevenueMinor) },
              { key: 'diff', label: 'Difference', value: formatSom(data.crossCheck.differenceMinor) },
            ]}
          />
        )}
      </SectionCard>

      <StatGrid>
        <StatCard hint={`${data.posterGrossQualifyingSales.count} receipts`} label="Poster gross qualifying sales" strong value={formatSom(data.posterGrossQualifyingSales.amountMinor)} />
        <StatCard hint={`${data.cupOriginatedSales.count} receipts`} label="CUP-originated" value={formatSom(data.cupOriginatedSales.amountMinor)} />
        <StatCard hint={`${data.independentPosSales.total.count} receipts`} label="Independent POS sales" value={formatSom(data.independentPosSales.total.amountMinor)} />
        <StatCard hint="already in CUP's revenue today" label="— already recognized" value={formatSom(data.independentPosSales.alreadyRecognized.amountMinor)} />
        <StatCard hint="real sales, not yet reflected" label="— pending recognition" value={formatSom(data.independentPosSales.pending.amountMinor)} />
        <StatCard hint="CUP orders + POS revenue" label="Total recognized revenue" strong value={formatSom(data.recognizedRevenue.totalMinor)} />
      </StatGrid>

      <div className="grid-2">
        <SectionCard description="Independent POS sales still not reflected in Finance's revenue, by reason." title="Pending recognition, by reason">
          {data.independentPosSales.pending.byReason.length > 0 ? (
            <KeyValue
              rows={data.independentPosSales.pending.byReason.map((c) => ({
                key: c.category,
                label: (
                  <button className="button-secondary button--sm" onClick={() => setFilter(c.category)} type="button">
                    {CATEGORY_LABEL[c.category] ?? c.category} ({c.count})
                  </button>
                ),
                value: formatSom(c.amountMinor),
              }))}
            />
          ) : (
            <EmptyState text="Every real Poster sale in this period is already reflected in Finance's revenue." title="Nothing pending" variant="inline" />
          )}
        </SectionCard>
        <SectionCard description="Independent POS sales only — a CUP-originated sale's customer is the order's own customer, tracked elsewhere." title="Customer attribution">
          <KeyValue
            rows={[
              { key: 'known', label: 'Known customer', value: formatSom(data.customerAttribution.knownCustomer.amountMinor) },
              { key: 'unknown', label: 'Unknown customer', value: formatSom(data.customerAttribution.unknownCustomer.amountMinor) },
              { key: 'noclient', label: '  — no Poster customer at all', value: formatSom(data.customerAttribution.unknownBreakdown.noPosterClient.amountMinor) },
              { key: 'unlinked', label: '  — Poster customer not linked to CUP', value: formatSom(data.customerAttribution.unknownBreakdown.unlinkedPosterClient.amountMinor) },
            ]}
          />
          <p className="hint-text">Unknown customer never means missing or excluded revenue — it is fully counted above.</p>
        </SectionCard>
      </div>

      <div className="grid-2">
        <SectionCard description="Every recognized sale (independent POS and CUP-originated) by whether its Poster spot maps to an active CUP branch." title="Branch attribution">
          <KeyValue
            rows={[
              { key: 'att', label: 'Attributed to a branch', value: formatSom(data.branchAttribution.attributed.amountMinor) },
              { key: 'unatt', label: 'Unattributed branch', value: formatSom(data.branchAttribution.unattributed.amountMinor) },
            ]}
          />
        </SectionCard>
        <SectionCard description="Real receipts excluded by existing, verified business rules — never a new exclusion invented here." title="Excluded transactions">
          {data.excluded.length > 0 ? (
            <KeyValue rows={data.excluded.map((c) => ({ key: c.category, label: `${CATEGORY_LABEL[c.category] ?? c.category} (${c.count})`, value: formatSom(c.amountMinor) }))} />
          ) : (
            <EmptyState text="No receipts were excluded in this period." title="Nothing excluded" variant="inline" />
          )}
        </SectionCard>
      </div>

      <SectionCard
        actions={
          filter && (
            <button className="button-secondary button--sm" onClick={() => setFilter(null)} type="button">
              Clear filter ({CATEGORY_LABEL[filter] ?? filter})
            </button>
          )
        }
        description={`${data.scanned} receipt(s) scanned live from Poster for this period${data.truncated ? ' — window truncated, narrow the period for a complete picture' : ''}.`}
        flush
        title="Transactions"
      >
        <DataTable columns={columns} empty={<EmptyState text="No receipts in this period." title="Nothing here" variant="block" />} rowKey={(t) => t.posterTransactionId} rows={rows} />
      </SectionCard>
    </div>
  );
}
