import { useCallback, useEffect, useState } from 'react';
import { GrowthSettingsCard } from '../components/GrowthSettingsCard';
import { ApiError } from '../lib/api';
import {
  CustomerRow,
  fetchGrowthBranches,
  fetchGrowthOverview,
  GrowthFilters,
  GrowthOverview,
  LIFECYCLE_LABELS,
  LIFECYCLE_STATES,
  OPPORTUNITY_LABELS,
  OPPORTUNITY_TYPES,
  Priority,
  SIGNAL_LABELS,
  SIGNAL_TYPES,
} from '../lib/adminGrowth';
import { formatDate, formatSom } from '../lib/format';
import { findNav } from '../lib/nav';
import { Button, cx, DataTable, EmptyState, ErrorState, FilterBar, FilterField, Input, LoadingState, PageHeader, SectionCard, Select, StatCard, StatGrid } from '../ui';

const number = (n: number) => n.toLocaleString('ru-RU');
const PERIODS: { key: GrowthFilters['period']; label: string }[] = [
  { key: '', label: 'Default lookback' },
  { key: '7', label: '7 days' },
  { key: '30', label: '30 days' },
  { key: '90', label: '90 days' },
  { key: '365', label: '365 days' },
  { key: 'custom', label: 'Custom' },
];

// Distinct per-state fill colors (growth__bar-fill--*, growth__badge--* in the old CSS). at_risk/dormant have no
// equivalent in the shared @theme palette (they were one-off hex values even before this migration) — kept as
// arbitrary values rather than inventing new shared tokens for two single-use colors.
const LIFECYCLE_FILL: Record<(typeof LIFECYCLE_STATES)[number], string> = {
  NEW: 'bg-terracotta',
  ACTIVE: 'bg-terracotta-deep',
  LOYAL: 'bg-terracotta',
  AT_RISK: 'bg-[#d9a441]',
  DORMANT: 'bg-[#8b857c]',
  CHURNED: 'bg-black',
};

const PRIORITY_TONE: Record<Priority, string> = {
  HIGH: 'bg-terracotta text-white border-terracotta',
  MEDIUM: 'bg-cream border-transparent',
  LOW: 'border-line',
};

const message = (err: unknown) => (err instanceof ApiError && err.status !== 0 && err.backendMessage !== 'network_error' && typeof err.backendMessage === 'string' ? err.backendMessage : "Ma'lumotni yuklab bo'lmadi");

// Admin → Growth Intelligence. Deterministic and descriptive: every figure is produced by the server from the canonical purchases (CUP orders +
// imported POS) and the configured thresholds. Nothing here predicts a customer's behaviour and nothing sends a message — sending stays in
// CRM Automation behind its own safety gates. Customers are shown by name only (no ids).
export function GrowthPage() {
  const [filters, setFilters] = useState<GrowthFilters>({ period: '', branchId: '', from: '', to: '' });
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [data, setData] = useState<GrowthOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const customReady = filters.period !== 'custom' || (filters.from !== '' && filters.to !== '' && filters.from <= filters.to);

  useEffect(() => {
    fetchGrowthBranches()
      .then(setBranches)
      .catch(() => setBranches([]));
  }, []);

  const load = useCallback(() => {
    if (!customReady) return undefined;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchGrowthOverview(filters)
      .then((r) => !cancelled && setData(r))
      .catch((err) => !cancelled && setError(message(err)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [filters, customReady]);

  useEffect(() => load(), [load, reloadKey]);

  const set = <K extends keyof GrowthFilters>(key: K, value: GrowthFilters[K]) => setFilters((f) => ({ ...f, [key]: value }));

  return (
    <div>
      <PageHeader description={findNav('growth').item.description} title={findNav('growth').item.label} />
      <FilterBar>
        <FilterField label="RFM lookback">
          <Select aria-label="RFM lookback" onChange={(e) => set('period', e.target.value as GrowthFilters['period'])} value={filters.period}>
            {PERIODS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </Select>
        </FilterField>
        <FilterField label="Branch">
          <Select aria-label="Branch" onChange={(e) => set('branchId', e.target.value)} value={filters.branchId}>
            <option value="">All branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </FilterField>
        {filters.period === 'custom' && (
          <>
            <FilterField label="From">
              <Input onChange={(e) => set('from', e.target.value)} type="date" value={filters.from} />
            </FilterField>
            <FilterField label="To">
              <Input onChange={(e) => set('to', e.target.value)} type="date" value={filters.to} />
            </FilterField>
            {!customReady && <span className="self-center text-[13px] text-err">Choose a start date that is not after the end date.</span>}
          </>
        )}
      </FilterBar>

      {data && !error && (
        <p className="mb-5 text-[13px] font-semibold tracking-[0.02em] text-muted">
          RFM lookback: {data.range.days} days ({data.range.startDate} → {data.range.endDate}) · {data.branch ? data.branch.name : 'All branches'} · lifecycle as of today
          {loading && <span> · updating…</span>}
        </p>
      )}

      {error && <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} title="The figures could not be loaded" />}
      {!data && !error && <LoadingState variant="page" />}

      {data && (
        <div className={cx('flex min-w-0 flex-col gap-5 transition-opacity duration-200', loading && 'opacity-60')}>
          <StatGrid>
            <StatCard hint="New + active + loyal" label="Active customers" strong value={number(data.kpis.activeCustomers)} />
            <StatCard label="New" value={number(data.kpis.newCustomers)} />
            <StatCard label="Loyal" value={number(data.kpis.loyalCustomers)} />
            <StatCard label="At risk" value={number(data.kpis.atRiskCustomers)} />
            <StatCard label="Dormant" value={number(data.kpis.dormantCustomers)} />
            <StatCard label="Churned" value={number(data.kpis.churnedCustomers)} />
            <StatCard hint={`≥ ${formatSom(data.thresholds.highValueRevenue)} lifetime`} label="High-value" value={number(data.kpis.highValueCustomers)} />
            <StatCard hint="Reward available now" label="With rewards" value={number(data.kpis.customersWithRewards)} />
            <StatCard label="Successful referrals" value={number(data.kpis.successfulReferrals)} />
            <StatCard label="With purchases" value={number(data.kpis.customersWithPurchases)} />
            <StatCard hint={data.branch ? 'Not shown per branch' : undefined} label="No purchase yet" value={data.kpis.neverPurchased === null ? '—' : number(data.kpis.neverPurchased)} />
            <StatCard hint={data.branch ? 'Not shown per branch' : undefined} label="All customers" value={data.kpis.totalCustomers === null ? '—' : number(data.kpis.totalCustomers)} />
          </StatGrid>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <SectionCard title="Lifecycle distribution">
              {data.lifecycle.total === 0 ? (
                <EmptyState text="Hozircha ma'lumot yo'q" title="No data" variant="inline" />
              ) : (
                <div className="flex flex-col gap-2.5">
                  {LIFECYCLE_STATES.map((s) => {
                    const n = data.lifecycle.counts[s];
                    const pct = data.lifecycle.total > 0 ? (n / data.lifecycle.total) * 100 : 0;
                    return (
                      <div className="grid grid-cols-[76px_1fr_92px] items-center gap-2.5 text-sm max-[760px]:grid-cols-[62px_1fr_80px]" key={s}>
                        <span className="truncate">{LIFECYCLE_LABELS[s]}</span>
                        <span className="h-3.5 overflow-hidden rounded-md bg-black/[0.06]">
                          <span className={cx('block h-full min-w-0.5', LIFECYCLE_FILL[s])} style={{ width: `${pct}%` }} />
                        </span>
                        <span className="text-right whitespace-nowrap tabular-nums text-muted">
                          {number(n)} · {Math.round(pct)}%
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
              <p className="mt-4 mb-0 text-[13px] leading-snug text-muted">
                Customers with a qualifying purchase only. NEW ≤ {data.thresholds.newDays} d, ACTIVE ≤ {data.thresholds.activeDays} d, AT_RISK ≤ {data.thresholds.dormantDays} d, DORMANT ≤ {data.thresholds.churnDays} d, then CHURNED.
              </p>
            </SectionCard>

            <SectionCard tone="cream" title="RFM">
              <RfmMatrix matrix={data.rfm.matrix} />
              <div className="grid grid-cols-3 gap-3.5">
                <Hist title="Recency" values={data.rfm.histograms.recency} />
                <Hist title="Frequency" values={data.rfm.histograms.frequency} />
                <Hist title="Monetary" values={data.rfm.histograms.monetary} />
              </div>
              {data.rfm.topScores.length > 0 && (
                <p className="mt-4 mb-0 text-[13px] leading-snug text-muted">Most common scores: {data.rfm.topScores.map((t) => `${t.score} (${number(t.customers)})`).join(' · ')}</p>
              )}
            </SectionCard>
          </div>

          <SectionCard title="Growth signals">
            <div className="mb-3.5 flex flex-wrap gap-2">
              {SIGNAL_TYPES.map((t) => (
                <span className="rounded-full border border-line bg-white px-3 py-1 text-[13px]" key={t}>
                  {SIGNAL_LABELS[t]} <strong>{number(data.signals.counts[t])}</strong>
                </span>
              ))}
            </div>
            {data.signals.latest.length === 0 ? (
              <EmptyState text="Hozircha signallar yo'q" title="No signals" variant="inline" />
            ) : (
              <DataTable
                boxed
                columns={[
                  { key: 'customer', header: 'Customer', cell: (s) => s.customer.displayName ?? '—' },
                  {
                    key: 'signal',
                    header: 'Signal',
                    cell: (s) => (
                      <span
                        className={cx(
                          'inline-block rounded-full border px-2.5 py-0.5 text-xs font-semibold',
                          s.severity.toLowerCase() === 'attention' ? 'border-black bg-black text-white' : 'border-transparent bg-cream',
                        )}
                      >
                        {SIGNAL_LABELS[s.type]}
                      </span>
                    ),
                  },
                  { key: 'detected', header: 'Detected', low: true, cell: (s) => (s.detectedAt ? formatDate(s.detectedAt) : '—') },
                  { key: 'reason', header: 'Reason', cell: (s) => s.reason },
                ]}
                rowKey={(s, i) => `${s.customer.displayName ?? 'row'}-${i}`}
                rows={data.signals.latest}
              />
            )}
          </SectionCard>

          <SectionCard title="Opportunities">
            <DataTable
              boxed
              columns={[
                { key: 'type', header: 'Type', cell: (t: (typeof OPPORTUNITY_TYPES)[number]) => OPPORTUNITY_LABELS[t] },
                { key: 'total', header: 'Customers', numeric: true, cell: (t) => number(data.opportunities.counts[t].total) },
                { key: 'high', header: 'High', numeric: true, low: true, cell: (t) => number(data.opportunities.counts[t].HIGH) },
                { key: 'medium', header: 'Medium', numeric: true, low: true, cell: (t) => number(data.opportunities.counts[t].MEDIUM) },
                { key: 'low', header: 'Low', numeric: true, low: true, cell: (t) => number(data.opportunities.counts[t].LOW) },
                {
                  key: 'tool',
                  header: 'Existing tool',
                  low: true,
                  cell: (t) => {
                    const rec = data.opportunities.recommendations[t];
                    return rec ? `${rec.segment}${rec.automationTrigger ? ` · trigger ${rec.automationTrigger}` : ''}` : '';
                  },
                },
              ]}
              rowKey={(t) => t}
              rows={[...OPPORTUNITY_TYPES]}
            />
            {data.opportunities.top.length > 0 && (
              <div className="mt-4">
                <DataTable
                  boxed
                  columns={[
                    { key: 'priority', header: 'Priority', cell: (o) => <span className={cx('inline-block rounded-md border px-2 py-0.5 text-[11px] font-bold tracking-[0.08em]', PRIORITY_TONE[o.priority])}>{o.priority}</span> },
                    { key: 'opportunity', header: 'Opportunity', cell: (o) => OPPORTUNITY_LABELS[o.type] },
                    { key: 'customer', header: 'Customer', cell: (o) => o.customer.displayName ?? '—' },
                    { key: 'reason', header: 'Reason', cell: (o) => o.reason },
                  ]}
                  rowKey={(o, i) => `${o.customer.displayName ?? 'row'}-${i}`}
                  rows={data.opportunities.top}
                />
              </div>
            )}
            <p className="mt-4 mb-0 text-[13px] leading-snug text-muted">
              Opportunities are derived by fixed rules from purchase history; they are suggestions for existing Segments and CRM Automations. Nothing is sent from here.
            </p>
          </SectionCard>

          <div className="grid grid-cols-1 gap-5">
            <CustomerList hint={undefined} rows={data.lists.highValue} title="Top high-value customers" />
            <CustomerList hint="Most valuable first" rows={data.lists.atRisk} title="At-risk customers" />
            <CustomerList hint="Most recent first" rows={data.lists.newCustomers} title="New customers" />
            <CustomerList hint="Recently crossed the high-value threshold" rows={data.lists.rising} title="Rising customers" />
          </div>

          <SectionCard
            actions={
              <Button onClick={() => setShowSettings((v) => !v)} variant="secondary">
                {showSettings ? 'Hide' : 'Edit thresholds'}
              </Button>
            }
            title="Thresholds"
          >
            {showSettings && <GrowthSettingsCard onSaved={() => setReloadKey((k) => k + 1)} settings={data.thresholds} />}
          </SectionCard>
        </div>
      )}
    </div>
  );
}

// Rows = recency score 5 (top) … 1, columns = frequency score 1 … 5. Cell shade scales with the number of customers in it.
export function RfmMatrix({ matrix }: { matrix: number[][] }) {
  const max = Math.max(1, ...matrix.flat());
  return (
    <div aria-label="RFM matrix: recency score by frequency score" className="mb-3.5 grid grid-cols-[44px_repeat(5,1fr)] gap-1" role="table">
      <div className="flex items-center justify-center text-[11px] font-bold tracking-[0.08em] text-muted-cream">R \ F</div>
      {[1, 2, 3, 4, 5].map((f) => (
        <div className="flex items-center justify-center text-[11px] font-bold tracking-[0.08em] text-muted-cream" key={`f${f}`}>
          {f}
        </div>
      ))}
      {[5, 4, 3, 2, 1].map((r) => (
        <div className="contents" key={`r${r}`}>
          <div className="flex items-center justify-center text-[11px] font-bold tracking-[0.08em] text-muted-cream">{r}</div>
          {[1, 2, 3, 4, 5].map((f) => {
            const n = matrix[r - 1][f - 1];
            return (
              <div
                className="flex min-h-[34px] items-center justify-center rounded-md text-[13px] tabular-nums"
                key={f}
                style={{ background: n > 0 ? `rgba(216, 75, 31, ${0.12 + 0.78 * (n / max)})` : 'rgba(11, 11, 11, 0.04)', color: n / max > 0.55 ? '#fff' : undefined }}
                title={`Recency ${r}, frequency ${f}: ${n} customers`}
              >
                {n > 0 ? number(n) : ''}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function Hist({ title, values }: { title: string; values: number[] }) {
  const max = Math.max(1, ...values);
  return (
    <div>
      <div className="text-[11px] font-semibold tracking-[0.08em] text-muted uppercase">{title} score</div>
      <div className="mt-1.5 flex h-16 items-end gap-1.5">
        {values.map((v, i) => (
          <div className="flex flex-1 flex-col items-center justify-end gap-1" key={i} title={`Score ${i + 1}: ${v} customers`}>
            <span className="w-full rounded-t-[3px] bg-black" style={{ height: `${Math.max(4, (v / max) * 44)}px` }} />
            <span className="text-[10px] text-muted-cream">{i + 1}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CustomerList({ title, rows, hint }: { title: string; rows: CustomerRow[]; hint?: string }) {
  return (
    <SectionCard description={hint} title={title}>
      {rows.length === 0 ? (
        <EmptyState text="Hozircha ma'lumot yo'q" title="No data" variant="inline" />
      ) : (
        <DataTable
          boxed
          columns={[
            { key: 'customer', header: 'Customer', cell: (r) => r.customer.displayName ?? '—' },
            { key: 'rfm', header: 'RFM', low: true, cell: (r) => r.rfmScore ?? '—' },
            { key: 'last', header: 'Last', numeric: true, cell: (r) => (r.daysSinceLastPurchase === null ? '—' : `${r.daysSinceLastPurchase} d`) },
            { key: 'purchases', header: 'Purchases', numeric: true, low: true, cell: (r) => number(r.lifetimePurchases) },
            { key: 'revenue', header: 'Revenue', numeric: true, cell: (r) => formatSom(r.lifetimeRevenue) },
          ]}
          rowKey={(r, i) => `${r.customer.displayName ?? 'row'}-${i}`}
          rows={rows}
        />
      )}
    </SectionCard>
  );
}
