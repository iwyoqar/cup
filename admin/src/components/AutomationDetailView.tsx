import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { Button, cx, DataTable } from '../ui';
import {
  activateAutomation,
  archiveAutomation,
  AutomationPreview,
  AutomationView,
  ExecutionRow,
  fetchAutomation,
  fetchExecutions,
  pauseAutomation,
  previewAutomation,
  REASON_LABELS,
} from '../lib/adminAutomations';

interface Props {
  automationId: string;
  onBack: () => void;
  onEdit: (a: AutomationView) => void;
}

const message = (err: unknown) => {
  const m = err instanceof ApiError ? err.backendMessage : 'Request failed.';
  return typeof m === 'string' ? m : 'Request failed.';
};

const configText = (a: AutomationView): string => {
  const c = a.triggerConfig;
  if (!c) return 'Invalid configuration';
  return Object.entries(c)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(' · ');
};

// Automation detail: status actions, a READ-ONLY dry-run preview, and the execution history (cursor-paginated). No customer ids or technical errors.
export function AutomationDetailView({ automationId, onBack, onEdit }: Props) {
  const [automation, setAutomation] = useState<AutomationView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<AutomationPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [rows, setRows] = useState<ExecutionRow[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadHistory = useCallback(() => {
    setRows(null);
    fetchExecutions(automationId)
      .then((page) => {
        setRows(page.items);
        setNext(page.nextCursor);
      })
      .catch((err) => setError(message(err)));
  }, [automationId]);

  useEffect(() => {
    setAutomation(null);
    setPreview(null);
    setError(null);
    fetchAutomation(automationId)
      .then(setAutomation)
      .catch((err) => setError(message(err)));
    loadHistory();
  }, [automationId, loadHistory]);

  const act = async (action: () => Promise<AutomationView>) => {
    setBusy(true);
    setError(null);
    try {
      setAutomation(await action());
      setPreview(null);
      loadHistory();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  const runPreview = async () => {
    setPreviewing(true);
    setError(null);
    try {
      setPreview(await previewAutomation(automationId));
    } catch (err) {
      setError(message(err));
    } finally {
      setPreviewing(false);
    }
  };

  const more = async () => {
    if (!next) return;
    setLoadingMore(true);
    try {
      const page = await fetchExecutions(automationId, next);
      setRows((c) => [...(c ?? []), ...page.items]);
      setNext(page.nextCursor);
    } catch (err) {
      setError(message(err));
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div>
      <Button className="mb-4" onClick={onBack} variant="secondary">
        ← Back to automations
      </Button>
      {error && <p className="text-[13px] font-semibold text-err">{error}</p>}
      {!automation && !error && <p className="text-[13px] leading-snug text-muted">Loading...</p>}
      {automation && (
        <>
          <h1 className="font-display text-2xl font-medium">{automation.name}</h1>
          {automation.description && <p className="text-[13px] leading-snug text-muted">{automation.description}</p>}

          <div className="mt-4 flex flex-col gap-4 rounded-lg border border-line bg-white p-6">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
              <span className="text-sm font-semibold">Status</span>
              <strong>{automation.status}</strong>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
              <span className="text-sm font-semibold">Trigger</span>
              <span>{automation.triggerLabel}</span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
              <span className="text-sm font-semibold">Configuration</span>
              <span className="text-[13px] leading-snug text-muted">{configText(automation)}</span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
              <span className="text-sm font-semibold">Campaign</span>
              <span>
                {automation.campaign.name} ({automation.campaign.status})
              </span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
              <span className="text-sm font-semibold">Segment</span>
              <span>{automation.segment?.name ?? '—'}</span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
              <span className="text-sm font-semibold">Cooldown / max sends</span>
              <span>
                {automation.cooldownHours} h / {automation.maxSendsPerCustomer ?? 'unlimited'}
              </span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
              <span className="text-sm font-semibold">Activated / last run</span>
              <span>
                {automation.activatedAt ? formatDateTime(automation.activatedAt) : '—'} / {automation.lastRunAt ? formatDateTime(automation.lastRunAt) : '—'}
              </span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <span className="text-sm font-semibold">Executions</span>
              <span>
                {automation.stats.sent} sent · {automation.stats.pending} pending · {automation.stats.skipped} skipped · {automation.stats.failed} failed
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {automation.status !== 'ACTIVE' && automation.status !== 'ARCHIVED' && (
                <Button disabled={busy} onClick={() => act(() => activateAutomation(automation.id))} variant="primary">
                  Activate
                </Button>
              )}
              {automation.status === 'ACTIVE' && (
                <Button disabled={busy} onClick={() => act(() => pauseAutomation(automation.id))} variant="secondary">
                  Pause
                </Button>
              )}
              {automation.status !== 'ARCHIVED' && (
                <Button disabled={busy} onClick={() => onEdit(automation)} variant="secondary">
                  Edit
                </Button>
              )}
              <Button loading={previewing} onClick={runPreview} variant="secondary">
                {previewing ? 'Calculating…' : 'Preview'}
              </Button>
              {automation.status !== 'ARCHIVED' && (
                <Button disabled={busy} onClick={() => window.confirm('Archive this automation? It stops for good; its history is kept.') && act(() => archiveAutomation(automation.id))} variant="secondary">
                  Archive
                </Button>
              )}
            </div>
          </div>

          {preview && (
            <div className="mt-4 flex flex-col gap-4 rounded-lg border border-line bg-white p-6">
              <div className="rounded-md border border-[#e0c89c] border-l-4 border-l-terracotta bg-cream-soft px-3.5 py-2.5 font-semibold text-black">{preview.notice}</div>
              <div className="grid grid-cols-4 gap-2.5 max-[860px]:grid-cols-2">
                <Stat label="Matched" value={preview.matched} />
                <Stat label="Already processed" value={preview.alreadyProcessed} />
                <Stat label="No Telegram" value={preview.noTelegram} />
                <Stat label="Not in segment" value={preview.segmentMismatch} />
                <Stat label="Cooldown blocked" value={preview.cooldownBlocked} />
                <Stat label="Frequency blocked" value={preview.frequencyBlocked} />
                <Stat label="Daily limit blocked" value={preview.dailyLimitBlocked} />
                <Stat label="Final recipients" value={preview.finalRecipients} strong />
              </div>
              {preview.truncated && <p className="text-[13px] leading-snug text-muted">More candidates are waiting than this preview shows.</p>}
              {!preview.campaign.ready && (
                <p className="text-[13px] font-semibold text-err">
                  The campaign is not ready{preview.campaign.unresolvedVariables.length > 0 ? ` — unknown variables: ${preview.campaign.unresolvedVariables.map((v) => `{{${v}}}`).join(', ')}` : ''}.
                </p>
              )}
              <p className="text-[13px] leading-snug text-muted">
                Sending is {preview.sendGate.crmEnabled ? 'switched on in Admin' : 'switched OFF in Admin'} and the operator gate is {preview.sendGate.envGateOpen ? 'OPEN' : 'CLOSED'}.
                {preview.quietHoursNow ? ' Quiet hours are active right now: sends would be deferred.' : ''}
              </p>
              {preview.sampleMessage && (
                <div>
                  <div className="text-sm font-semibold">Sample message</div>
                  <p className="mt-1 rounded-md bg-canvas px-3 py-2.5 whitespace-pre-wrap [overflow-wrap:anywhere]">{preview.sampleMessage}</p>
                </div>
              )}
              {preview.sample.length > 0 && (
                <DataTable
                  boxed
                  columns={[
                    { key: 'customer', header: 'Customer', cell: (s) => s.displayName ?? '—' },
                    { key: 'outcome', header: 'Outcome', cell: (s) => (s.outcome === 'WOULD_SEND' ? 'Would receive' : (REASON_LABELS[s.outcome] ?? s.outcome)) },
                  ]}
                  rowKey={(s, i) => `${s.displayName ?? 'row'}-${i}`}
                  rows={preview.sample}
                />
              )}
            </div>
          )}

          <h3 className="mt-8 mb-4 font-display text-xl font-medium">Execution history</h3>
          {rows === null ? (
            <p className="text-[13px] leading-snug text-muted">Loading...</p>
          ) : rows.length === 0 ? (
            <p className="text-[13px] leading-snug text-muted">Hozircha bajarilgan ijrolar yo&apos;q.</p>
          ) : (
            <>
              <DataTable
                boxed
                columns={[
                  { key: 'customer', header: 'Customer', cell: (r) => r.customer.displayName ?? '—' },
                  { key: 'trigger', header: 'Trigger', low: true, cell: (r) => r.trigger },
                  { key: 'status', header: 'Status', cell: (r) => r.status },
                  { key: 'reason', header: 'Reason', low: true, cell: (r) => (r.reason ? (REASON_LABELS[r.reason] ?? r.reason) : '—') },
                  { key: 'campaign', header: 'Campaign', low: true, cell: (r) => r.campaign },
                  { key: 'created', header: 'Created', low: true, cell: (r) => formatDateTime(r.createdAt) },
                  { key: 'sent', header: 'Sent', low: true, cell: (r) => (r.sentAt ? formatDateTime(r.sentAt) : '—') },
                ]}
                rowKey={(r) => `${r.customer.displayName ?? 'row'}-${r.trigger}-${r.createdAt}`}
                rows={rows}
              />
              {next && (
                <div className="mt-3">
                  <Button loading={loadingMore} onClick={more} variant="secondary">
                    {loadingMore ? 'Loading...' : 'Load more'}
                  </Button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={cx('rounded-[10px] border px-3 py-2.5', strong ? 'border-black bg-black text-white' : 'border-line bg-canvas')}>
      <div className={cx('text-[11px] font-bold tracking-[0.08em] uppercase', strong ? 'text-white/72' : 'text-muted')}>{label}</div>
      <div className="mt-0.5 text-[22px] font-semibold">{value}</div>
    </div>
  );
}
