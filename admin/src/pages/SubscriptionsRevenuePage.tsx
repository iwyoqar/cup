import { useState } from 'react';
import { RevenueOverview, useSubscriptionsGet } from '../lib/adminSubscriptions';
import { formatSom } from '../lib/format';
import { findNav } from '../lib/nav';
import { rangeParams } from '../lib/useReport';
import { BarChart, Column, DataTable, DateRangePicker, DateRangeValue, EmptyState, FilterBar, isRangeReady, PageHeader, SectionCard, StatCard, StatGrid } from '../ui';
import { Notes, num, PeriodHint, ReportBody } from './reportsShared';

type PlanRow = RevenueOverview['byPlan'][number];
const planColumns: Column<PlanRow>[] = [
  { key: 'p', header: 'Plan', cell: (r) => <span className="font-semibold text-black">{r.planName}</span> },
  { key: 'c', header: 'Sold (paid)', numeric: true, cell: (r) => num(r.count) },
  { key: 'r', header: 'Revenue', numeric: true, cell: (r) => formatSom(r.revenueMinor) },
  { key: 'm', header: 'Manual activations', numeric: true, low: true, cell: (r) => num(r.manualCount) },
];

// Subscription SALES revenue (money received for subscriptions) — never the value of redeemed coffee.
export function SubscriptionsRevenuePage() {
  const { item } = findNav('subscriptions-revenue');
  const [range, setRange] = useState<DateRangeValue>({ period: 'last30', startDate: '', endDate: '' });
  const ready = isRangeReady(range);
  const { data, error, loading, reload } = useSubscriptionsGet<RevenueOverview>('/revenue', rangeParams(range), ready);
  return (
    <>
      <PageHeader description={item.description} title={item.label} />
      <FilterBar>
        <DateRangePicker onChange={setRange} value={range} />
        <PeriodHint loading={loading} period={data?.period} />
      </FilterBar>
      <ReportBody data={data} error={error} loading={loading} ready={ready} reload={reload} title="Subscription revenue could not be loaded">
        {(d) => (
          <>
            {!d.paymentProvidersIntegrated && (
              <div className="rounded-md border-l-[3px] border-terracotta bg-cream-soft px-4 py-3 text-sm text-warn">
                No payment provider (Click, Payme, Uzcard, Humo, Visa, Mastercard) is integrated yet — subscription revenue stays 0 until one is.
              </div>
            )}
            <StatGrid>
              <StatCard label="Subscription sales" strong value={formatSom(d.subscriptionSalesMinor)} />
              <StatCard label="Subscriptions sold" value={num(d.subscriptionsSold)} />
              <StatCard label="New" value={num(d.newSubscriptions)} />
              <StatCard label="Renewals" value={num(d.renewals)} />
            </StatGrid>
            <StatGrid>
              <StatCard hint="Running right now" label="Active subscriptions" value={num(d.activeSubscriptions)} />
              <StatCard hint={d.manualActivations.count ? `Nominal ${formatSom(d.manualActivations.nominalMinor)} — excluded from revenue` : 'None'} label="Manual activations" value={num(d.manualActivations.count)} />
            </StatGrid>
            <SectionCard flush title="By plan">
              <DataTable columns={planColumns} empty={<EmptyState text="No subscription was sold in this period." title="Nothing here" variant="inline" />} rowKey={(r) => r.planId} rows={d.byPlan} />
            </SectionCard>
            <SectionCard description="Provider-confirmed payments per business day (UTC+5)." title="By day">
              <BarChart ariaLabel="Subscription revenue per day" data={d.byDay.map((x) => ({ label: x.date.slice(5), value: x.revenueMinor }))} emptyText="No subscription revenue in this period." format={formatSom} />
            </SectionCard>
            <Notes notes={d.notes} />
          </>
        )}
      </ReportBody>
    </>
  );
}
