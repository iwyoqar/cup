import { useEffect, useState } from 'react';
import { AutomationDetailView } from '../components/AutomationDetailView';
import { AutomationForm } from '../components/AutomationForm';
import { activateAutomation, AutomationView, CrmSettings, fetchAutomations, fetchCrmSettings, pauseAutomation, updateCrmSettings } from '../lib/adminAutomations';
import { ApiError } from '../lib/api';
import { formatDate, formatDateTime } from '../lib/format';
import { findNav } from '../lib/nav';
import { Button, cx, ErrorState, LoadingState, PageHeader, tableClass, Toggle } from '../ui';

type View = { kind: 'list' } | { kind: 'create' } | { kind: 'edit'; automation: AutomationView } | { kind: 'detail'; id: string };

const message = (err: unknown) => {
  const m = err instanceof ApiError ? err.backendMessage : 'Request failed.';
  return typeof m === 'string' ? m : 'Request failed.';
};


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
          <Button onClick={() => setView({ kind: 'create' })} variant="primary">
            + New automation
          </Button>
        }
        description={findNav('crm-automation').item.description}
        title={findNav('crm-automation').item.label}
      />
      {settings && (
        <p className={cx('block space-y-1 rounded-md border-l-[3px] px-4 py-3 text-sm leading-relaxed [&_p]:m-0', settings.enabled && settings.sendGateOpen ? 'border-ok bg-ok-bg text-ok' : 'border-terracotta bg-cream-soft text-warn')}>
          {!settings.enabled
            ? 'CRM automation is OFF — nothing is detected or sent. Previews still work.'
            : !settings.sendGateOpen
              ? 'CRM automation is ON, but the operator send gate (CRM_AUTOMATION_SEND_ENABLED) is CLOSED — nothing is detected or sent.'
              : 'CRM automation is ON and the operator send gate is open.'}
        </p>
      )}
      {error && <ErrorState message={error} />}
      {notice && <p className="text-[13px] font-semibold text-ok">{notice}</p>}

      {draft && (
        <div className="mt-4 flex flex-col gap-4 rounded-lg border border-line bg-white p-6 [&>h3]:font-display [&>h3]:text-xl [&>h3]:font-medium">
          <h3 className="m-0">CRM settings</h3>
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4 last:border-b-0 last:pb-0">
            <span className="text-sm font-semibold">CRM automation enabled</span>
            <Toggle checked={draft.enabled} onChange={(v) => setD('enabled', v)} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4 last:border-b-0 last:pb-0">
            <span className="text-sm font-semibold">Max CRM messages per customer per day</span>
            <input min={1} onChange={(e) => setD('dailyLimit', num(e.target.value))} className="w-[90px]" type="number" value={draft.dailyLimit} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4 last:border-b-0 last:pb-0">
            <span className="text-sm font-semibold">Quiet hours (business time)</span>
            <div className="flex items-center gap-2 text-sm [&_input[type=number]]:h-9 [&_input[type=number]]:w-24 [&_input[type=text]]:h-9 [&_select]:h-9">
              <input onChange={(e) => setD('quietHoursStart', e.target.value)} type="time" value={draft.quietHoursStart} /> –{' '}
              <input onChange={(e) => setD('quietHoursEnd', e.target.value)} type="time" value={draft.quietHoursEnd} />
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4 last:border-b-0 last:pb-0">
            <span className="text-sm font-semibold">Batch size / run interval (seconds)</span>
            <div className="flex items-center gap-2 text-sm [&_input[type=number]]:h-9 [&_input[type=number]]:w-24 [&_input[type=text]]:h-9 [&_select]:h-9">
              <input min={1} onChange={(e) => setD('batchSize', num(e.target.value))} className="w-[90px]" type="number" value={draft.batchSize} />
              <input min={5} onChange={(e) => setD('runIntervalSeconds', num(e.target.value))} className="w-[90px]" type="number" value={draft.runIntervalSeconds} />
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4 last:border-b-0 last:pb-0">
            <span className="text-sm font-semibold">Default cooldown (h) / default max sends</span>
            <div className="flex items-center gap-2 text-sm [&_input[type=number]]:h-9 [&_input[type=number]]:w-24 [&_input[type=text]]:h-9 [&_select]:h-9">
              <input min={0} onChange={(e) => setD('defaultCooldownHours', num(e.target.value))} className="w-[90px]" type="number" value={draft.defaultCooldownHours} />
              <input min={1} onChange={(e) => setD('defaultMaxSends', num(e.target.value))} className="w-[90px]" type="number" value={draft.defaultMaxSends} />
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4 last:border-b-0 last:pb-0">
            <span className="text-sm font-semibold">Ignore triggers older than (hours)</span>
            <input min={1} onChange={(e) => setD('maxEventAgeHours', num(e.target.value))} className="w-[90px]" type="number" value={draft.maxEventAgeHours} />
          </div>
          <p className="text-[13px] leading-snug text-muted m-0">
            Telegram send gate (operator, read-only): <strong>{draft.sendGateOpen ? 'OPEN' : 'CLOSED'}</strong>
            {draft.enabledAt ? ` · CRM switched on ${formatDateTime(draft.enabledAt)} — nothing earlier can fire.` : ''}
          </p>
          <div>
            <Button disabled={!changed || savingSettings} onClick={saveSettings} variant="primary">
              {savingSettings ? 'Saving...' : 'Save settings'}
            </Button>
          </div>
        </div>
      )}

      {items === null && !error && <LoadingState variant="card" />}
      {items !== null && items.length === 0 && <p className="text-[13px] leading-snug text-muted">Hozircha avtomatlashtirishlar yo&apos;q.</p>}
      {items !== null && items.length > 0 && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-0 text-sm min-w-[860px]">
              <thead>
                <tr>
                  <th className={tableClass.th}>Name</th>
                  <th className={tableClass.th}>Trigger</th>
                  <th className={tableClass.th}>Campaign</th>
                  <th className={tableClass.th}>Segment</th>
                  <th className={tableClass.th}>Status</th>
                  <th className={tableClass.th}>Last run</th>
                  <th className={tableClass.th}>Created</th>
                  <th className={tableClass.th} />
                </tr>
              </thead>
              <tbody>
                {items.map((a) => (
                  <tr className={tableClass.tr} key={a.id}>
                    <td className={tableClass.td}>{a.name}</td>
                    <td className={tableClass.td}>{a.triggerLabel}</td>
                    <td className={tableClass.td}>{a.campaign.name}</td>
                    <td className={tableClass.td}>{a.segment?.name ?? '—'}</td>
                    <td className={tableClass.td}>{a.status}</td>
                    <td className={tableClass.td}>{a.lastRunAt ? formatDateTime(a.lastRunAt) : '—'}</td>
                    <td className={tableClass.td}>{formatDate(a.createdAt)}</td>
                    <td className={tableClass.td}>
                      <div className="flex gap-1.5 flex-wrap">
                        {a.status !== 'ACTIVE' && a.status !== 'ARCHIVED' && (
                          <Button disabled={busyId === a.id} onClick={() => changeStatus(a, activateAutomation)} variant="secondary">
                            Activate
                          </Button>
                        )}
                        {a.status === 'ACTIVE' && (
                          <Button disabled={busyId === a.id} onClick={() => changeStatus(a, pauseAutomation)} variant="secondary">
                            Pause
                          </Button>
                        )}
                        {a.status !== 'ARCHIVED' && (
                          <Button onClick={() => setView({ kind: 'edit', automation: a })} variant="secondary">
                            Edit
                          </Button>
                        )}
                        <Button onClick={() => setView({ kind: 'detail', id: a.id })} variant="secondary">
                          Preview / history
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {next && (
            <div className="mt-3">
              <Button onClick={more} variant="secondary">
                Load more
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
