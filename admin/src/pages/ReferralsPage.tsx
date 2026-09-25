import { useCallback, useEffect, useState } from 'react';
import { ReferralDetailView } from '../components/ReferralDetailView';
import { ApiError } from '../lib/api';
import { cx } from '../ui/cx';
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
import { Button, DataTable, ErrorState, Input, LoadingState, PageHeader, Select, StatCard, StatGrid, Toggle } from '../ui';

const message = (err: unknown) => {
  const m = err instanceof ApiError ? err.backendMessage : 'Request failed.';
  return typeof m === 'string' ? m : 'Request failed.';
};

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
        <p
          className={cx(
            'mb-5 block rounded-md border-l-[3px] px-4 py-3 text-sm leading-relaxed',
            settings.enabled ? 'border-ok bg-ok-bg text-ok' : 'border-terracotta bg-cream-soft text-warn',
          )}
        >
          {settings.enabled ? 'The referral program is ON.' : 'The referral program is OFF — no invitation is attributed and no reward is granted.'}
        </p>
      )}
      {error && <ErrorState message={error} />}
      {notice && <p className="text-[13px] font-semibold text-ok">{notice}</p>}

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
        <div className="mt-4 flex flex-col gap-4 rounded-lg border border-line bg-white p-6">
          <h3 className="font-display text-xl font-medium">Referral rules</h3>
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
            <span className="text-sm font-semibold">Referral program enabled</span>
            <Toggle checked={draft.enabled} onChange={(v) => setD('enabled', v)} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
            <span className="text-sm font-semibold">Referrer reward (points) — after the friend’s first qualifying purchase</span>
            <Input className="w-[110px]" min={0} onChange={(e) => setD('referrerRewardValue', num(e.target.value))} type="number" value={draft.referrerRewardValue} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
            <span className="text-sm font-semibold">Invited friend reward (points)</span>
            <Input className="w-[110px]" min={0} onChange={(e) => setD('referredRewardValue', num(e.target.value))} type="number" value={draft.referredRewardValue} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
            <span className="text-sm font-semibold">Minimum qualifying purchase (so’m; 0 = any purchase above 0)</span>
            <Input className="w-[130px]" min={0} onChange={(e) => setD('minimumPurchaseAmount', num(e.target.value))} type="number" value={draft.minimumPurchaseAmount} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
            <span className="text-sm font-semibold">Only the friend’s very first purchase can qualify</span>
            <Toggle checked={draft.rewardOnFirstPurchaseOnly} onChange={(v) => setD('rewardOnFirstPurchaseOnly', v)} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
            <span className="text-sm font-semibold">Max successful referrals rewarded per referrer (0 = unlimited)</span>
            <Input className="w-[110px]" min={0} onChange={(e) => setD('maxSuccessfulReferrals', num(e.target.value))} type="number" value={draft.maxSuccessfulReferrals} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <span className="text-sm font-semibold">Attribution window (days; 0 = never expires)</span>
            <Input className="w-[110px]" min={0} onChange={(e) => setD('attributionWindowDays', num(e.target.value))} type="number" value={draft.attributionWindowDays} />
          </div>
          <p className="text-[13px] leading-snug text-muted">
            Rewards are paid in loyalty points through the existing points ledger (cashback is not available yet). Changing a rule never touches referrals or rewards that are already
            decided. Before enabling, review the reward values above: they are starting values.
          </p>
          <div>
            <Button disabled={!changed || saving} loading={saving} onClick={save} variant="primary">
              {saving ? 'Saving...' : 'Save settings'}
            </Button>
          </div>
        </div>
      )}

      <h3 className="mt-8 mb-4 font-display text-xl font-medium">Referrals</h3>
      <form
        className="mb-5 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          loadList(filters);
        }}
      >
        <Select onChange={(e) => setF('status', e.target.value as ReferralFilters['status'])} value={filters.status ?? ''}>
          <option value="">All statuses</option>
          {REFERRAL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Input onChange={(e) => setF('referrer', e.target.value)} placeholder="Referrer name or code" value={filters.referrer ?? ''} />
        <Input onChange={(e) => setF('referred', e.target.value)} placeholder="Invited friend name" value={filters.referred ?? ''} />
        <Input aria-label="From date" onChange={(e) => setF('from', e.target.value)} type="date" value={filters.from ?? ''} />
        <Input aria-label="To date" onChange={(e) => setF('to', e.target.value)} type="date" value={filters.to ?? ''} />
        <Button type="submit" variant="secondary">
          Apply
        </Button>
      </form>

      {rows === null && !error && <LoadingState variant="card" />}
      {rows !== null && rows.length === 0 && <p className="text-[13px] leading-snug text-muted">Hozircha takliflar yo&apos;q.</p>}
      {rows !== null && rows.length > 0 && (
        <>
          <DataTable
            boxed
            columns={[
              { key: 'referrer', header: 'Referrer', cell: (r) => r.referrer.displayName ?? '—' },
              { key: 'referred', header: 'Invited friend', cell: (r) => r.referred.displayName ?? '—' },
              { key: 'status', header: 'Status', cell: (r) => <span title={r.closeReason ? (CLOSE_REASON_LABELS[r.closeReason] ?? r.closeReason) : undefined}>{r.status}</span> },
              { key: 'created', header: 'Created', low: true, cell: (r) => formatDate(r.createdAt) },
              { key: 'qualified', header: 'Qualified', low: true, cell: (r) => (r.qualifiedAt ? formatDateTime(r.qualifiedAt) : '—') },
              { key: 'rewards', header: 'Rewards (points)', numeric: true, cell: (r) => (r.referrerRewardPoints || r.referredRewardPoints ? `${r.referrerRewardPoints} / ${r.referredRewardPoints}` : '—') },
              { key: 'actions', header: '', actions: true, cell: (r) => <Button onClick={() => setDetailId(r.id)} size="sm" variant="secondary">Details</Button> },
            ]}
            rowKey={(r) => r.id}
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
    </div>
  );
}
