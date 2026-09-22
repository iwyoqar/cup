import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchImportHistory, fetchSyncStatus, fetchWebhookEvents } from '../lib/adminPosterImport';
import { errorMessage } from '../lib/errors';
import { formatAgo, formatDateTime } from '../lib/format';
import { AdminPage, findNav } from '../lib/nav';
import { Column, DataTable, EmptyState, ErrorState, FilterBar, FilterField, LoadingState, PageHeader, SectionCard, StatCard, StatGrid, StatusBadge } from '../ui';

type Severity = 'error' | 'warning';

interface ErrorRow {
  id: string;
  at: string | null;
  category: string;
  source: string;
  severity: Severity;
  message: string;
  status: 'Open' | 'Resolved';
}

// Everything the API currently reports as needing attention, in one list. It is assembled ONLY from existing data: sync alerts and the last recovery error
// (sync-status), webhook events that ran out of retries (webhook-events, DEAD), receipts removed in Poster but already imported, and receipts the import could
// not attribute (import-history, UNRESOLVED). Severity is derived from the kind of item — a dead event or an unresolved recovery error is an "error"; alerts and
// review items are "warnings" — never guessed from text.
export function ErrorsPage({ onNavigate }: { onNavigate: (page: AdminPage) => void }) {
  const [rows, setRows] = useState<ErrorRow[] | null>(null);
  const [failedSources, setFailedSources] = useState<string[]>([]);
  const [moreDead, setMoreDead] = useState(0);
  const [severity, setSeverity] = useState<'' | Severity>('');
  const [loading, setLoading] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const { item } = findNav('errors');

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setFatal(null);
    Promise.allSettled([fetchSyncStatus(), fetchWebhookEvents(1, 'DEAD'), fetchImportHistory({ page: 1, pageSize: 20, status: 'UNRESOLVED' })])
      .then(([sync, dead, unresolved]) => {
        if (cancelled) return;
        const out: ErrorRow[] = [];
        const failed: string[] = [];
        if (sync.status === 'fulfilled') {
          const s = sync.value;
          s.alerts.forEach((a, i) => out.push({ id: `alert-${i}`, at: s.generatedAt, category: 'Sync alert', source: 'Continuous sync', severity: 'warning', message: a, status: 'Open' }));
          if (s.reconciliation.lastError) {
            const e = s.reconciliation.lastError;
            out.push({ id: 'recon', at: e.at, category: 'Recovery check', source: 'Continuous sync', severity: e.resolved ? 'warning' : 'error', message: e.message, status: e.resolved ? 'Resolved' : 'Open' });
          }
          s.removedButImported.forEach((tx) => out.push({ id: `removed-${tx}`, at: null, category: 'Needs review', source: 'Poster', severity: 'warning', message: `Receipt #${tx} was removed in Poster but had already been imported into CUP. Review it.`, status: 'Open' }));
        } else failed.push('Sync status');
        if (dead.status === 'fulfilled') {
          setMoreDead(Math.max(0, dead.value.total - dead.value.items.length));
          dead.value.items.forEach((e) =>
            out.push({ id: `dead-${e.id}`, at: e.receivedAt, category: 'Webhook event', source: 'Poster webhook', severity: 'error', message: `Receipt #${e.transactionId} (${e.action}) failed after ${e.attempts} attempt${e.attempts === 1 ? '' : 's'}${e.lastError ? `: ${e.lastError}` : '.'}`, status: 'Open' }),
          );
        } else failed.push('Webhook events');
        if (unresolved.status === 'fulfilled') {
          unresolved.value.items.forEach((r) =>
            out.push({ id: `imp-${r.posterTransactionId}`, at: r.occurredAt, category: 'Import', source: 'POS import', severity: 'warning', message: `Receipt #${r.posterTransactionId} could not be attributed to a customer${r.unresolvedReason ? `: ${r.unresolvedReason}` : '.'}`, status: 'Open' }),
          );
        } else failed.push('Import history');
        if (failed.length === 3) setFatal(errorMessage((sync as PromiseRejectedResult).reason, 'Could not load anything.'));
        setFailedSources(failed);
        out.sort((a, b) => (a.severity === b.severity ? (b.at ?? '').localeCompare(a.at ?? '') : a.severity === 'error' ? -1 : 1));
        setRows(out);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => load(), [load]);

  const visible = useMemo(() => (rows ?? []).filter((r) => (severity ? r.severity === severity : true)), [rows, severity]);
  const open = (rows ?? []).filter((r) => r.status === 'Open');

  const columns: Column<ErrorRow>[] = [
    { key: 'sev', header: 'Severity', cell: (r) => <StatusBadge dot tone={r.severity === 'error' ? 'err' : 'warn'}>{r.severity === 'error' ? 'Error' : 'Warning'}</StatusBadge> },
    { key: 'msg', header: 'What happened', cell: (r) => <span className="table__primary">{r.message}</span> },
    { key: 'cat', header: 'Category', low: true, cell: (r) => r.category },
    { key: 'src', header: 'Source', low: true, cell: (r) => r.source },
    { key: 'at', header: 'When', low: true, cell: (r) => (r.at ? <>{formatDateTime(r.at)}<span className="table__sub">{formatAgo(r.at)}</span></> : '—') },
    { key: 'status', header: 'Status', cell: (r) => <StatusBadge tone={r.status === 'Open' ? 'info' : 'ok'}>{r.status}</StatusBadge> },
  ];

  return (
    <>
      <PageHeader
        actions={
          <>
            <button className="button-secondary" onClick={() => onNavigate('continuous-sync')} type="button">
              Open Continuous Sync
            </button>
            <button className="button-secondary" disabled={loading} onClick={load} type="button">
              {loading ? 'Loading…' : 'Refresh'}
            </button>
          </>
        }
        description={item.description}
        title={item.label}
      />

      {fatal && <ErrorState message={fatal} onRetry={load} title="Errors could not be loaded" />}
      {!rows && !fatal && <LoadingState variant="page" />}

      {rows && !fatal && (
        <>
          <StatGrid>
            <StatCard hint="need attention now" label="Open" strong={open.length > 0} value={String(open.length)} />
            <StatCard label="Errors" value={String(rows.filter((r) => r.severity === 'error' && r.status === 'Open').length)} />
            <StatCard label="Warnings" value={String(rows.filter((r) => r.severity === 'warning' && r.status === 'Open').length)} />
            <StatCard hint="fixed since they happened" label="Resolved" value={String(rows.filter((r) => r.status === 'Resolved').length)} />
          </StatGrid>

          {moreDead > 0 && (
            <div className="callout callout--warn">
              {moreDead} more dead webhook event{moreDead === 1 ? '' : 's'} are not listed here — open Continuous Sync to see and retry all of them.
            </div>
          )}
          {failedSources.length > 0 && <div className="callout callout--warn">Could not read: {failedSources.join(', ')}. The list below may be incomplete.</div>}

          <SectionCard
            actions={
              <FilterBar>
                <FilterField label="Severity">
                  <select className="select" onChange={(e) => setSeverity(e.target.value as '' | Severity)} value={severity}>
                    <option value="">All</option>
                    <option value="error">Errors</option>
                    <option value="warning">Warnings</option>
                  </select>
                </FilterField>
              </FilterBar>
            }
            description="Errors first, then warnings; newest first."
            flush
            title="Needs attention"
          >
            <DataTable
              columns={columns}
              empty={<EmptyState text={rows.length === 0 ? 'The sync is healthy, no webhook event is stuck and every imported receipt is attributed.' : 'No items match this filter.'} title={rows.length === 0 ? 'Nothing needs attention' : 'Nothing to show'} variant="inline" />}
              rowKey={(r) => r.id}
              rows={visible}
            />
          </SectionCard>
        </>
      )}
    </>
  );
}
