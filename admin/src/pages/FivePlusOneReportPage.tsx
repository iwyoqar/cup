import { useCallback, useEffect, useState } from 'react';
import { fetchRewardReport } from '../lib/adminRewardPrograms';
import { ApiError } from '../lib/api';
import { formatDate, formatDateTime } from '../lib/format';
import { findNav } from '../lib/nav';
import { RewardReport, RewardReportRedemption, RewardReportTopCustomer } from '../lib/types';
import { CustomerDetailView } from '../components/CustomerDetailView';
import { Column, cx, DataTable, DateRangePicker, DateRangeValue, EmptyState, ErrorState, FilterBar, isRangeReady, LoadingState, PageHeader, SectionCard, StatCard, StatGrid } from '../ui';

const number = (n: number) => n.toLocaleString('ru-RU');

// Mirrors useReportsOverview.ts / useAnalyticsOverview.ts exactly, for GET /admin/reward-programs/reports/5-plus-1.
function useRewardReport(filters: DateRangeValue, ready: boolean) {
  const [data, setData] = useState<RewardReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const { period, startDate, endDate } = filters;

  const load = useCallback(() => {
    if (!ready) return undefined;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchRewardReport({ period, startDate: startDate || undefined, endDate: endDate || undefined })
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.backendMessage : "Ma'lumotni yuklab bo'lmadi");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [period, startDate, endDate, ready]);

  useEffect(() => load(), [load, reloadKey]);

  return { data, error, loading, reload: () => setReloadKey((k) => k + 1) };
}

function topCustomerColumns(): Column<RewardReportTopCustomer>[] {
  return [
    { key: 'rank', header: '#', cell: (c) => c.rank },
    { key: 'name', header: 'Customer', cell: (c) => <span className="font-semibold text-black">{c.customerName}</span> },
    { key: 'phone', header: 'Phone', low: true, cell: (c) => c.phone ?? '—' },
    { key: 'free', header: 'Free coffees', numeric: true, cell: (c) => number(c.freeCoffeesRedeemed) },
    { key: 'qualifying', header: 'Qualifying coffees', numeric: true, low: true, cell: (c) => number(c.qualifyingCoffees) },
    { key: 'progress', header: 'Current progress', numeric: true, low: true, cell: (c) => `${c.currentProgress.qualifyingCount} / ${c.currentProgress.buyQuantity}` },
    { key: 'last', header: 'Last redemption', low: true, cell: (c) => formatDate(c.lastRedemptionAt) },
  ];
}

function recentRedemptionColumns(branchAttributionAvailable: boolean): Column<RewardReportRedemption>[] {
  const columns: Column<RewardReportRedemption>[] = [
    { key: 'date', header: 'Date', low: true, cell: (r) => formatDateTime(r.redeemedAt) },
    { key: 'customer', header: 'Customer', cell: (r) => <span className="font-semibold text-black">{r.customerName}</span> },
    { key: 'product', header: 'Reward', cell: (r) => r.rewardProductName },
  ];
  // Only shown when at least one redemption in this program's history actually has a resolvable branch — never a
  // column of all-dashes (Part 11 of the spec: don't offer branch filtering/columns the data can't back up).
  if (branchAttributionAvailable) columns.push({ key: 'branch', header: 'Branch', low: true, cell: (r) => r.branchName ?? '—' });
  return columns;
}

// 5+1 Coffee Reward report — read-only admin reporting over the EXISTING reward engine (no qualification/progress/
// redemption logic lives here, only presentation). Sorted, never scored: Top 10 is a plain table ranked by
// successful free-coffee count, no podium/champion language.
export function FivePlusOneReportPage() {
  const [range, setRange] = useState<DateRangeValue>({ period: 'last30', startDate: '', endDate: '' });
  const [openCustomerId, setOpenCustomerId] = useState<string | null>(null);
  const ready = isRangeReady(range);
  const { data, error, loading, reload } = useRewardReport(range, ready);
  const { item } = findNav('rewards-5plus1');

  if (openCustomerId) {
    return <CustomerDetailView customerId={openCustomerId} onBack={() => setOpenCustomerId(null)} onDeactivated={() => setOpenCustomerId(null)} />;
  }

  return (
    <>
      <PageHeader description={item.description} title={item.label} />

      <FilterBar>
        <DateRangePicker onChange={setRange} value={range} />
        {data && !error && (
          <span className="text-[13px] leading-snug text-muted self-center">
            {data.period.startDate === data.period.endDate ? data.period.startDate : `${data.period.startDate} → ${data.period.endDate}`}
            {loading && ' · updating…'}
          </span>
        )}
      </FilterBar>

      {error && <ErrorState message={error} onRetry={reload} title="The report could not be loaded" />}
      {!data && !error && ready && <LoadingState variant="page" />}

      {data && !error && !data.program && <EmptyState text="No BUY_X_GET_Y reward program is currently configured." title="No 5+1 program found" />}

      {data && !error && data.program && (
        <div className={cx('flex min-w-0 flex-col gap-5 transition-opacity duration-200', loading && 'opacity-60')}>
          <p className="text-[13px] leading-snug text-muted">
            {data.program.name} · {data.program.buyQuantity} {data.program.qualifyingCategoryName} → {data.program.rewardQuantity} free
            {!data.program.isActive && ' · currently inactive'}
          </p>

          <StatGrid>
            <StatCard hint="All-time" label="Participating customers" value={number(data.summary.participatingCustomers)} />
            <StatCard hint="All-time cumulative" label="Qualifying coffees" value={number(data.summary.qualifyingCoffees)} />
            <StatCard hint="In selected period" label="Free coffees redeemed" strong value={number(data.summary.freeCoffeesRedeemed)} />
            <StatCard hint="Current status" label="Rewards available" value={number(data.summary.rewardsAvailable)} />
            <StatCard hint="Current status" label="Customers with available reward" value={number(data.summary.customersWithAvailableReward)} />
          </StatGrid>

          {data.notes.map((n) => (
            <div className="block space-y-1 rounded-md border-l-[3px] px-4 py-3 text-sm leading-relaxed [&_p]:m-0 border-muted-cream bg-neutral-bg text-muted-cream" key={n}>
              <p>{n}</p>
            </div>
          ))}

          <SectionCard description="Ranked by successful free coffees redeemed in the selected period. Ties break by most recent redemption, then customer id. Click a row to open that customer." flush title="Top 10 customers">
            <DataTable columns={topCustomerColumns()} empty={<EmptyState text="No 5+1 redemptions yet." title="No redemptions" variant="inline" />} onRowClick={(c) => setOpenCustomerId(c.customerId)} rowKey={(c) => c.customerId} rows={data.topCustomers} />
          </SectionCard>

          <SectionCard description="Successful redemptions in the selected period, most recent first. Click a row to open that customer." flush title="Recent redemptions">
            <DataTable
              columns={recentRedemptionColumns(data.branchAttributionAvailable)}
              empty={<EmptyState text="No 5+1 redemptions in this period." title="No redemptions" variant="inline" />}
              onRowClick={(r) => setOpenCustomerId(r.customerId)}
              rowKey={(r) => `${r.customerId}-${r.redeemedAt}-${r.orderId ?? 'pos'}`}
              rows={data.recentRedemptions}
            />
          </SectionCard>
        </div>
      )}
    </>
  );
}
