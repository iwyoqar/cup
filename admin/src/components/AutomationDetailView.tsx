import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../lib/api';
import { formatDateTime } from '../lib/format';
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
      <button className="button-secondary" onClick={onBack} type="button" style={{ marginBottom: 16 }}>
        ← Back to automations
      </button>
      {error && <p className="error-text">{error}</p>}
      {!automation && !error && <p className="hint-text">Loading...</p>}
      {automation && (
        <>
          <h1>{automation.name}</h1>
          {automation.description && <p className="hint-text">{automation.description}</p>}

          <div className="settings-card">
            <div className="settings-row">
              <span className="settings-row__label">Status</span>
              <strong>{automation.status}</strong>
            </div>
            <div className="settings-row">
              <span className="settings-row__label">Trigger</span>
              <span>{automation.triggerLabel}</span>
            </div>
            <div className="settings-row">
              <span className="settings-row__label">Configuration</span>
              <span className="hint-text">{configText(automation)}</span>
            </div>
            <div className="settings-row">
              <span className="settings-row__label">Campaign</span>
              <span>
                {automation.campaign.name} ({automation.campaign.status})
              </span>
            </div>
            <div className="settings-row">
              <span className="settings-row__label">Segment</span>
              <span>{automation.segment?.name ?? '—'}</span>
            </div>
            <div className="settings-row">
              <span className="settings-row__label">Cooldown / max sends</span>
              <span>
                {automation.cooldownHours} h / {automation.maxSendsPerCustomer ?? 'unlimited'}
              </span>
            </div>
            <div className="settings-row">
              <span className="settings-row__label">Activated / last run</span>
              <span>
                {automation.activatedAt ? formatDateTime(automation.activatedAt) : '—'} / {automation.lastRunAt ? formatDateTime(automation.lastRunAt) : '—'}
              </span>
            </div>
            <div className="settings-row">
              <span className="settings-row__label">Executions</span>
              <span>
                {automation.stats.sent} sent · {automation.stats.pending} pending · {automation.stats.skipped} skipped · {automation.stats.failed} failed
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {automation.status !== 'ACTIVE' && automation.status !== 'ARCHIVED' && (
                <button className="button-primary" disabled={busy} onClick={() => act(() => activateAutomation(automation.id))} type="button">
                  Activate
                </button>
              )}
              {automation.status === 'ACTIVE' && (
                <button className="button-secondary" disabled={busy} onClick={() => act(() => pauseAutomation(automation.id))} type="button">
                  Pause
                </button>
              )}
              {automation.status !== 'ARCHIVED' && (
                <button className="button-secondary" disabled={busy} onClick={() => onEdit(automation)} type="button">
                  Edit
                </button>
              )}
              <button className="button-secondary" disabled={previewing} onClick={runPreview} type="button">
                {previewing ? 'Calculating…' : 'Preview'}
              </button>
              {automation.status !== 'ARCHIVED' && (
                <button
                  className="button-secondary"
                  disabled={busy}
                  onClick={() => window.confirm('Archive this automation? It stops for good; its history is kept.') && act(() => archiveAutomation(automation.id))}
                  type="button"
                >
                  Archive
                </button>
              )}
            </div>
          </div>

          {preview && (
            <div className="settings-card crm-preview">
              <div className="crm-preview__banner">{preview.notice}</div>
              <div className="crm-preview__grid">
                <Stat label="Matched" value={preview.matched} />
                <Stat label="Already processed" value={preview.alreadyProcessed} />
                <Stat label="No Telegram" value={preview.noTelegram} />
                <Stat label="Not in segment" value={preview.segmentMismatch} />
                <Stat label="Cooldown blocked" value={preview.cooldownBlocked} />
                <Stat label="Frequency blocked" value={preview.frequencyBlocked} />
                <Stat label="Daily limit blocked" value={preview.dailyLimitBlocked} />
                <Stat label="Final recipients" value={preview.finalRecipients} strong />
              </div>
              {preview.truncated && <p className="hint-text">More candidates are waiting than this preview shows.</p>}
              {!preview.campaign.ready && (
                <p className="error-text">
                  The campaign is not ready{preview.campaign.unresolvedVariables.length > 0 ? ` — unknown variables: ${preview.campaign.unresolvedVariables.map((v) => `{{${v}}}`).join(', ')}` : ''}.
                </p>
              )}
              <p className="hint-text">
                Sending is {preview.sendGate.crmEnabled ? 'switched on in Admin' : 'switched OFF in Admin'} and the operator gate is {preview.sendGate.envGateOpen ? 'OPEN' : 'CLOSED'}.
                {preview.quietHoursNow ? ' Quiet hours are active right now: sends would be deferred.' : ''}
              </p>
              {preview.sampleMessage && (
                <div>
                  <div className="settings-row__label">Sample message</div>
                  <p className="crm-preview__sample">{preview.sampleMessage}</p>
                </div>
              )}
              {preview.sample.length > 0 && (
                <table className="data-table" style={{ marginTop: 0 }}>
                  <thead>
                    <tr>
                      <th>Customer</th>
                      <th>Outcome</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.sample.map((s, i) => (
                      <tr key={i}>
                        <td>{s.displayName ?? '—'}</td>
                        <td>{s.outcome === 'WOULD_SEND' ? 'Would receive' : (REASON_LABELS[s.outcome] ?? s.outcome)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          <h3>Execution history</h3>
          {rows === null ? (
            <p className="hint-text">Loading...</p>
          ) : rows.length === 0 ? (
            <p className="hint-text">Hozircha bajarilgan ijrolar yo&apos;q.</p>
          ) : (
            <>
              <div className="c360__scroll">
                <table className="data-table" style={{ marginTop: 0, minWidth: 640 }}>
                  <thead>
                    <tr>
                      <th>Customer</th>
                      <th>Trigger</th>
                      <th>Status</th>
                      <th>Reason</th>
                      <th>Campaign</th>
                      <th>Created</th>
                      <th>Sent</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i}>
                        <td>{r.customer.displayName ?? '—'}</td>
                        <td>{r.trigger}</td>
                        <td>{r.status}</td>
                        <td>{r.reason ? (REASON_LABELS[r.reason] ?? r.reason) : '—'}</td>
                        <td>{r.campaign}</td>
                        <td>{formatDateTime(r.createdAt)}</td>
                        <td>{r.sentAt ? formatDateTime(r.sentAt) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {next && (
                <div style={{ marginTop: 12 }}>
                  <button className="button-secondary" disabled={loadingMore} onClick={more} type="button">
                    {loadingMore ? 'Loading...' : 'Load more'}
                  </button>
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
    <div className={`crm-preview__stat${strong ? ' crm-preview__stat--strong' : ''}`}>
      <div className="c360__label">{label}</div>
      <div className="crm-preview__value">{value}</div>
    </div>
  );
}
