import { useEffect, useState } from 'react';
import { AutomationDetailView } from '../components/AutomationDetailView';
import { AutomationForm } from '../components/AutomationForm';
import { activateAutomation, AutomationView, CrmSettings, fetchAutomations, fetchCrmSettings, pauseAutomation, updateCrmSettings } from '../lib/adminAutomations';
import { ApiError } from '../lib/api';
import { formatDate, formatDateTime } from '../lib/format';
import { findNav } from '../lib/nav';
import { ErrorState, LoadingState, PageHeader } from '../ui';

type View = { kind: 'list' } | { kind: 'create' } | { kind: 'edit'; automation: AutomationView } | { kind: 'detail'; id: string };

const message = (err: unknown) => {
  const m = err instanceof ApiError ? err.backendMessage : 'Request failed.';
  return typeof m === 'string' ? m : 'Request failed.';
};

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle">
      <input checked={checked} onChange={(e) => onChange(e.target.checked)} type="checkbox" />
      <span className="toggle__track" />
    </label>
  );
}

// Admin → CRM Automation: list (with the CRM business settings) → create / edit → detail (preview + execution history).
export function AutomationsPage() {
  const [view, setView] = useState<View>({ kind: 'list' });
  const [items, setItems] = useState<AutomationView[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [settings, setSettings] = useState<CrmSettings | null>(null);
  const [draft, setDraft] = useState<CrmSettings | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = () => {
    setItems(null);
    setError(null);
    Promise.all([fetchAutomations(), fetchCrmSettings()])
      .then(([page, s]) => {
        setItems(page.items);
        setNext(page.nextCursor);
        setSettings(s);
        setDraft(s);
      })
      .catch((err) => setError(message(err)));
  };

  useEffect(() => {
    if (view.kind === 'list') load();
  }, [view.kind]);

  const more = async () => {
    if (!next) return;
    try {
      const page = await fetchAutomations(next);
      setItems((c) => [...(c ?? []), ...page.items]);
      setNext(page.nextCursor);
    } catch (err) {
      setError(message(err));
    }
  };

  const changeStatus = async (a: AutomationView, action: (id: string) => Promise<AutomationView>) => {
    setBusyId(a.id);
    setError(null);
    try {
      const updated = await action(a.id);
      setItems((c) => (c ?? []).map((x) => (x.id === updated.id ? updated : x)));
    } catch (err) {
      setError(message(err));
    } finally {
      setBusyId(null);
    }
  };

  const saveSettings = async () => {
    if (!draft) return;
    setSavingSettings(true);
    setError(null);
    setNotice(null);
    try {
      const { enabledAt: _a, sendGateOpen: _b, ...rest } = draft;
      void _a;
      void _b;
      const saved = await updateCrmSettings(rest);
      setSettings(saved);
      setDraft(saved);
      setNotice('CRM settings saved.');
    } catch (err) {
      setError(message(err));
    } finally {
      setSavingSettings(false);
    }
  };

  if (view.kind === 'create') return <AutomationForm existing={null} onCancel={() => setView({ kind: 'list' })} onSaved={(a) => setView({ kind: 'detail', id: a.id })} />;
  if (view.kind === 'edit') return <AutomationForm existing={view.automation} onCancel={() => setView({ kind: 'detail', id: view.automation.id })} onSaved={(a) => setView({ kind: 'detail', id: a.id })} />;
  if (view.kind === 'detail') return <AutomationDetailView automationId={view.id} onBack={() => setView({ kind: 'list' })} onEdit={(a) => setView({ kind: 'edit', automation: a })} />;

  const changed = settings && draft && JSON.stringify(settings) !== JSON.stringify(draft);
  const setD = <K extends keyof CrmSettings>(key: K, value: CrmSettings[K]) => setDraft((d) => (d ? { ...d, [key]: value } : d));
  const num = (v: string) => (v === '' || !Number.isFinite(Number(v)) ? 0 : Math.trunc(Number(v)));

  return (
    <div>
      <PageHeader
        actions={
          <button className="button-primary" onClick={() => setView({ kind: 'create' })} type="button">
            + New automation
          </button>
        }
        description={findNav('crm-automation').item.description}
        title={findNav('crm-automation').item.label}
      />
      {settings && (
        <p className={`callout ${settings.enabled && settings.sendGateOpen ? 'callout--ok' : 'callout--warn'}`}>
          {!settings.enabled
            ? 'CRM automation is OFF — nothing is detected or sent. Previews still work.'
            : !settings.sendGateOpen
              ? 'CRM automation is ON, but the operator send gate (CRM_AUTOMATION_SEND_ENABLED) is CLOSED — nothing is detected or sent.'
              : 'CRM automation is ON and the operator send gate is open.'}
        </p>
      )}
      {error && <ErrorState message={error} />}
      {notice && <p className="success-text">{notice}</p>}

      {draft && (
        <div className="settings-card">
          <h3 style={{ margin: 0 }}>CRM settings</h3>
          <div className="settings-row">
            <span className="settings-row__label">CRM automation enabled</span>
            <Toggle checked={draft.enabled} onChange={(v) => setD('enabled', v)} />
          </div>
          <div className="settings-row">
            <span className="settings-row__label">Max CRM messages per customer per day</span>
            <input min={1} onChange={(e) => setD('dailyLimit', num(e.target.value))} style={{ width: 90 }} type="number" value={draft.dailyLimit} />
          </div>
          <div className="settings-row">
            <span className="settings-row__label">Quiet hours (business time)</span>
            <div className="settings-row__control">
              <input onChange={(e) => setD('quietHoursStart', e.target.value)} type="time" value={draft.quietHoursStart} /> –{' '}
              <input onChange={(e) => setD('quietHoursEnd', e.target.value)} type="time" value={draft.quietHoursEnd} />
            </div>
          </div>
          <div className="settings-row">
            <span className="settings-row__label">Batch size / run interval (seconds)</span>
            <div className="settings-row__control">
              <input min={1} onChange={(e) => setD('batchSize', num(e.target.value))} style={{ width: 90 }} type="number" value={draft.batchSize} />
              <input min={5} onChange={(e) => setD('runIntervalSeconds', num(e.target.value))} style={{ width: 90 }} type="number" value={draft.runIntervalSeconds} />
            </div>
          </div>
          <div className="settings-row">
            <span className="settings-row__label">Default cooldown (h) / default max sends</span>
            <div className="settings-row__control">
              <input min={0} onChange={(e) => setD('defaultCooldownHours', num(e.target.value))} style={{ width: 90 }} type="number" value={draft.defaultCooldownHours} />
              <input min={1} onChange={(e) => setD('defaultMaxSends', num(e.target.value))} style={{ width: 90 }} type="number" value={draft.defaultMaxSends} />
            </div>
          </div>
          <div className="settings-row">
            <span className="settings-row__label">Ignore triggers older than (hours)</span>
            <input min={1} onChange={(e) => setD('maxEventAgeHours', num(e.target.value))} style={{ width: 90 }} type="number" value={draft.maxEventAgeHours} />
          </div>
          <p className="hint-text" style={{ margin: 0 }}>
            Telegram send gate (operator, read-only): <strong>{draft.sendGateOpen ? 'OPEN' : 'CLOSED'}</strong>
            {draft.enabledAt ? ` · CRM switched on ${formatDateTime(draft.enabledAt)} — nothing earlier can fire.` : ''}
          </p>
          <div>
            <button className="button-primary" disabled={!changed || savingSettings} onClick={saveSettings} type="button">
              {savingSettings ? 'Saving...' : 'Save settings'}
            </button>
          </div>
        </div>
      )}

      {items === null && !error && <LoadingState variant="card" />}
      {items !== null && items.length === 0 && <p className="hint-text">Hozircha avtomatlashtirishlar yo&apos;q.</p>}
      {items !== null && items.length > 0 && (
        <>
          <div className="c360__scroll">
            <table className="data-table" style={{ minWidth: 860 }}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Trigger</th>
                  <th>Campaign</th>
                  <th>Segment</th>
                  <th>Status</th>
                  <th>Last run</th>
                  <th>Created</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((a) => (
                  <tr key={a.id}>
                    <td>{a.name}</td>
                    <td>{a.triggerLabel}</td>
                    <td>{a.campaign.name}</td>
                    <td>{a.segment?.name ?? '—'}</td>
                    <td>{a.status}</td>
                    <td>{a.lastRunAt ? formatDateTime(a.lastRunAt) : '—'}</td>
                    <td>{formatDate(a.createdAt)}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {a.status !== 'ACTIVE' && a.status !== 'ARCHIVED' && (
                          <button className="button-secondary" disabled={busyId === a.id} onClick={() => changeStatus(a, activateAutomation)} type="button">
                            Activate
                          </button>
                        )}
                        {a.status === 'ACTIVE' && (
                          <button className="button-secondary" disabled={busyId === a.id} onClick={() => changeStatus(a, pauseAutomation)} type="button">
                            Pause
                          </button>
                        )}
                        {a.status !== 'ARCHIVED' && (
                          <button className="button-secondary" onClick={() => setView({ kind: 'edit', automation: a })} type="button">
                            Edit
                          </button>
                        )}
                        <button className="button-secondary" onClick={() => setView({ kind: 'detail', id: a.id })} type="button">
                          Preview / history
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {next && (
            <div style={{ marginTop: 12 }}>
              <button className="button-secondary" onClick={more} type="button">
                Load more
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
