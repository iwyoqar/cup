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
import { FilterBar, FilterField, PageHeader } from '../ui';

const number = (n: number) => n.toLocaleString('ru-RU');
const PERIODS: { key: GrowthFilters['period']; label: string }[] = [
  { key: '', label: 'Default lookback' },
  { key: '7', label: '7 days' },
  { key: '30', label: '30 days' },
  { key: '90', label: '90 days' },
  { key: '365', label: '365 days' },
  { key: 'custom', label: 'Custom' },
];
const PRIORITY_CLASS: Record<Priority, string> = { HIGH: 'growth__pill growth__pill--high', MEDIUM: 'growth__pill growth__pill--medium', LOW: 'growth__pill' };

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
    <div className="analytics growth">
      <PageHeader description={findNav('growth').item.description} title={findNav('growth').item.label} />
      <FilterBar>
          <FilterField label="RFM lookback"><select aria-label="RFM lookback" className="select" onChange={(e) => set('period', e.target.value as GrowthFilters['period'])} value={filters.period}>
            {PERIODS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select></FilterField>
          <FilterField label="Branch"><select aria-label="Branch" className="select" onChange={(e) => set('branchId', e.target.value)} value={filters.branchId}>
            <option value="">All branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select></FilterField>
        </FilterBar>

      {filters.period === 'custom' && (
        <div className="analytics__custom">
          <label>
            From <input onChange={(e) => set('from', e.target.value)} type="date" value={filters.from} />
          </label>
          <label>
            To <input onChange={(e) => set('to', e.target.value)} type="date" value={filters.to} />
          </label>
          {!customReady && <span className="analytics__note">Choose a start date that is not after the end date.</span>}
        </div>
      )}

      {data && !error && (
        <p className="analytics__range">
          RFM lookback: {data.range.days} days ({data.range.startDate} → {data.range.endDate}) · {data.branch ? data.branch.name : 'All branches'} · lifecycle as of today
          {loading && <span className="analytics__loading"> · updating…</span>}
        </p>
      )}

      {error && (
        <div className="analytics__error" role="alert">
          <span>{error}</span>
          <button className="analytics__retry" onClick={() => setReloadKey((k) => k + 1)} type="button">
            Retry
          </button>
        </div>
      )}
      {!data && !error && <p className="analytics__note">Loading…</p>}

      {data && (
        <div className={`analytics__body${loading ? ' analytics__body--loading' : ''}`}>
          <section className="analytics__kpis">
            <Kpi label="Active customers" value={number(data.kpis.activeCustomers)} hint="New + active + loyal" strong />
            <Kpi label="New" value={number(data.kpis.newCustomers)} />
            <Kpi label="Loyal" value={number(data.kpis.loyalCustomers)} />
            <Kpi label="At risk" value={number(data.kpis.atRiskCustomers)} />
            <Kpi label="Dormant" value={number(data.kpis.dormantCustomers)} />
            <Kpi label="Churned" value={number(data.kpis.churnedCustomers)} />
            <Kpi label="High-value" value={number(data.kpis.highValueCustomers)} hint={`≥ ${formatSom(data.thresholds.highValueRevenue)} lifetime`} />
            <Kpi label="With rewards" value={number(data.kpis.customersWithRewards)} hint="Reward available now" />
            <Kpi label="Successful referrals" value={number(data.kpis.successfulReferrals)} />
            <Kpi label="With purchases" value={number(data.kpis.customersWithPurchases)} />
            <Kpi label="No purchase yet" value={data.kpis.neverPurchased === null ? '—' : number(data.kpis.neverPurchased)} hint={data.branch ? 'Not shown per branch' : undefined} />
            <Kpi label="All customers" value={data.kpis.totalCustomers === null ? '—' : number(data.kpis.totalCustomers)} hint={data.branch ? 'Not shown per branch' : undefined} />
          </section>

          <div className="analytics__two">
            <section className="analytics__panel">
              <h2 className="analytics__h2">Lifecycle distribution</h2>
              {data.lifecycle.total === 0 ? (
                <p className="analytics__empty">Hozircha ma&apos;lumot yo&apos;q</p>
              ) : (
                <div className="growth__bars">
                  {LIFECYCLE_STATES.map((s) => {
                    const n = data.lifecycle.counts[s];
                    const pct = data.lifecycle.total > 0 ? (n / data.lifecycle.total) * 100 : 0;
                    return (
                      <div className="growth__bar-row" key={s}>
                        <span className="growth__bar-label">{LIFECYCLE_LABELS[s]}</span>
                        <span className="growth__bar-track">
                          <span className={`growth__bar-fill growth__bar-fill--${s.toLowerCase()}`} style={{ width: `${pct}%` }} />
                        </span>
                        <span className="growth__bar-num">
                          {number(n)} · {Math.round(pct)}%
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
              <p className="analytics__note" style={{ marginBottom: 0 }}>
                Customers with a qualifying purchase only. NEW ≤ {data.thresholds.newDays} d, ACTIVE ≤ {data.thresholds.activeDays} d, AT_RISK ≤ {data.thresholds.dormantDays} d, DORMANT ≤ {data.thresholds.churnDays} d, then CHURNED.
              </p>
            </section>

            <section className="analytics__panel analytics__panel--cream">
              <h2 className="analytics__h2">RFM</h2>
              <RfmMatrix matrix={data.rfm.matrix} />
              <div className="growth__hists">
                <Hist title="Recency" values={data.rfm.histograms.recency} />
                <Hist title="Frequency" values={data.rfm.histograms.frequency} />
                <Hist title="Monetary" values={data.rfm.histograms.monetary} />
              </div>
              {data.rfm.topScores.length > 0 && (
                <p className="analytics__note" style={{ marginBottom: 0 }}>
                  Most common scores: {data.rfm.topScores.map((t) => `${t.score} (${number(t.customers)})`).join(' · ')}
                </p>
              )}
            </section>
          </div>

          <section className="analytics__panel">
            <h2 className="analytics__h2">Growth signals</h2>
            <div className="growth__chips">
              {SIGNAL_TYPES.map((t) => (
                <span className="growth__chip" key={t}>
                  {SIGNAL_LABELS[t]} <strong>{number(data.signals.counts[t])}</strong>
                </span>
              ))}
            </div>
            {data.signals.latest.length === 0 ? (
              <p className="analytics__empty">Hozircha signallar yo&apos;q</p>
            ) : (
              <div className="c360__scroll">
                <table className="analytics__table">
                  <thead>
                    <tr>
                      <th>Customer</th>
                      <th>Signal</th>
                      <th>Detected</th>
                      <th>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.signals.latest.map((s, i) => (
                      <tr key={i}>
                        <td>{s.customer.displayName ?? '—'}</td>
                        <td>
                          <span className={`growth__sev growth__sev--${s.severity.toLowerCase()}`}>{SIGNAL_LABELS[s.type]}</span>
                        </td>
                        <td>{s.detectedAt ? formatDate(s.detectedAt) : '—'}</td>
                        <td>{s.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="analytics__panel">
            <h2 className="analytics__h2">Opportunities</h2>
            <div className="c360__scroll">
              <table className="analytics__table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th className="analytics__num">Customers</th>
                    <th className="analytics__num">High</th>
                    <th className="analytics__num">Medium</th>
                    <th className="analytics__num">Low</th>
                    <th>Existing tool</th>
                  </tr>
                </thead>
                <tbody>
                  {OPPORTUNITY_TYPES.map((t) => {
                    const c = data.opportunities.counts[t];
                    const rec = data.opportunities.recommendations[t];
                    return (
                      <tr key={t}>
                        <td>{OPPORTUNITY_LABELS[t]}</td>
                        <td className="analytics__num">{number(c.total)}</td>
                        <td className="analytics__num">{number(c.HIGH)}</td>
                        <td className="analytics__num">{number(c.MEDIUM)}</td>
                        <td className="analytics__num">{number(c.LOW)}</td>
                        <td>{rec ? `${rec.segment}${rec.automationTrigger ? ` · trigger ${rec.automationTrigger}` : ''}` : ''}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {data.opportunities.top.length > 0 && (
              <div className="c360__scroll" style={{ marginTop: 16 }}>
                <table className="analytics__table">
                  <thead>
                    <tr>
                      <th>Priority</th>
                      <th>Opportunity</th>
                      <th>Customer</th>
                      <th>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.opportunities.top.map((o, i) => (
                      <tr key={i}>
                        <td>
                          <span className={PRIORITY_CLASS[o.priority]}>{o.priority}</span>
                        </td>
                        <td>{OPPORTUNITY_LABELS[o.type]}</td>
                        <td>{o.customer.displayName ?? '—'}</td>
                        <td>{o.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="analytics__note" style={{ marginBottom: 0 }}>
              Opportunities are derived by fixed rules from purchase history; they are suggestions for existing Segments and CRM Automations. Nothing is sent from here.
            </p>
          </section>

          <div className="growth__lists">
            <CustomerList title="Top high-value customers" rows={data.lists.highValue} />
            <CustomerList title="At-risk customers" rows={data.lists.atRisk} hint="Most valuable first" />
            <CustomerList title="New customers" rows={data.lists.newCustomers} hint="Most recent first" />
            <CustomerList title="Rising customers" rows={data.lists.rising} hint="Recently crossed the high-value threshold" />
          </div>

          <section className="analytics__panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <h2 className="analytics__h2" style={{ margin: 0 }}>
                Thresholds
              </h2>
              <button className="button-secondary" onClick={() => setShowSettings((v) => !v)} type="button">
                {showSettings ? 'Hide' : 'Edit thresholds'}
              </button>
            </div>
            {showSettings && (
              <GrowthSettingsCard onSaved={() => setReloadKey((k) => k + 1)} settings={data.thresholds} />
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, hint, strong }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <div className={`analytics__kpi${strong ? ' analytics__kpi--strong' : ''}`}>
      <div className="analytics__label">{label}</div>
      <div className="analytics__kpi-value">{value}</div>
      {hint && <div className="analytics__label growth__hint">{hint}</div>}
    </div>
  );
}

// Rows = recency score 5 (top) … 1, columns = frequency score 1 … 5. Cell shade scales with the number of customers in it.
export function RfmMatrix({ matrix }: { matrix: number[][] }) {
  const max = Math.max(1, ...matrix.flat());
  return (
    <div className="growth__matrix" role="table" aria-label="RFM matrix: recency score by frequency score">
      <div className="growth__matrix-corner">R \ F</div>
      {[1, 2, 3, 4, 5].map((f) => (
        <div className="growth__matrix-head" key={`f${f}`}>
          {f}
        </div>
      ))}
      {[5, 4, 3, 2, 1].map((r) => (
        <div className="growth__matrix-row" key={`r${r}`}>
          <div className="growth__matrix-head">{r}</div>
          {[1, 2, 3, 4, 5].map((f) => {
            const n = matrix[r - 1][f - 1];
            return (
              <div className="growth__matrix-cell" key={f} style={{ background: n > 0 ? `rgba(216, 75, 31, ${0.12 + 0.78 * (n / max)})` : 'rgba(11, 11, 11, 0.04)', color: n / max > 0.55 ? '#fff' : undefined }} title={`Recency ${r}, frequency ${f}: ${n} customers`}>
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
      <div className="analytics__label">{title} score</div>
      <div className="growth__hist">
        {values.map((v, i) => (
          <div className="growth__hist-col" key={i} title={`Score ${i + 1}: ${v} customers`}>
            <span className="growth__hist-bar" style={{ height: `${Math.max(4, (v / max) * 44)}px` }} />
            <span className="growth__hist-x">{i + 1}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CustomerList({ title, rows, hint }: { title: string; rows: CustomerRow[]; hint?: string }) {
  return (
    <section className="analytics__panel">
      <h2 className="analytics__h2">{title}</h2>
      {hint && (
        <p className="analytics__note" style={{ marginTop: -6 }}>
          {hint}
        </p>
      )}
      {rows.length === 0 ? (
        <p className="analytics__empty">Hozircha ma&apos;lumot yo&apos;q</p>
      ) : (
        <div className="c360__scroll">
          <table className="analytics__table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>RFM</th>
                <th className="analytics__num">Last</th>
                <th className="analytics__num">Purchases</th>
                <th className="analytics__num">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>{r.customer.displayName ?? '—'}</td>
                  <td>{r.rfmScore ?? '—'}</td>
                  <td className="analytics__num">{r.daysSinceLastPurchase === null ? '—' : `${r.daysSinceLastPurchase} d`}</td>
                  <td className="analytics__num">{number(r.lifetimePurchases)}</td>
                  <td className="analytics__num">{formatSom(r.lifetimeRevenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
