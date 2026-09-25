import { useEffect, useState } from 'react';
import { fetchImportHistory, fetchWebhookEvents, ImportHistoryPage } from '../lib/adminPosterImport';
import { errorMessage } from '../lib/errors';
import { formatDateTime, formatSom } from '../lib/format';
import { findNav } from '../lib/nav';
import { Button, Column, DataTable, EmptyState, ErrorState, LoadingState, PageHeader, Pagination, SectionCard, StatusBadge, Tabs } from '../ui';
import { WebhookEventsPage } from '../lib/adminPosterImport';

type Tab = 'imports' | 'webhooks';
type ImportRow = ImportHistoryPage['items'][number];
type WebhookRow = WebhookEventsPage['items'][number];

const OUTCOME: Record<string, string> = {
  IMPORTED: 'Imported into CUP',
  ALREADY_IMPORTED: 'Already imported',
  CUP_ORIGINATED: 'CUP-created (skipped)',
  TOO_RECENT: 'Waiting to settle',
  NOT_CLOSED: 'Not closed yet',
  NOT_FOUND: 'Not found in Poster',
  REMOVED: 'Removed in Poster',
  REMOVED_IMPORTED: 'Removed in Poster but imported — review',
};

// The audit trail the API actually keeps: every Poster receipt that was imported (or held) and every webhook Poster sent. Each row says what happened, to what, when,
// and which part of the system did it. Admin actions (settings changes, campaign sends, manual imports by a named admin) and staff scans are not exposed to the Admin
// by the API yet, so they are not listed — the notice below says so instead of implying they do not happen.
export function AuditPage() {
  const [tab, setTab] = useState<Tab>('imports');
  const [page, setPage] = useState(1);
  const [imports, setImports] = useState<ImportHistoryPage | null>(null);
  const [hooks, setHooks] = useState<WebhookEventsPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const { item } = findNav('audit');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const req = tab === 'imports' ? fetchImportHistory({ page, pageSize: 20 }).then((r) => !cancelled && setImports(r)) : fetchWebhookEvents(page, '').then((r) => !cancelled && setHooks(r));
    req.catch((err) => !cancelled && setError(errorMessage(err, 'Could not load the audit trail.'))).finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [tab, page, tick]);

  const importCols: Column<ImportRow>[] = [
    { key: 'when', header: 'When', cell: (r) => formatDateTime(r.importedAt) },
    { key: 'action', header: 'Action', cell: (r) => <span className="font-semibold text-black">{r.status === 'IMPORTED' ? 'Receipt imported' : 'Receipt held'}</span> },
    { key: 'target', header: 'Target', cell: (r) => <>Poster #{r.posterTransactionId}<span className="mt-0.5 block text-xs font-normal text-muted">{r.branchName} · {r.customerName ?? 'no customer'}</span></> },
    { key: 'amount', header: 'Paid', numeric: true, low: true, cell: (r) => formatSom(r.paidMinor) },
    { key: 'source', header: 'Source', low: true, cell: (r) => r.source },
    { key: 'result', header: 'Result', cell: (r) => (r.status === 'IMPORTED' ? <StatusBadge tone="ok">Imported</StatusBadge> : <><StatusBadge tone="warn">Unresolved</StatusBadge>{r.unresolvedReason && <span className="mt-0.5 block text-xs font-normal text-muted">{r.unresolvedReason}</span>}</>) },
  ];

  const hookCols: Column<WebhookRow>[] = [
    { key: 'when', header: 'When', cell: (r) => formatDateTime(r.receivedAt) },
    { key: 'action', header: 'Action', cell: (r) => <span className="font-semibold text-black">Webhook: {r.action}</span> },
    { key: 'target', header: 'Target', cell: (r) => `Poster #${r.transactionId}` },
    { key: 'source', header: 'Source', low: true, cell: () => 'Poster (webhook)' },
    { key: 'result', header: 'Result', cell: (r) => <>{r.outcome ? OUTCOME[r.outcome] ?? r.outcome : r.status === 'DEAD' ? 'Failed' : 'Pending'}{r.lastError && <span className="mt-0.5 block text-xs font-normal text-muted">{r.lastError}</span>}</> },
    { key: 'status', header: 'Status', low: true, cell: (r) => (r.status === 'DONE' ? <StatusBadge tone="ok">Done</StatusBadge> : r.status === 'DEAD' ? <StatusBadge tone="err">Dead</StatusBadge> : <StatusBadge>{r.status === 'QUEUED' ? 'Waiting' : 'Processing'}</StatusBadge>) },
  ];

  const total = tab === 'imports' ? imports : hooks;

  return (
    <>
      <PageHeader
        actions={
          <Button disabled={loading} onClick={() => setTick((t) => t + 1)} variant="secondary">
            {loading ? 'Loading…' : 'Refresh'}
          </Button>
        }
        description={item.description}
        title={item.label}
      />

      <Tabs
        active={tab}
        label="Audit source"
        onChange={(t) => {
          setTab(t);
          setPage(1);
        }}
        tabs={[
          { id: 'imports', label: 'POS imports' },
          { id: 'webhooks', label: 'Poster webhooks' },
        ]}
      />

      <div className="block space-y-1 rounded-md border-l-[3px] px-4 py-3 text-sm leading-relaxed [&_p]:m-0 border-muted-cream bg-neutral-bg text-muted-cream">Admin actions and staff scans are not exposed to the Admin by the API yet, so they are not part of this trail.</div>

      {error && <ErrorState message={error} onRetry={() => setTick((t) => t + 1)} title="The audit trail could not be loaded" />}

      <SectionCard
        description={tab === 'imports' ? 'Each Poster receipt CUP imported or held, newest first.' : 'Each webhook Poster sent, and what CUP did with it, newest first.'}
        flush
        footer={total && total.pages > 1 ? <Pagination busy={loading} onPage={setPage} page={total.page} pages={total.pages} total={total.total} /> : undefined}
        title={tab === 'imports' ? 'POS imports' : 'Poster webhooks'}
      >
        {!total && !error ? (
          <LoadingState variant="table" />
        ) : tab === 'imports' && imports ? (
          <DataTable columns={importCols} empty={<EmptyState text="No receipt has been imported yet." title="Nothing recorded" variant="inline" />} rowKey={(r) => r.posterTransactionId} rows={imports.items} />
        ) : hooks ? (
          <DataTable columns={hookCols} empty={<EmptyState text="No webhook has been received yet." title="Nothing recorded" variant="inline" />} rowKey={(r) => r.id} rows={hooks.items} />
        ) : null}
      </SectionCard>
    </>
  );
}
