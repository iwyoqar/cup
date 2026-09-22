import { useCallback, useEffect, useState } from 'react';
import { ReferralDetailView } from '../components/ReferralDetailView';
import { ApiError } from '../lib/api';
import {
  CLOSE_REASON_LABELS,
  fetchReferralSettings,
  fetchReferralSummary,
  fetchReferrals,
  REFERRAL_STATUSES,
  ReferralFilters,
  ReferralRow,
  ReferralSettings,
  ReferralSummary,
  updateReferralSettings,
} from '../lib/adminReferrals';
import { formatDate, formatDateTime } from '../lib/format';
import { findNav } from '../lib/nav';
import { ErrorState, LoadingState, PageHeader, StatCard, StatGrid } from '../ui';

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

const num = (v: string) => (v === '' || !Number.isFinite(Number(v)) ? 0 : Math.trunc(Number(v)));

// Admin → Referrals: dashboard counts, the referral rules (settings), a filterable list and a read-only detail view. Nothing here can create, edit,
// qualify or reward a referral — those happen on the server from the rules configured below.
export function ReferralsPage() {
  const [detailId, setDetailId] = useState<string | null>(null);
  const [summary, setSummary] = useState<ReferralSummary | null>(null);
  const [settings, setSettings] = useState<ReferralSettings | null>(null);
  const [draft, setDraft] = useState<ReferralSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<ReferralFilters>({ status: '', referrer: '', referred: '', from: '', to: '' });
  const [rows, setRows] = useState<ReferralRow[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadList = useCallback((f: ReferralFilters) => {
    setRows(null);
    fetchReferrals(f)
      .then((page) => {
        setRows(page.items);
        setNext(page.nextCursor);
      })
      .catch((err) => setError(message(err)));
  }, []);

  useEffect(() => {
    if (detailId) return;
    setError(null);
    Promise.all([fetchReferralSummary(), fetchReferralSettings()])
      .then(([s, cfg]) => {
        setSummary(s);
        setSettings(cfg);
        setDraft(cfg);
      })
      .catch((err) => setError(message(err)));
    loadList(filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailId, loadList]);

  const more = async () => {
    if (!next) return;
    setLoadingMore(true);
    try {
      const page = await fetchReferrals(filters, next);
      setRows((c) => [...(c ?? []), ...page.items]);
      setNext(page.nextCursor);
    } catch (err) {
      setError(message(err));
    } finally {
      setLoadingMore(false);
    }
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await updateReferralSettings(draft);
      setSettings(saved);
      setDraft(saved);
      setNotice('Referral settings saved.');
      fetchReferralSummary().then(setSummary).catch(() => undefined);
    } catch (err) {
      setError(message(err));
    } finally {
      setSaving(false);
    }
  };

  if (detailId) return <ReferralDetailView referralId={detailId} onBack={() => setDetailId(null)} />;

  const changed = settings && draft && JSON.stringify(settings) !== JSON.stringify(draft);
  const setD = <K extends keyof ReferralSettings>(key: K, value: ReferralSettings[K]) => setDraft((d) => (d ? { ...d, [key]: value } : d));
  const setF = <K extends keyof ReferralFilters>(key: K, value: ReferralFilters[K]) => setFilters((f) => ({ ...f, [key]: value }));

  return (
    <div>
      <PageHeader description={findNav('referrals').item.description} title={findNav('referrals').item.label} />
      {settings && (
        <p className={`callout ${settings.enabled ? 'callout--ok' : 'callout--warn'}`}>
          {settings.enabled ? 'The referral program is ON.' : 'The referral program is OFF — no invitation is attributed and no reward is granted.'}
        </p>
      )}
      {error && <ErrorState message={error} />}
      {notice && <p className="success-text">{notice}</p>}

      {summary && (
        <StatGrid>
          <StatCard label="Total referrals" value={String(summary.total)} />
          {REFERRAL_STATUSES.filter((st) => st !== 'INVALID' || summary.byStatus.INVALID > 0).map((st) => (
            <StatCard key={st} label={st.charAt(0) + st.slice(1).toLowerCase()} value={String(summary.byStatus[st])} />
          ))}
          <StatCard label="Points granted" strong value={summary.rewardPointsGranted.toLocaleString('ru-RU')} />
        </StatGrid>
      )}

      {draft && (
        <div className="settings-card" style={{ marginTop: 16 }}>
          <h3 style={{ margin: 0 }}>Referral rules</h3>
          <div className="settings-row">
            <span className="settings-row__label">Referral program enabled</span>
            <Toggle checked={draft.enabled} onChange={(v) => setD('enabled', v)} />
          </div>
          <div className="settings-row">
            <span className="settings-row__label">Referrer reward (points) — after the friend’s first qualifying purchase</span>
            <input min={0} onChange={(e) => setD('referrerRewardValue', num(e.target.value))} style={{ width: 110 }} type="number" value={draft.referrerRewardValue} />
          </div>
          <div className="settings-row">
            <span className="settings-row__label">Invited friend reward (points)</span>
            <input min={0} onChange={(e) => setD('referredRewardValue', num(e.target.value))} style={{ width: 110 }} type="number" value={draft.referredRewardValue} />
          </div>
          <div className="settings-row">
            <span className="settings-row__label">Minimum qualifying purchase (so’m; 0 = any purchase above 0)</span>
            <input min={0} onChange={(e) => setD('minimumPurchaseAmount', num(e.target.value))} style={{ width: 130 }} type="number" value={draft.minimumPurchaseAmount} />
          </div>
          <div className="settings-row">
            <span className="settings-row__label">Only the friend’s very first purchase can qualify</span>
            <Toggle checked={draft.rewardOnFirstPurchaseOnly} onChange={(v) => setD('rewardOnFirstPurchaseOnly', v)} />
          </div>
          <div className="settings-row">
            <span className="settings-row__label">Max successful referrals rewarded per referrer (0 = unlimited)</span>
            <input min={0} onChange={(e) => setD('maxSuccessfulReferrals', num(e.target.value))} style={{ width: 110 }} type="number" value={draft.maxSuccessfulReferrals} />
          </div>
          <div className="settings-row">
            <span className="settings-row__label">Attribution window (days; 0 = never expires)</span>
            <input min={0} onChange={(e) => setD('attributionWindowDays', num(e.target.value))} style={{ width: 110 }} type="number" value={draft.attributionWindowDays} />
          </div>
          <p className="hint-text" style={{ margin: 0 }}>
            Rewards are paid in loyalty points through the existing points ledger (cashback is not available yet). Changing a rule never touches referrals or rewards that are already
            decided. Before enabling, review the reward values above: they are starting values.
          </p>
          <div>
            <button className="button-primary" disabled={!changed || saving} onClick={save} type="button">
              {saving ? 'Saving...' : 'Save settings'}
            </button>
          </div>
        </div>
      )}

      <h3>Referrals</h3>
      <form
        className="ref-filters"
        onSubmit={(e) => {
          e.preventDefault();
          loadList(filters);
        }}
      >
        <select onChange={(e) => setF('status', e.target.value as ReferralFilters['status'])} value={filters.status ?? ''}>
          <option value="">All statuses</option>
          {REFERRAL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <input onChange={(e) => setF('referrer', e.target.value)} placeholder="Referrer name or code" value={filters.referrer ?? ''} />
        <input onChange={(e) => setF('referred', e.target.value)} placeholder="Invited friend name" value={filters.referred ?? ''} />
        <input aria-label="From date" onChange={(e) => setF('from', e.target.value)} type="date" value={filters.from ?? ''} />
        <input aria-label="To date" onChange={(e) => setF('to', e.target.value)} type="date" value={filters.to ?? ''} />
        <button className="button-secondary" type="submit">
          Apply
        </button>
      </form>

      {rows === null && !error && <LoadingState variant="card" />}
      {rows !== null && rows.length === 0 && <p className="hint-text">Hozircha takliflar yo&apos;q.</p>}
      {rows !== null && rows.length > 0 && (
        <>
          <div className="c360__scroll">
            <table className="data-table" style={{ minWidth: 860 }}>
              <thead>
                <tr>
                  <th>Referrer</th>
                  <th>Invited friend</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Qualified</th>
                  <th>Rewards (points)</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.referrer.displayName ?? '—'}</td>
                    <td>{r.referred.displayName ?? '—'}</td>
                    <td title={r.closeReason ? (CLOSE_REASON_LABELS[r.closeReason] ?? r.closeReason) : undefined}>{r.status}</td>
                    <td>{formatDate(r.createdAt)}</td>
                    <td>{r.qualifiedAt ? formatDateTime(r.qualifiedAt) : '—'}</td>
                    <td>{r.referrerRewardPoints || r.referredRewardPoints ? `${r.referrerRewardPoints} / ${r.referredRewardPoints}` : '—'}</td>
                    <td>
                      <button className="button-secondary" onClick={() => setDetailId(r.id)} type="button">
                        Details
                      </button>
                    </td>
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
    </div>
  );
}
