import { useCallback, useEffect, useState } from 'react';
import { fetchAnalyticsOverview } from '../lib/adminAnalytics';
import { BranchCard, BranchDetail, BranchIntelligenceOverview, DayValue, fetchBranchIntelligence, ProductLine, SourceSlice } from '../lib/adminBranchIntelligence';
import { LIFECYCLE_LABELS, LIFECYCLE_STATES, OPPORTUNITY_LABELS, OPPORTUNITY_TYPES, Priority, SIGNAL_LABELS, SIGNAL_TYPES } from '../lib/adminGrowth';
import { ApiError } from '../lib/api';
import { formatDate, formatSom } from '../lib/format';
import { AnalyticsPeriodKey } from '../lib/types';
import { RfmMatrix } from './GrowthPage';
import { findNav } from '../lib/nav';
import { FilterBar, FilterField, PageHeader } from '../ui';

const PERIODS: { key: AnalyticsPeriodKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'last7', label: 'Last 7 days' },
  { key: 'last30', label: 'Last 30 days' },
  { key: 'custom', label: 'Custom' },
];

const PRIORITY_CLASS: Record<Priority, string> = { HIGH: 'growth__pill growth__pill--high', MEDIUM: 'growth__pill growth__pill--medium', LOW: 'growth__pill' };
const number = (n: number) => n.toLocaleString('ru-RU');
const percent = (n: number) => `${n.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%`;
const message = (err: unknown) => (err instanceof ApiError && err.status !== 0 && err.backendMessage !== 'network_error' && typeof err.backendMessage === 'string' ? err.backendMessage : "Ma'lumotni yuklab bo'lmadi");
const EMPTY = "Hozircha ma'lumot yo'q";

// Phase 18 — Branch Intelligence. The backend computes every figure (deterministic, read-only, from the canonical purchases); this page only formats and draws
// them. Branches are listed by NAME — there is no ranking, score, tier or prediction anywhere on the page.
export function BranchIntelligencePage() {
  const [period, setPeriod] = useState<AnalyticsPeriodKey>('last30');
  const [branchId, setBranchId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [data, setData] = useState<BranchIntelligenceOverview | null>(null);
  const [allDays, setAllDays] = useState<DayValue[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  const customReady = period !== 'custom' || (startDate !== '' && endDate !== '' && startDate <= endDate);

  const load = useCallback(() => {
    if (!customReady) return undefined;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const filters = { period, branchId: branchId || undefined, startDate: startDate || undefined, endDate: endDate || undefined };
    fetchBranchIntelligence(filters)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err) => {
        if (!cancelled) setError(message(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    // All-branches view: the daily revenue series is Analytics V1's own (it includes purchases that carry no branch). Best effort — the page works without it.
    if (!branchId) {
      fetchAnalyticsOverview({ period, startDate: startDate || undefined, endDate: endDate || undefined })
        .then((a) => {
          if (!cancelled) setAllDays(a.revenueByDay.map((d) => ({ date: d.date, value: d.revenue })));
        })
        .catch(() => {
          if (!cancelled) setAllDays(null);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [period, branchId, startDate, endDate, customReady]);

  useEffect(() => load(), [load, reloadKey]);

  const branches = data?.filters.branches ?? [];
  const detail = data?.detail ?? null;
  const selectedCard = data?.branch ? data.branches.find((b) => b.branchId === data.branch!.id) ?? null : null;

  return (
    <div className="analytics growth bi">
      <PageHeader description={findNav('branch-intelligence').item.description} title={findNav('branch-intelligence').item.label} />
      <FilterBar>
          <FilterField label="Period"><select aria-label="Period" className="select" onChange={(e) => setPeriod(e.target.value as AnalyticsPeriodKey)} value={period}>
            {PERIODS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select></FilterField>
          <FilterField label="Branch"><select aria-label="Branch" className="select bi__branch-select" onChange={(e) => setBranchId(e.target.value)} value={branchId}>
            <option value="">All branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
                {b.isActive ? '' : ' (inactive)'}
              </option>
            ))}
          </select></FilterField>
        </FilterBar>

      {period === 'custom' && (
        <div className="analytics__custom">
          <label>
            From <input onChange={(e) => setStartDate(e.target.value)} type="date" value={startDate} />
          </label>
          <label>
            To <input onChange={(e) => setEndDate(e.target.value)} type="date" value={endDate} />
          </label>
          {!customReady && <span className="analytics__note">Choose a start date that is not after the end date (up to 366 days).</span>}
        </div>
      )}

      {data && !error && (
        <p className="analytics__range">
          {data.period.startDate === data.period.endDate ? data.period.startDate : `${data.period.startDate} → ${data.period.endDate}`}
          {data.branch ? ` · ${data.branch.name}${data.branch.isActive ? '' : ' (inactive)'}` : ' · All branches'}
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

      {!data && !error && customReady && <Skeleton />}

      {data && !error && (
        <div className={`analytics__body${loading ? ' analytics__body--loading' : ''}`}>
          <Kpis data={data} card={selectedCard} />

          <BranchTable branches={data.branches} selectedId={data.branch?.id ?? null} onSelect={setBranchId} />

          <section className="analytics__panel" aria-label="Daily revenue and orders">
            <h2 className="analytics__h2">{detail ? 'Daily revenue and orders' : 'Daily revenue'}</h2>
            {detail ? (
              <div className="bi__charts">
                <DayBars title="Revenue" days={detail.revenue.byDay} format={formatSom} tone="terracotta" />
                <DayBars title="Orders" days={detail.orders.byDay} format={number} tone="black" />
              </div>
            ) : allDays ? (
              <>
                <DayBars title="Revenue, all branches" days={allDays} format={formatSom} tone="terracotta" />
                <p className="analytics__note">Daily revenue of the whole business (includes purchases that carry no branch). Choose a branch above for its daily revenue, orders and customers.</p>
              </>
            ) : (
              <p className="analytics__empty">Choose a branch above to see its daily revenue and orders.</p>
            )}
          </section>

          {detail && data.branch ? <Detail data={data} detail={detail} /> : <AllBranchesNotes data={data} />}

          <Definitions definitions={data.definitions} />
        </div>
      )}
    </div>
  );
}

function Kpis({ data, card }: { data: BranchIntelligenceOverview; card: BranchCard | null }) {
  const s = data.summary;
  const branch = card !== null;
  const revenue = branch ? card.revenueMinor : s.revenueMinor;
  const orders = branch ? card.orders : s.orders;
  const customers = branch ? card.customers : s.customers;
  const average = branch ? card.averageOrderMinor : s.averageOrderMinor;
  const fresh = branch ? card.newCustomers : s.newCustomers;
  const returning = branch ? card.returningCustomers : s.returningCustomers;
  return (
    <section className="analytics__kpis bi__kpis" aria-label="Key figures">
      <Kpi label="Revenue" value={formatSom(revenue)} hint={branch ? `${percent(card.revenueSharePercent)} of branch revenue` : undefined} strong />
      <Kpi label="Orders" value={number(orders)} hint={branch ? `${percent(card.orderSharePercent)} of branch orders` : undefined} />
      <Kpi label="Customers" value={number(customers)} />
      <Kpi label="Average check" value={formatSom(average)} />
      <Kpi label="New customers" value={number(fresh)} hint="First purchase ever, in this period" />
      <Kpi label="Returning customers" value={number(returning)} hint={customers > 0 ? `${percent(Math.round((returning / customers) * 1000) / 10)} of customers` : undefined} />
    </section>
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

// Side-by-side figures, listed by branch name. No ranking column, no sorting by performance, no highlighting of a "best" or "worst" branch.
function BranchTable({ branches, selectedId, onSelect }: { branches: BranchCard[]; selectedId: string | null; onSelect: (id: string) => void }) {
  return (
    <section className="analytics__panel" aria-label="Branch comparison">
      <h2 className="analytics__h2">Branch comparison</h2>
      {branches.length === 0 ? (
        <p className="analytics__empty">{EMPTY}</p>
      ) : (
        <div className="c360__scroll">
          <table className="analytics__table bi__table">
            <thead>
              <tr>
                <th>Branch</th>
                <th className="analytics__num">Revenue</th>
                <th className="analytics__num">Share</th>
                <th className="analytics__num">Orders</th>
                <th className="analytics__num">Customers</th>
                <th className="analytics__num">Avg check</th>
                <th className="analytics__num">New</th>
                <th className="analytics__num">Returning</th>
                <th className="analytics__num">Active days</th>
                <th>Last purchase</th>
                <th aria-label="Open" />
              </tr>
            </thead>
            <tbody>
              {branches.map((b) => (
                <tr className={b.branchId === selectedId ? 'bi__row--selected' : undefined} key={b.branchId}>
                  <td className="bi__name">
                    {b.branchName}
                    {!b.isActive && <span className="growth__badge bi__badge">Inactive</span>}
                  </td>
                  <td className="analytics__num">{formatSom(b.revenueMinor)}</td>
                  <td className="analytics__num">{percent(b.revenueSharePercent)}</td>
                  <td className="analytics__num">{number(b.orders)}</td>
                  <td className="analytics__num">{number(b.customers)}</td>
                  <td className="analytics__num">{formatSom(b.averageOrderMinor)}</td>
                  <td className="analytics__num">{number(b.newCustomers)}</td>
                  <td className="analytics__num">{number(b.returningCustomers)}</td>
                  <td className="analytics__num">{number(b.activeDays)}</td>
                  <td>{b.lastPurchaseAt ? formatDate(b.lastPurchaseAt) : '—'}</td>
                  <td>
                    <button className="bi__open" disabled={b.branchId === selectedId} onClick={() => onSelect(b.branchId)} type="button">
                      {b.branchId === selectedId ? 'Selected' : 'Details'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="analytics__note" style={{ marginBottom: 0 }}>
        Branches are listed by name. Share = the branch&apos;s part of the revenue of all branches with a mapped purchase. Inactive branches appear only when they had activity in the period.
      </p>
    </section>
  );
}

// Only relevant to the all-branches view: money and customers that cannot be tied to a branch stay in the totals and nowhere else.
function AllBranchesNotes({ data }: { data: BranchIntelligenceOverview }) {
  const s = data.summary;
  return (
    <>
      <div className="analytics__two">
        <section className="analytics__panel" aria-label="Sales source">
          <h2 className="analytics__h2">Sales source</h2>
          <Sources cup={s.sources.cup} pos={s.sources.pos} />
        </section>
        <section className="analytics__panel analytics__panel--cream" aria-label="Purchases without a branch">
          <h2 className="analytics__h2">Not tied to a branch</h2>
          <div className="analytics__split">
            <Figure label="Orders" value={number(s.unmapped.orders)} />
            <Figure label="Revenue" value={formatSom(s.unmapped.revenueMinor)} />
          </div>
          <p className="analytics__note" style={{ marginBottom: 0 }}>
            Purchases with no branch (for example a POS spot that is not mapped to a branch) count in the totals above, never in a branch row. {number(s.mapped.branchesWithActivity)} branches had activity in this period.
          </p>
        </section>
      </div>
      <p className="analytics__note">Choose a branch (or press Details in the table) for customer behavior, products, loyalty &amp; rewards, growth and the branch overview.</p>
    </>
  );
}

function Detail({ data, detail }: { data: BranchIntelligenceOverview; detail: BranchDetail }) {
  const v1 = detail.customers.analyticsV1;
  const differs = v1.newCustomers !== detail.customers.new;
  const cb = detail.crossBranch;
  return (
    <>
      <section className="analytics__panel" aria-label="Customer behavior">
        <h2 className="analytics__h2">Customer behavior</h2>
        <div className="analytics__two">
          <div>
            <div className="analytics__split">
              <Figure label="New customers" value={number(detail.customers.new)} />
              <Figure label="Returning customers" value={number(detail.customers.returning)} />
            </div>
            <p className="analytics__note">
              {number(detail.customers.unique)} unique customers · returning rate {percent(detail.retention.returningRatePercent)}. New = first purchase ever happened here in this period.
              {differs && ` Analytics V1 counts ${number(v1.newCustomers)} new / ${number(v1.returningCustomers)} returning for the same period and branch (new = no sale anywhere before the period).`}
            </p>
            <DayBars title="Customers per day" days={detail.customers.byDay} format={number} tone="black" />
          </div>
          <div>
            <h3 className="bi__h3">Retention</h3>
            <dl className="bi__facts">
              <Fact label="Customers with 2+ purchases" value={number(detail.retention.customersWith2PlusPurchases)} hint={percent(detail.retention.repeatCustomerRatePercent)} />
              <Fact label="Customers with 3+ purchases" value={number(detail.retention.customersWith3PlusPurchases)} />
              <Fact label="Repeat purchases" value={number(detail.retention.repeatPurchases)} />
              <Fact label="Active days" value={`${number(detail.activity.activeDays)} of ${number(detail.activity.periodDays)}`} />
              <Fact label="Last purchase" value={detail.activity.lastPurchaseAt ? formatDate(detail.activity.lastPurchaseAt) : '—'} />
            </dl>
            <h3 className="bi__h3">Cross-branch purchasing</h3>
            <dl className="bi__facts">
              <Fact label="Purchased only at this branch" value={number(cb.purchasedOnlyHere)} />
              <Fact label="Purchased at 2+ branches" value={number(cb.purchasedAtTwoOrMoreBranches)} />
              <Fact label="Latest purchase was here" value={number(cb.latestPurchaseWasHere)} />
              <Fact label="Purchase here followed another branch" value={number(cb.purchaseDirectlyFollowedAnotherBranch)} />
            </dl>
            <p className="analytics__note" style={{ marginBottom: 0 }}>
              Read from purchase records only — it does not say where a customer physically went.
            </p>
          </div>
        </div>
      </section>

      <section className="analytics__panel" aria-label="Product intelligence">
        <h2 className="analytics__h2">Product intelligence</h2>
        <div className="analytics__two">
          <ProductTable title="Top by quantity" rows={detail.products.topByQuantity} />
          <ProductTable title="Top by revenue" rows={detail.products.topByRevenue} />
        </div>
        <div className="analytics__two" style={{ marginTop: 20 }}>
          <div>
            <h3 className="bi__h3">Categories</h3>
            {detail.products.categories.length === 0 ? (
              <p className="analytics__empty">{EMPTY}</p>
            ) : (
              <div className="growth__bars">
                {detail.products.categories.slice(0, 8).map((c) => (
                  <div className="growth__bar-row bi__cat-row" key={c.name}>
                    <span className="growth__bar-label bi__cat-label" title={c.name}>
                      {c.name}
                    </span>
                    <span className="growth__bar-track">
                      <span className="growth__bar-fill" style={{ width: `${Math.min(100, c.revenueSharePercent)}%` }} />
                    </span>
                    <span className="growth__bar-num">{percent(c.revenueSharePercent)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            <h3 className="bi__h3">CUP orders vs POS purchases</h3>
            <Sources cup={detail.sources.cup} pos={detail.sources.pos} />
          </div>
        </div>
        <p className="analytics__note" style={{ marginBottom: 0 }}>
          From stored order and imported POS lines only (Poster is never called). Lines without a mapped product are not counted.
        </p>
      </section>

      <section className="analytics__panel" aria-label="Loyalty and rewards">
        <h2 className="analytics__h2">Loyalty &amp; rewards</h2>
        <div className="analytics__two">
          <div>
            <h3 className="bi__h3">Loyalty</h3>
            <dl className="bi__facts">
              <Fact label="Customers with a loyalty account" value={number(detail.loyalty.customersWithLoyaltyAccount)} />
              <Fact label="Loyalty 2.0 members (purchased here)" value={number(detail.loyalty.loyalty2.members)} />
              <Fact label="Purchases accrued (Loyalty 2.0)" value={number(detail.loyalty.loyalty2.purchasesAccrued)} />
              <Fact label="Points awarded (Loyalty 2.0)" value={number(detail.loyalty.loyalty2.pointsAwarded)} />
              <Fact label="Cashback earned" value={formatSom(detail.loyalty.loyalty2.cashbackEarnedMinor)} />
              <Fact label="Points earned on orders here" value={number(detail.loyalty.pointsLedger.attributed.earned)} />
              <Fact label="Points spent on orders here" value={number(detail.loyalty.pointsLedger.attributed.spent)} />
            </dl>
            <p className="analytics__note" style={{ marginBottom: 0 }}>
              Points with no order behind them ({number(detail.loyalty.pointsLedger.unattributed.rows)} entries, {number(detail.loyalty.pointsLedger.unattributed.earned)} earned / {number(detail.loyalty.pointsLedger.unattributed.spent)} spent, all branches) are not assigned to any branch.
            </p>
          </div>
          <div>
            <h3 className="bi__h3">Rewards</h3>
            <dl className="bi__facts">
              <Fact label="Customers with a reward available" value={number(detail.rewards.customersWithRewardAvailable)} hint="customer-level, today" />
              <Fact label="Rewards available" value={number(detail.rewards.rewardsAvailable)} />
              <Fact label="Redeemed at this branch" value={number(detail.rewards.redemptionsAtBranch)} />
              <Fact label="Redemptions with no order (all branches)" value={number(detail.rewards.unattributedRedemptions)} />
            </dl>
            <NamedCounts rows={detail.rewards.redemptionsByProgram} />
            <h3 className="bi__h3">Promotions</h3>
            <dl className="bi__facts">
              <Fact label="Promotion redemptions here" value={number(detail.promotions.redemptionsAtBranch)} />
              <Fact label="Redemptions with no order (all branches)" value={number(detail.promotions.unattributedRedemptions)} />
            </dl>
            <NamedCounts rows={detail.promotions.redemptionsByPromotion} />
            <h3 className="bi__h3">Referrals</h3>
            <dl className="bi__facts">
              <Fact label="Qualified through a purchase here" value={number(detail.referrals.qualifiedAtBranch)} />
              <Fact label="Of which rewarded" value={number(detail.referrals.rewardedAtBranch)} />
              <Fact label="Qualified elsewhere / unattributed" value={number(detail.referrals.qualifiedElsewhereOrUnattributed)} />
            </dl>
          </div>
        </div>
      </section>

      <GrowthBlock growth={detail.growth} />

      <section className="analytics__panel analytics__panel--cream" aria-label="Branch overview">
        <h2 className="analytics__h2">Branch overview — {data.branch?.name}</h2>
        <div className="bi__snapshot">
          <Figure label="Revenue" value={formatSom(detail.overview.revenueMinor)} />
          <Figure label="Orders" value={number(detail.overview.orders)} />
          <Figure label="Customers" value={number(detail.overview.customers)} />
          <Figure label="Average check" value={formatSom(detail.overview.averageOrderMinor)} />
          <Figure label="Returning rate" value={percent(detail.overview.returningRatePercent)} />
          <Figure label="CUP / POS revenue" value={`${percent(detail.overview.cupRevenueSharePercent)} / ${percent(detail.overview.posRevenueSharePercent)}`} />
          <Figure label="Top category" value={detail.overview.topCategory ? detail.overview.topCategory.name : '—'} small />
          <Figure label="Top product" value={detail.overview.topProduct ? detail.overview.topProduct.name : '—'} small />
          <Figure label="Growth opportunities" value={number(detail.overview.opportunityCount)} />
        </div>
        <p className="analytics__note" style={{ marginBottom: 0 }}>
          A factual snapshot of the figures above — not a score or a rating.
        </p>
      </section>
    </>
  );
}

// Phase 15 rules, computed from this branch's purchases only. As of today with the configured lookback — it does not follow the period filter.
function GrowthBlock({ growth }: { growth: BranchDetail['growth'] }) {
  const total = growth.lifecycle.total;
  return (
    <section className="analytics__panel" aria-label="Growth intelligence">
      <h2 className="analytics__h2">Growth intelligence</h2>
      <p className="analytics__note" style={{ marginTop: 0 }}>
        As of {formatDate(growth.asOf)}, last {number(growth.lookbackDays)} days — customers of this branch by the same rules and thresholds as Growth Intelligence. It does not follow the period filter.
      </p>
      <div className="analytics__two">
        <div>
          <h3 className="bi__h3">Lifecycle</h3>
          {total === 0 ? (
            <p className="analytics__empty">{EMPTY}</p>
          ) : (
            <div className="growth__bars">
              {LIFECYCLE_STATES.map((s) => {
                const n = growth.lifecycle.counts[s];
                const pct = total > 0 ? (n / total) * 100 : 0;
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
        </div>
        <div>
          <h3 className="bi__h3">RFM</h3>
          <RfmMatrix matrix={growth.rfm.matrix} />
          {growth.rfm.topScores.length > 0 && (
            <p className="analytics__note" style={{ marginBottom: 0 }}>
              Most common scores: {growth.rfm.topScores.map((t) => `${t.score} (${number(t.customers)})`).join(' · ')}
            </p>
          )}
        </div>
      </div>
      <h3 className="bi__h3">Signals</h3>
      <div className="growth__chips">
        {SIGNAL_TYPES.map((t) => (
          <span className="growth__chip" key={t}>
            {SIGNAL_LABELS[t]} <strong>{number(growth.signals[t])}</strong>
          </span>
        ))}
      </div>
      <h3 className="bi__h3">Opportunities</h3>
      <div className="c360__scroll">
        <table className="analytics__table">
          <thead>
            <tr>
              <th>Type</th>
              <th className="analytics__num">Customers</th>
              <th className="analytics__num">High</th>
              <th className="analytics__num">Medium</th>
              <th className="analytics__num">Low</th>
            </tr>
          </thead>
          <tbody>
            {OPPORTUNITY_TYPES.map((t) => {
              const c = growth.opportunities.counts[t];
              return (
                <tr key={t}>
                  <td>{OPPORTUNITY_LABELS[t]}</td>
                  <td className="analytics__num">{number(c.total)}</td>
                  <td className="analytics__num">{number(c.HIGH)}</td>
                  <td className="analytics__num">{number(c.MEDIUM)}</td>
                  <td className="analytics__num">{number(c.LOW)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {growth.opportunities.top.length > 0 && (
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
              {growth.opportunities.top.map((o, i) => (
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
        Suggestions for existing Segments and CRM Automations; nothing is sent from here.
      </p>
    </section>
  );
}

function Sources({ cup, pos }: { cup: SourceSlice; pos: SourceSlice }) {
  const row = (label: string, s: SourceSlice) => (
    <div className="analytics__source">
      <div className="analytics__label">{label}</div>
      <div className="analytics__source-value">{number(s.orders)}</div>
      <div className="analytics__hint">
        {formatSom(s.revenueMinor)} · {percent(s.revenueSharePercent)} of revenue
      </div>
      <div className="analytics__hint">{number(s.customers)} customers</div>
    </div>
  );
  return (
    <div className="analytics__sources">
      {row('CUP orders', cup)}
      {row('POS purchases', pos)}
    </div>
  );
}

function ProductTable({ title, rows }: { title: string; rows: ProductLine[] }) {
  return (
    <div>
      <h3 className="bi__h3">{title}</h3>
      {rows.length === 0 ? (
        <p className="analytics__empty">{EMPTY}</p>
      ) : (
        <div className="c360__scroll">
          <table className="analytics__table">
            <thead>
              <tr>
                <th>Product</th>
                <th className="analytics__num">Qty</th>
                <th className="analytics__num">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={`${p.name}-${p.category}`}>
                  <td className="bi__name">
                    {p.name}
                    <span className="analytics__hint bi__sub">{p.category}</span>
                  </td>
                  <td className="analytics__num">{number(p.quantity)}</td>
                  <td className="analytics__num">{formatSom(p.revenueMinor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function NamedCounts({ rows }: { rows: { name: string; count: number }[] }) {
  if (rows.length === 0) return null;
  return (
    <ul className="bi__list">
      {rows.map((r) => (
        <li key={r.name}>
          <span className="bi__name">{r.name}</span>
          <strong>{number(r.count)}</strong>
        </li>
      ))}
    </ul>
  );
}

function Figure({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="bi__figure">
      <div className="analytics__label">{label}</div>
      <div className={small ? 'bi__figure-value bi__figure-value--small' : 'analytics__big bi__figure-value'}>{value}</div>
    </div>
  );
}

function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bi__fact">
      <dt>{label}</dt>
      <dd>
        {value}
        {hint && <span className="analytics__hint"> · {hint}</span>}
      </dd>
    </div>
  );
}

function Definitions({ definitions }: { definitions: Record<string, string> }) {
  const labels: [string, string][] = [
    ['purchase', 'What counts as a purchase'],
    ['branchAttribution', 'How a purchase is tied to a branch'],
    ['newCustomer', 'New customer'],
    ['returningCustomer', 'Returning customer'],
    ['analyticsNew', 'Analytics V1 “new”'],
    ['crossBranch', 'Cross-branch purchasing'],
    ['shares', 'Shares'],
    ['activeDays', 'Active days'],
    ['growth', 'Growth intelligence'],
    ['loyaltyAttribution', 'Loyalty, rewards, promotions'],
  ];
  return (
    <details className="analytics__panel bi__defs">
      <summary className="analytics__h2 bi__defs-summary">Definitions</summary>
      <dl className="bi__def-list">
        {labels
          .filter(([key]) => definitions[key])
          .map(([key, label]) => (
            <div key={key}>
              <dt>{label}</dt>
              <dd>{definitions[key]}</dd>
            </div>
          ))}
      </dl>
    </details>
  );
}

// Lightweight SVG bar chart — no chart library. One bar per business day (zero days are kept, so a quiet day is visible as an empty slot).
function DayBars({ title, days, format, tone }: { title: string; days: DayValue[]; format: (n: number) => string; tone: 'terracotta' | 'black' }) {
  const max = Math.max(...days.map((d) => d.value), 0);
  const total = days.reduce((n, d) => n + d.value, 0);
  const width = 640;
  const height = 150;
  const gap = days.length > 45 ? 1 : 4;
  const barWidth = Math.max(2, (width - gap * (days.length - 1)) / Math.max(1, days.length));
  return (
    <div className="bi__chart">
      <div className="bi__chart-head">
        <span className="analytics__label">{title}</span>
        <span className="analytics__hint">Total {format(total)}</span>
      </div>
      <svg className="analytics__chart bi__svg" role="img" aria-label={`${title} by day`} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <line className="bi__baseline" x1="0" x2={width} y1={height - 0.5} y2={height - 0.5} />
        {days.map((d, i) => {
          const h = d.value === 0 || max === 0 ? 0 : Math.max(2, (d.value / max) * (height - 8));
          return (
            <rect key={d.date} className={`bi__bar bi__bar--${tone}`} x={i * (barWidth + gap)} y={height - h} width={barWidth} height={h}>
              <title>{`${d.date}: ${format(d.value)}`}</title>
            </rect>
          );
        })}
      </svg>
      <div className="analytics__axis">
        <span>{days[0]?.date}</span>
        {max === 0 && <span>No purchases in this period</span>}
        <span>{days[days.length - 1]?.date}</span>
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="analytics__body" aria-busy="true">
      <section className="analytics__kpis bi__kpis">
        {[0, 1, 2, 3, 4, 5].map((n) => (
          <div className="analytics__kpi analytics__skeleton" key={n} style={{ height: 88 }} />
        ))}
      </section>
      <div className="analytics__panel analytics__skeleton" style={{ height: 240 }} />
      <div className="analytics__panel analytics__skeleton" style={{ height: 200 }} />
    </div>
  );
}
