import { useEffect, useMemo, useState } from 'react';
import { fetchSyncStatus, fetchWebhookEvents, retryWebhookEvent, SyncStatus, WebhookEventsPage } from '../lib/adminPosterImport';
import { errorMessage } from '../lib/errors';
import { formatAgo, formatDateTime, formatDuration } from '../lib/format';
import { deriveHealth } from '../lib/health';
import { findNav } from '../lib/nav';
import { Column, DataTable, EmptyState, ErrorState, FilterBar, FilterField, KeyValue, LoadingState, PageHeader, Pagination, SectionCard, StatCard, StatGrid, StatusBadge } from '../ui';
import { HealthList } from '../ui/HealthList';

const number = (n: number) => n.toLocaleString('ru-RU');

const OUTCOME_LABELS: Record<string, string> = {
  IMPORTED: 'Imported',
  ALREADY_IMPORTED: 'Already imported',
  CUP_ORIGINATED: 'CUP-created (skipped)',
  TOO_RECENT: 'Waiting to settle',
  NOT_CLOSED: 'Not closed yet',
  NOT_FOUND: 'Not found in Poster',
  REMOVED: 'Removed in Poster',
  REMOVED_IMPORTED: 'Removed in Poster but imported — review',
};
const outcomeLabel = (o: string | null) => (o ? OUTCOME_LABELS[o] ?? o.replace(':', ' · ') : '—');
const when = (iso: string | null) => (iso ? `${formatDateTime(iso)} · ${formatAgo(iso)}` : 'never');

type EventRow = WebhookEventsPage['items'][number];

function statusBadge(status: EventRow['status']) {
  return status === 'DONE' ? <StatusBadge tone="ok">Done</StatusBadge> : status === 'DEAD' ? <StatusBadge tone="err">Dead</StatusBadge> : status === 'QUEUED' ? <StatusBadge>Waiting</StatusBadge> : <StatusBadge tone="info">Processing</StatusBadge>;
}

// Continuous sync as a system-health panel (Phase 20's data, unchanged): what is switched on, whether webhooks and the queue are flowing, how far the recovery
// checkpoint lags. The only action is re-queuing an event that ran out of retries — this page never imports anything itself.
export function ContinuousSyncPage() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [events, setEvents] = useState<WebhookEventsPage | null>(null);
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const { item } = findNav('continuous-sync');

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setError(null);
    Promise.all([fetchSyncStatus(), fetchWebhookEvents(page, filter)])
      .then(([s, e]) => {
        if (cancelled) return;
        setStatus(s);
        setEvents(e);
      })
      .catch((err) => !cancelled && setError(errorMessage(err, 'Could not load the sync status.')))
      .finally(() => !cancelled && setBusy(false));
    return () => {
      cancelled = true;
    };
  }, [page, filter, tick]);

  const retry = async (id: string) => {
    try {
      await retryWebhookEvent(id);
      setTick((t) => t + 1);
    } catch (err) {
      setError(errorMessage(err, 'Could not retry this event.'));
    }
  };

  const health = useMemo(() => (status ? deriveHealth({ loading: false, backendOk: true, sync: status, syncError: null, checkedAt: new Date() }).filter((i) => ['poster', 'webhooks', 'sync'].includes(i.id)) : []), [status]);
  const base = ((import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '').replace(/\/+$/, '');

  const columns: Column<EventRow>[] = [
    { key: 'tx', header: 'Poster #', cell: (e) => <span className="table__primary">#{e.transactionId}</span> },
    { key: 'action', header: 'Action', low: true, cell: (e) => e.action },
    { key: 'received', header: 'Received', cell: (e) => formatDateTime(e.receivedAt) },
    {
      key: 'status',
      header: 'Status',
      cell: (e) => (
        <>
          {statusBadge(e.status)}
          {e.status === 'QUEUED' && e.attempts > 0 && <span className="table__sub">retry {formatDateTime(e.nextAttemptAt)}</span>}
        </>
      ),
    },
    {
      key: 'result',
      header: 'Result',
      low: true,
      cell: (e) => (
        <>
          {outcomeLabel(e.outcome)}
          {e.lastError && <span className="table__sub">{e.lastError}</span>}
        </>
      ),
    },
    { key: 'deliveries', header: 'Deliveries', numeric: true, low: true, cell: (e) => number(e.deliveries) },
    { key: 'attempts', header: 'Attempts', numeric: true, low: true, cell: (e) => number(e.attempts) },
    {
      key: 'act',
      header: '',
      actions: true,
      cell: (e) =>
        e.status === 'DEAD' ? (
          <button className="button-secondary button--sm" onClick={() => retry(e.id)} type="button">
            Retry
          </button>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        actions={
          <>
            {status && <StatusBadge dot tone={status.config.syncEnabled ? 'ok' : 'warn'}>{status.config.syncEnabled ? 'Automatic import ON' : 'Automatic import OFF'}</StatusBadge>}
            <button className="button-secondary" disabled={busy} onClick={() => setTick((t) => t + 1)} type="button">
              {busy ? 'Loading…' : 'Refresh'}
            </button>
          </>
        }
        description={item.description}
        title={item.label}
      />

      {error && <ErrorState message={error} onRetry={() => setTick((t) => t + 1)} title="The sync status could not be loaded" />}
      {!status && !error && <LoadingState variant="page" />}

      {status && (
        <>
          {status.alerts.length > 0 ? (
            <div className="callout callout--warn" role="status">
              <strong>Needs attention</strong>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {status.alerts.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="callout callout--ok">Everything is healthy: no alerts.</div>
          )}

          <StatGrid>
            <StatCard hint={status.queue.oldestQueuedAgeSeconds !== null ? `oldest ${formatDuration(status.queue.oldestQueuedAgeSeconds)}` : 'nothing waiting'} label="Waiting" value={number(status.queue.queued)} />
            <StatCard label="Processing" value={number(status.queue.processing)} />
            <StatCard label="Done" value={number(status.queue.done)} />
            <StatCard hint={status.queue.dead > 0 ? 'need a manual retry' : 'none'} label="Dead" strong={status.queue.dead > 0} value={number(status.queue.dead)} />
          </StatGrid>

          <div className="grid-main">
            <SectionCard description="A calm row means it is working; a tinted row needs a look." title="Health">
              <HealthList items={health} />
            </SectionCard>
            <SectionCard description="How the automatic import is set up." title="Setup">
              <KeyValue
                rows={[
                  { key: 'auto', label: 'Automatic import', value: status.config.syncEnabled ? 'ON' : 'OFF' },
                  { key: 'secret', label: 'Application secret', value: status.config.applicationSecretConfigured ? 'configured' : 'NOT SET' },
                  { key: 'settle', label: 'A sale appears after', value: `${Math.round(status.config.settleSeconds / 60)} min` },
                  { key: 'recover', label: 'Recovery check', value: `every ${status.config.reconcileMinutes} min` },
                  { key: 'overlap', label: 'Safety overlap', value: `${status.config.reconcileOverlapMinutes} min` },
                ]}
              />
              <div className="hint-text">
                Webhook URL for Poster
                <br />
                <code style={{ overflowWrap: 'anywhere' }}>{base + status.config.webhookPath}</code>
              </div>
            </SectionCard>
          </div>

          <div className="grid-2">
            <SectionCard description="Webhooks and the background processor." title="Activity">
              <KeyValue
                rows={[
                  { key: 'lastwh', label: 'Last webhook received', value: when(status.webhooks.lastReceivedAt) },
                  { key: 'lastproc', label: 'Last processed', value: when(status.processing.lastProcessedAt) },
                  { key: 'r24', label: 'Webhooks received (24 h)', value: number(status.webhooks.received24h) },
                  { key: 'dup', label: 'Duplicate deliveries (24 h)', value: number(status.webhooks.duplicateDeliveries24h) },
                  ...status.processing.outcomes24h.map((o) => ({ key: 'o-' + o.outcome, label: outcomeLabel(o.outcome), value: number(o.count) })),
                ]}
              />
            </SectionCard>
            <SectionCard description="Missed webhooks are recovered from here." title="Recovery checkpoint">
              <KeyValue
                rows={[
                  { key: 'cp', label: 'Checkpoint (everything before it is done)', value: status.reconciliation.checkpoint ? formatDateTime(status.reconciliation.checkpoint) : 'not set yet' },
                  { key: 'lag', label: 'Lag', value: `${formatDuration(status.reconciliation.lagSeconds)}${status.reconciliation.last ? (status.reconciliation.last.caughtUp ? ' · caught up' : ' · catching up') : ''}` },
                  { key: 'ok', label: 'Last successful check', value: when(status.reconciliation.lastSuccessAt) },
                  { key: 'last', label: 'Last check', value: status.reconciliation.last ? `${formatAgo(status.reconciliation.last.at)} · ${status.reconciliation.last.ok ? 'ok' : 'FAILED'}` : 'never' },
                  { key: 'imp', label: 'Imported by the last check', value: number(status.reconciliation.last?.imported ?? 0) },
                ]}
              />
              {status.reconciliation.lastError && (
                <div className={`callout${status.reconciliation.lastError.resolved ? '' : ' callout--err'}`}>
                  Last error ({formatDateTime(status.reconciliation.lastError.at)}
                  {status.reconciliation.lastError.resolved ? ', since resolved' : ', checkpoint NOT advanced'}): {status.reconciliation.lastError.message}
                </div>
              )}
              {status.reconciliation.last?.blockedBy && <div className="callout">Checkpoint held: {status.reconciliation.last.blockedBy}.</div>}
            </SectionCard>
          </div>
        </>
      )}

      <SectionCard
        actions={
          <FilterBar>
            <FilterField label="Show">
              <select
                aria-label="Filter events"
                className="select"
                onChange={(e) => {
                  setFilter(e.target.value);
                  setPage(1);
                }}
                value={filter}
              >
                <option value="">All events</option>
                <option value="QUEUED">Waiting</option>
                <option value="PROCESSING">Processing</option>
                <option value="DONE">Done</option>
                <option value="DEAD">Dead</option>
              </select>
            </FilterField>
          </FilterBar>
        }
        description="Every sale Poster announced, and what CUP did with it."
        flush
        footer={events && events.pages > 1 ? <Pagination onPage={setPage} page={events.page} pages={events.pages} total={events.total} /> : undefined}
        title="Webhook events"
      >
        {!events ? (
          <LoadingState variant="table" />
        ) : (
          <DataTable
            columns={columns}
            empty={<EmptyState text={filter ? 'No events match this filter.' : 'No webhook has been received yet.'} title={filter ? 'Nothing to show' : 'No events yet'} variant="inline" />}
            rowKey={(e) => e.id}
            rows={events.items}
          />
        )}
      </SectionCard>
    </>
  );
}
