import { useCallback, useEffect, useState } from 'react';
import { fetchAnalyticsOverview } from '../lib/adminAnalytics';
import { BranchCard, BranchDetail, BranchIntelligenceOverview, DayValue, fetchBranchIntelligence, ProductLine, SourceSlice } from '../lib/adminBranchIntelligence';
import { LIFECYCLE_LABELS, LIFECYCLE_STATES, OPPORTUNITY_LABELS, OPPORTUNITY_TYPES, Priority, SIGNAL_LABELS, SIGNAL_TYPES } from '../lib/adminGrowth';
import { ApiError } from '../lib/api';
import { formatDate, formatSom } from '../lib/format';
import { AnalyticsPeriodKey } from '../lib/types';
import { RfmMatrix } from './GrowthPage';
import { findNav } from '../lib/nav';
import { Button, cx, DataTable, EmptyState, ErrorState, FilterBar, FilterField, Input, LoadingState, PageHeader, SectionCard, Select, StatCard, StatGrid } from '../ui';

const PERIODS: { key: AnalyticsPeriodKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'last7', label: 'Last 7 days' },
  { key: 'last30', label: 'Last 30 days' },
  { key: 'custom', label: 'Custom' },
];

const PRIORITY_TONE: Record<Priority, string> = {
  HIGH: 'bg-terracotta text-white border-terracotta',
  MEDIUM: 'bg-cream border-transparent',
  LOW: 'border-line',
};
const LIFECYCLE_FILL: Record<(typeof LIFECYCLE_STATES)[number], string> = {
  NEW: 'bg-terracotta',
  ACTIVE: 'bg-terracotta-deep',
  LOYAL: 'bg-terracotta',
  AT_RISK: 'bg-[#d9a441]',
  DORMANT: 'bg-[#8b857c]',
  CHURNED: 'bg-black',
};
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
  const selectedCard = data?.branch ? (data.branches.find((b) => b.branchId === data.branch!.id) ?? null) : null;

  return (
    <div>
      <PageHeader description={findNav('branch-intelligence').item.description} title={findNav('branch-intelligence').item.label} />
      <FilterBar>
        <FilterField label="Period">
          <Select aria-label="Period" onChange={(e) => setPeriod(e.target.value as AnalyticsPeriodKey)} value={period}>
            {PERIODS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </Select>
        </FilterField>
        <FilterField label="Branch">
          <Select aria-label="Branch" className="max-w-[260px] max-[760px]:max-w-full" onChange={(e) => setBranchId(e.target.value)} value={branchId}>
            <option value="">All branches</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
                {b.isActive ? '' : ' (inactive)'}
              </option>
            ))}
          </Select>
        </FilterField>
        {period === 'custom' && (
          <>
            <FilterField label="From">
              <Input onChange={(e) => setStartDate(e.target.value)} type="date" value={startDate} />
            </FilterField>
            <FilterField label="To">
              <Input onChange={(e) => setEndDate(e.target.value)} type="date" value={endDate} />
            </FilterField>
            {!customReady && <span className="self-center text-[13px] text-err">Choose a start date that is not after the end date (up to 366 days).</span>}
          </>
        )}
      </FilterBar>

      {data && !error && (
        <p className="mb-5 text-[13px] font-semibold tracking-[0.02em] text-muted">
          {data.period.startDate === data.period.endDate ? data.period.startDate : `${data.period.startDate} → ${data.period.endDate}`}
          {data.branch ? ` · ${data.branch.name}${data.branch.isActive ? '' : ' (inactive)'}` : ' · All branches'}
          {loading && <span> · updating…</span>}
        </p>
      )}

      {error && <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} title="The figures could not be loaded" />}
      {!data && !error && customReady && <LoadingState variant="page" />}

      {data && !error && (
        <div className={cx('flex min-w-0 flex-col gap-5 transition-opacity duration-200', loading && 'opacity-60')}>
          <Kpis card={selectedCard} data={data} />

          <BranchTable branches={data.branches} onSelect={setBranchId} selectedId={data.branch?.id ?? null} />

          <SectionCard aria-label="Daily revenue and orders" title={detail ? 'Daily revenue and orders' : 'Daily revenue'}>
            {detail ? (
              <div className="flex flex-col gap-[18px]">
                <DayBars days={detail.revenue.byDay} format={formatSom} title="Revenue" tone="terracotta" />
                <DayBars days={detail.orders.byDay} format={number} title="Orders" tone="black" />
              </div>
            ) : allDays ? (
              <>
                <DayBars days={allDays} format={formatSom} title="Revenue, all branches" tone="terracotta" />
                <p className="mt-4 text-[13px] leading-snug text-muted">Daily revenue of the whole business (includes purchases that carry no branch). Choose a branch above for its daily revenue, orders and customers.</p>
              </>
            ) : (
              <EmptyState text="Choose a branch above to see its daily revenue and orders." title="No branch selected" variant="inline" />
            )}
          </SectionCard>

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
    <StatGrid>
      <StatCard hint={branch ? `${percent(card.revenueSharePercent)} of branch revenue` : undefined} label="Revenue" strong value={formatSom(revenue)} />
      <StatCard hint={branch ? `${percent(card.orderSharePercent)} of branch orders` : undefined} label="Orders" value={number(orders)} />
      <StatCard label="Customers" value={number(customers)} />
      <StatCard label="Average check" value={formatSom(average)} />
      <StatCard hint="First purchase ever, in this period" label="New customers" value={number(fresh)} />
      <StatCard hint={customers > 0 ? `${percent(Math.round((returning / customers) * 1000) / 10)} of customers` : undefined} label="Returning customers" value={number(returning)} />
    </StatGrid>
  );
}

// Side-by-side figures, listed by branch name. No ranking column, no sorting by performance, no highlighting of a "best" or "worst" branch.
function BranchTable({ branches, selectedId, onSelect }: { branches: BranchCard[]; selectedId: string | null; onSelect: (id: string) => void }) {
  return (
    <SectionCard aria-label="Branch comparison" flush={branches.length > 0} title="Branch comparison">
      {branches.length === 0 ? (
        <EmptyState text={EMPTY} title="No data" variant="inline" />
      ) : (
        <DataTable
          boxed
          columns={[
            {
              key: 'name',
              header: 'Branch',
              cell: (b) => (
                <span className="block max-w-[240px] [overflow-wrap:anywhere]">
                  {b.branchName}
                  {!b.isActive && <span className="ml-2 inline-block rounded-full bg-[#efe9df] px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap">Inactive</span>}
                </span>
              ),
            },
            { key: 'revenue', header: 'Revenue', numeric: true, cell: (b) => formatSom(b.revenueMinor) },
            { key: 'share', header: 'Share', numeric: true, low: true, cell: (b) => percent(b.revenueSharePercent) },
            { key: 'orders', header: 'Orders', numeric: true, cell: (b) => number(b.orders) },
            { key: 'customers', header: 'Customers', numeric: true, cell: (b) => number(b.customers) },
            { key: 'avg', header: 'Avg check', numeric: true, low: true, cell: (b) => formatSom(b.averageOrderMinor) },
            { key: 'new', header: 'New', numeric: true, low: true, cell: (b) => number(b.newCustomers) },
            { key: 'returning', header: 'Returning', numeric: true, low: true, cell: (b) => number(b.returningCustomers) },
            { key: 'activeDays', header: 'Active days', numeric: true, low: true, cell: (b) => number(b.activeDays) },
            { key: 'last', header: 'Last purchase', low: true, cell: (b) => (b.lastPurchaseAt ? formatDate(b.lastPurchaseAt) : '—') },
            {
              key: 'actions',
              header: '',
              actions: true,
              cell: (b) => (
                <Button disabled={b.branchId === selectedId} onClick={() => onSelect(b.branchId)} size="sm" variant="secondary">
                  {b.branchId === selectedId ? 'Selected' : 'Details'}
                </Button>
              ),
            },
          ]}
          rowClassName={(b) => (b.branchId === selectedId ? 'bg-cream/45' : undefined)}
          rowKey={(b) => b.branchId}
          rows={branches}
        />
      )}
      <p className="mt-4 mb-0 px-6 pb-5 text-[13px] leading-snug text-muted first:px-0 first:pb-0">
        Branches are listed by name. Share = the branch&apos;s part of the revenue of all branches with a mapped purchase. Inactive branches appear only when they had activity in the period.
      </p>
    </SectionCard>
  );
}

// Only relevant to the all-branches view: money and customers that cannot be tied to a branch stay in the totals and nowhere else.
function AllBranchesNotes({ data }: { data: BranchIntelligenceOverview }) {
  const s = data.summary;
  return (
    <>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <SectionCard aria-label="Sales source" title="Sales source">
          <Sources cup={s.sources.cup} pos={s.sources.pos} />
        </SectionCard>
        <SectionCard aria-label="Purchases without a branch" tone="cream" title="Not tied to a branch">
          <div className="grid grid-cols-2 gap-4">
            <Figure label="Orders" value={number(s.unmapped.orders)} />
            <Figure label="Revenue" value={formatSom(s.unmapped.revenueMinor)} />
          </div>
          <p className="mt-4 mb-0 text-[13px] leading-snug text-muted">
            Purchases with no branch (for example a POS spot that is not mapped to a branch) count in the totals above, never in a branch row. {number(s.mapped.branchesWithActivity)} branches had activity in this period.
          </p>
        </SectionCard>
      </div>
      <p className="text-[13px] leading-snug text-muted">Choose a branch (or press Details in the table) for customer behavior, products, loyalty &amp; rewards, growth and the branch overview.</p>
    </>
  );
}

function Detail({ data, detail }: { data: BranchIntelligenceOverview; detail: BranchDetail }) {
  const v1 = detail.customers.analyticsV1;
  const differs = v1.newCustomers !== detail.customers.new;
  const cb = detail.crossBranch;
  return (
    <>
      <SectionCard aria-label="Customer behavior" title="Customer behavior">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <div>
            <div className="grid grid-cols-2 gap-4">
              <Figure label="New customers" value={number(detail.customers.new)} />
              <Figure label="Returning customers" value={number(detail.customers.returning)} />
            </div>
            <p className="my-4 text-[13px] leading-snug text-muted">
              {number(detail.customers.unique)} unique customers · returning rate {percent(detail.retention.returningRatePercent)}. New = first purchase ever happened here in this period.
              {differs && ` Analytics V1 counts ${number(v1.newCustomers)} new / ${number(v1.returningCustomers)} returning for the same period and branch (new = no sale anywhere before the period).`}
            </p>
            <DayBars days={detail.customers.byDay} format={number} title="Customers per day" tone="black" />
          </div>
          <div>
            <SubHeading>Retention</SubHeading>
            <Facts>
              <Fact hint={percent(detail.retention.repeatCustomerRatePercent)} label="Customers with 2+ purchases" value={number(detail.retention.customersWith2PlusPurchases)} />
              <Fact label="Customers with 3+ purchases" value={number(detail.retention.customersWith3PlusPurchases)} />
              <Fact label="Repeat purchases" value={number(detail.retention.repeatPurchases)} />
              <Fact label="Active days" value={`${number(detail.activity.activeDays)} of ${number(detail.activity.periodDays)}`} />
              <Fact label="Last purchase" value={detail.activity.lastPurchaseAt ? formatDate(detail.activity.lastPurchaseAt) : '—'} />
            </Facts>
            <SubHeading>Cross-branch purchasing</SubHeading>
            <Facts>
              <Fact label="Purchased only at this branch" value={number(cb.purchasedOnlyHere)} />
              <Fact label="Purchased at 2+ branches" value={number(cb.purchasedAtTwoOrMoreBranches)} />
              <Fact label="Latest purchase was here" value={number(cb.latestPurchaseWasHere)} />
              <Fact label="Purchase here followed another branch" value={number(cb.purchaseDirectlyFollowedAnotherBranch)} />
            </Facts>
            <p className="mt-4 mb-0 text-[13px] leading-snug text-muted">Read from purchase records only — it does not say where a customer physically went.</p>
          </div>
        </div>
      </SectionCard>

      <SectionCard aria-label="Product intelligence" title="Product intelligence">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <ProductTable rows={detail.products.topByQuantity} title="Top by quantity" />
          <ProductTable rows={detail.products.topByRevenue} title="Top by revenue" />
        </div>
        <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
          <div>
            <SubHeading>Categories</SubHeading>
            {detail.products.categories.length === 0 ? (
              <EmptyState text={EMPTY} title="No data" variant="inline" />
            ) : (
              <div className="flex flex-col gap-2.5">
                {detail.products.categories.slice(0, 8).map((c) => (
                  <div className="grid grid-cols-[minmax(70px,130px)_1fr_64px] items-center gap-2.5 text-sm" key={c.name}>
                    <span className="overflow-hidden text-ellipsis whitespace-nowrap" title={c.name}>
                      {c.name}
                    </span>
                    <span className="h-3.5 overflow-hidden rounded-md bg-black/[0.06]">
                      <span className="block h-full min-w-0.5 bg-black" style={{ width: `${Math.min(100, c.revenueSharePercent)}%` }} />
                    </span>
                    <span className="text-right whitespace-nowrap tabular-nums text-muted">{percent(c.revenueSharePercent)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            <SubHeading>CUP orders vs POS purchases</SubHeading>
            <Sources cup={detail.sources.cup} pos={detail.sources.pos} />
          </div>
        </div>
        <p className="mt-4 mb-0 text-[13px] leading-snug text-muted">From stored order and imported POS lines only (Poster is never called). Lines without a mapped product are not counted.</p>
      </SectionCard>

      <SectionCard aria-label="Loyalty and rewards" title="Loyalty &amp; rewards">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <div>
            <SubHeading>Loyalty</SubHeading>
            <Facts>
              <Fact label="Customers with a loyalty account" value={number(detail.loyalty.customersWithLoyaltyAccount)} />
              <Fact label="Loyalty 2.0 members (purchased here)" value={number(detail.loyalty.loyalty2.members)} />
              <Fact label="Purchases accrued (Loyalty 2.0)" value={number(detail.loyalty.loyalty2.purchasesAccrued)} />
              <Fact label="Points awarded (Loyalty 2.0)" value={number(detail.loyalty.loyalty2.pointsAwarded)} />
              <Fact label="Cashback earned" value={formatSom(detail.loyalty.loyalty2.cashbackEarnedMinor)} />
              <Fact label="Points earned on orders here" value={number(detail.loyalty.pointsLedger.attributed.earned)} />
              <Fact label="Points spent on orders here" value={number(detail.loyalty.pointsLedger.attributed.spent)} />
            </Facts>
            <p className="mt-4 mb-0 text-[13px] leading-snug text-muted">
              Points with no order behind them ({number(detail.loyalty.pointsLedger.unattributed.rows)} entries, {number(detail.loyalty.pointsLedger.unattributed.earned)} earned / {number(detail.loyalty.pointsLedger.unattributed.spent)} spent, all branches) are not assigned to any branch.
            </p>
          </div>
          <div>
            <SubHeading>Rewards</SubHeading>
            <Facts>
              <Fact hint="customer-level, today" label="Customers with a reward available" value={number(detail.rewards.customersWithRewardAvailable)} />
              <Fact label="Rewards available" value={number(detail.rewards.rewardsAvailable)} />
              <Fact label="Redeemed at this branch" value={number(detail.rewards.redemptionsAtBranch)} />
              <Fact label="Redemptions with no order (all branches)" value={number(detail.rewards.unattributedRedemptions)} />
            </Facts>
            <NamedCounts rows={detail.rewards.redemptionsByProgram} />
            <SubHeading>Promotions</SubHeading>
            <Facts>
              <Fact label="Promotion redemptions here" value={number(detail.promotions.redemptionsAtBranch)} />
              <Fact label="Redemptions with no order (all branches)" value={number(detail.promotions.unattributedRedemptions)} />
            </Facts>
            <NamedCounts rows={detail.promotions.redemptionsByPromotion} />
            <SubHeading>Referrals</SubHeading>
            <Facts>
              <Fact label="Qualified through a purchase here" value={number(detail.referrals.qualifiedAtBranch)} />
              <Fact label="Of which rewarded" value={number(detail.referrals.rewardedAtBranch)} />
              <Fact label="Qualified elsewhere / unattributed" value={number(detail.referrals.qualifiedElsewhereOrUnattributed)} />
            </Facts>
          </div>
        </div>
      </SectionCard>

      <GrowthBlock growth={detail.growth} />

      <SectionCard aria-label="Branch overview" tone="cream" title={`Branch overview — ${data.branch?.name}`}>
        <div className="mb-3 grid grid-cols-2 gap-x-4 gap-y-[18px] sm:grid-cols-3">
          <Figure label="Revenue" value={formatSom(detail.overview.revenueMinor)} />
          <Figure label="Orders" value={number(detail.overview.orders)} />
          <Figure label="Customers" value={number(detail.overview.customers)} />
          <Figure label="Average check" value={formatSom(detail.overview.averageOrderMinor)} />
          <Figure label="Returning rate" value={percent(detail.overview.returningRatePercent)} />
          <Figure label="CUP / POS revenue" value={`${percent(detail.overview.cupRevenueSharePercent)} / ${percent(detail.overview.posRevenueSharePercent)}`} />
          <Figure label="Top category" small value={detail.overview.topCategory ? detail.overview.topCategory.name : '—'} />
          <Figure label="Top product" small value={detail.overview.topProduct ? detail.overview.topProduct.name : '—'} />
          <Figure label="Growth opportunities" value={number(detail.overview.opportunityCount)} />
        </div>
        <p className="mb-0 text-[13px] leading-snug text-muted">A factual snapshot of the figures above — not a score or a rating.</p>
      </SectionCard>
    </>
  );
}

// Phase 15 rules, computed from this branch's purchases only. As of today with the configured lookback — it does not follow the period filter.
function GrowthBlock({ growth }: { growth: BranchDetail['growth'] }) {
  const total = growth.lifecycle.total;
  return (
    <SectionCard aria-label="Growth intelligence" title="Growth intelligence">
      <p className="mt-0 text-[13px] leading-snug text-muted">
        As of {formatDate(growth.asOf)}, last {number(growth.lookbackDays)} days — customers of this branch by the same rules and thresholds as Growth Intelligence. It does not follow the period filter.
      </p>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div>
          <SubHeading>Lifecycle</SubHeading>
          {total === 0 ? (
            <EmptyState text={EMPTY} title="No data" variant="inline" />
          ) : (
            <div className="flex flex-col gap-2.5">
              {LIFECYCLE_STATES.map((s) => {
                const n = growth.lifecycle.counts[s];
                const pct = total > 0 ? (n / total) * 100 : 0;
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
        </div>
        <div>
          <SubHeading>RFM</SubHeading>
          <RfmMatrix matrix={growth.rfm.matrix} />
          {growth.rfm.topScores.length > 0 && <p className="mt-4 mb-0 text-[13px] leading-snug text-muted">Most common scores: {growth.rfm.topScores.map((t) => `${t.score} (${number(t.customers)})`).join(' · ')}</p>}
        </div>
      </div>
      <SubHeading>Signals</SubHeading>
      <div className="mb-3.5 flex flex-wrap gap-2">
        {SIGNAL_TYPES.map((t) => (
          <span className="rounded-full border border-line bg-white px-3 py-1 text-[13px]" key={t}>
            {SIGNAL_LABELS[t]} <strong>{number(growth.signals[t])}</strong>
          </span>
        ))}
      </div>
      <SubHeading>Opportunities</SubHeading>
      <DataTable
        boxed
        columns={[
          { key: 'type', header: 'Type', cell: (t: (typeof OPPORTUNITY_TYPES)[number]) => OPPORTUNITY_LABELS[t] },
          { key: 'total', header: 'Customers', numeric: true, cell: (t) => number(growth.opportunities.counts[t].total) },
          { key: 'high', header: 'High', numeric: true, low: true, cell: (t) => number(growth.opportunities.counts[t].HIGH) },
          { key: 'medium', header: 'Medium', numeric: true, low: true, cell: (t) => number(growth.opportunities.counts[t].MEDIUM) },
          { key: 'low', header: 'Low', numeric: true, low: true, cell: (t) => number(growth.opportunities.counts[t].LOW) },
        ]}
        rowKey={(t) => t}
        rows={[...OPPORTUNITY_TYPES]}
      />
      {growth.opportunities.top.length > 0 && (
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
            rows={growth.opportunities.top}
          />
        </div>
      )}
      <p className="mt-4 mb-0 text-[13px] leading-snug text-muted">Suggestions for existing Segments and CRM Automations; nothing is sent from here.</p>
    </SectionCard>
  );
}

function Sources({ cup, pos }: { cup: SourceSlice; pos: SourceSlice }) {
  const row = (label: string, s: SourceSlice) => (
    <div>
      <div className="text-[11px] font-semibold tracking-[0.08em] text-muted uppercase">{label}</div>
      <div className="font-display text-4xl leading-none mt-2 mb-1 mx-0">
        {number(s.orders)}
      </div>
      <div className="text-[13px] font-medium text-muted">
        {formatSom(s.revenueMinor)} · {percent(s.revenueSharePercent)} of revenue
      </div>
      <div className="text-[13px] font-medium text-muted">{number(s.customers)} customers</div>
    </div>
  );
  return (
    <div className="grid grid-cols-2 gap-4">
      {row('CUP orders', cup)}
      {row('POS purchases', pos)}
    </div>
  );
}

function ProductTable({ title, rows }: { title: string; rows: ProductLine[] }) {
  return (
    <div>
      <SubHeading>{title}</SubHeading>
      {rows.length === 0 ? (
        <EmptyState text={EMPTY} title="No data" variant="inline" />
      ) : (
        <DataTable
          boxed
          columns={[
            {
              key: 'product',
              header: 'Product',
              cell: (p) => (
                <span className="block max-w-[240px] [overflow-wrap:anywhere]">
                  {p.name}
                  <span className="block text-xs font-medium text-muted">{p.category}</span>
                </span>
              ),
            },
            { key: 'qty', header: 'Qty', numeric: true, cell: (p) => number(p.quantity) },
            { key: 'revenue', header: 'Revenue', numeric: true, cell: (p) => formatSom(p.revenueMinor) },
          ]}
          rowKey={(p) => `${p.name}-${p.category}`}
          rows={rows}
        />
      )}
    </div>
  );
}

function NamedCounts({ rows }: { rows: { name: string; count: number }[] }) {
  if (rows.length === 0) return null;
  return (
    <ul className="mt-2 flex list-none flex-col gap-1 p-0 text-[13px]">
      {rows.map((r) => (
        <li className="flex justify-between gap-3" key={r.name}>
          <span className="block max-w-[240px] [overflow-wrap:anywhere]">{r.name}</span>
          <strong>{number(r.count)}</strong>
        </li>
      ))}
    </ul>
  );
}

function Figure({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-semibold tracking-[0.08em] text-muted uppercase">{label}</div>
      <div className={cx('[overflow-wrap:anywhere]', small ? 'my-2 font-display text-xl leading-tight' : 'font-display text-[30px] leading-none')} style={small ? undefined : { margin: '8px 0 4px' }}>
        {value}
      </div>
    </div>
  );
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-[18px] mb-2 text-xs font-bold tracking-[0.14em] text-muted uppercase">{children}</h3>;
}

function Facts({ children }: { children: React.ReactNode }) {
  return <dl className="m-0 flex flex-col">{children}</dl>;
}

function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-line py-2 text-sm">
      <dt className="min-w-0 text-black [overflow-wrap:anywhere]">{label}</dt>
      <dd className="m-0 text-right font-semibold tabular-nums">
        {value}
        {hint && <span className="text-[13px] font-medium text-muted"> · {hint}</span>}
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
    <details className="min-w-0 rounded-lg border border-line bg-white px-6 py-4 [&_summary]:pt-0 [&_summary]:pb-0">
      <summary className="cursor-pointer font-display text-lg leading-tight font-medium text-black">Definitions</summary>
      <dl className="mt-3 flex flex-col gap-3 text-[13px]">
        {labels
          .filter(([key]) => definitions[key])
          .map(([key, label]) => (
            <div key={key}>
              <dt className="font-bold">{label}</dt>
              <dd className="mt-0.5 text-muted">{definitions[key]}</dd>
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
    <div>
      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-3">
        <span className="text-[11px] font-semibold tracking-[0.08em] text-muted uppercase">{title}</span>
        <span className="text-[13px] font-medium text-muted">Total {format(total)}</span>
      </div>
      <svg aria-label={`${title} by day`} className="h-[150px] w-full" preserveAspectRatio="none" role="img" viewBox={`0 0 ${width} ${height}`}>
        <line stroke="var(--color-line-strong)" strokeWidth={1} x1="0" x2={width} y1={height - 0.5} y2={height - 0.5} />
        {days.map((d, i) => {
          const h = d.value === 0 || max === 0 ? 0 : Math.max(2, (d.value / max) * (height - 8));
          return (
            <rect className={tone === 'terracotta' ? 'fill-terracotta' : 'fill-black'} height={h} key={d.date} width={barWidth} x={i * (barWidth + gap)} y={height - h}>
              <title>{`${d.date}: ${format(d.value)}`}</title>
            </rect>
          );
        })}
      </svg>
      <div className="mt-1 flex justify-between text-xs text-muted">
        <span>{days[0]?.date}</span>
        {max === 0 && <span>No purchases in this period</span>}
        <span>{days[days.length - 1]?.date}</span>
      </div>
    </div>
  );
}
