import { useState } from 'react';
import { SubOverview, SubSettings, useSubscriptionsGet } from '../lib/adminSubscriptions';
import { formatSom } from '../lib/format';
import { findNav } from '../lib/nav';
import { BarChart, DateRangePicker, DateRangeValue, FilterBar, isRangeReady, PageHeader, SectionCard, StatCard, StatGrid } from '../ui';
import { Notes, num, PeriodHint, ReportBody } from './reportsShared';
import { rangeParams } from '../lib/useReport';

// Coffee Subscription — Overview. Portions SOLD and portions CONSUMED are separate figures; a redemption is never revenue.
export function SubscriptionsOverviewPage() {
  const [range, setRange] = useState<DateRangeValue>({ period: 'last30', startDate: '', endDate: '' });
  const ready = isRangeReady(range);
  const { item } = findNav('subscriptions');
  const { data, error, loading, reload } = useSubscriptionsGet<SubOverview>('/overview', rangeParams(range), ready);
  const settings = useSubscriptionsGet<SubSettings>('/settings');

  return (
    <>
      <PageHeader description={item.description} title="Subscriptions" />
      <FilterBar>
        <DateRangePicker onChange={setRange} value={range} />
        <PeriodHint loading={loading} period={data?.period} />
      </FilterBar>
      {settings.data && (
        <div className="mb-5 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-neutral-bg px-3 py-1 font-semibold text-muted-cream">POS redemption: {settings.data.posRedemptionEnabled ? 'on' : 'off'}</span>
          <span className="rounded-full bg-neutral-bg px-3 py-1 font-semibold text-muted-cream">Manual activation: {settings.data.manualActivationEnabled ? 'on' : 'off'}</span>
          <span className="rounded-full bg-neutral-bg px-3 py-1 font-semibold text-muted-cream">Payment providers: {settings.data.paymentProviders.length ? settings.data.paymentProviders.map((p) => p.id).join(', ') : 'none yet'}</span>
          <span className="rounded-full bg-neutral-bg px-3 py-1 font-semibold text-muted-cream">No auto-renew · No refunds · No rollover</span>
        </div>
      )}
      <ReportBody data={data} error={error} loading={loading} ready={ready} reload={reload} title="Subscriptions could not be loaded">
        {(d) => (
          <>
            <StatGrid>
              <StatCard hint={d.scheduledSubscriptions ? `${num(d.scheduledSubscriptions)} scheduled renewal(s)` : 'Running right now'} label="Active subscriptions" strong value={num(d.activeSubscriptions)} />
              <StatCard hint={`${num(d.renewals)} renewal(s)`} label="New subscriptions" value={num(d.newSubscriptions)} />
              <StatCard label="Expired" value={num(d.expiredSubscriptions)} />
              <StatCard label="Cancelled" value={num(d.cancelledSubscriptions)} />
            </StatGrid>
            <StatGrid>
              <StatCard hint="Provider-confirmed payments only" label="Subscription revenue" value={formatSom(d.subscriptionRevenueMinor)} />
              <StatCard hint={d.portionsIssuedManually ? `+${num(d.portionsIssuedManually)} issued by manual activation` : 'Paid subscriptions'} label="Portions sold" value={num(d.portionsSold)} />
              <StatCard hint={`${num(d.redemptionCount)} redemption(s)`} label="Portions consumed" value={num(d.portionsConsumed)} />
              <StatCard hint="Expired with the subscription — no rollover" label="Unused portions" value={num(d.unusedExpiredPortions)} />
            </StatGrid>
            <StatGrid>
              <StatCard label="Customers with an active subscription" value={num(d.customersWithActiveSubscription)} />
              <StatCard label="Customers ever subscribed" value={num(d.customersEver)} />
              <StatCard hint={d.manualActivations.count ? `Nominal ${formatSom(d.manualActivations.nominalMinor)} — not revenue` : 'None in this period'} label="Manual activations" value={num(d.manualActivations.count)} />
            </StatGrid>
            <SectionCard description="Portions consumed per business day (UTC+5)." title="Consumption">
              <BarChart ariaLabel="Portions consumed per day" data={d.daily.map((x) => ({ label: x.date.slice(5), value: x.portions }))} emptyText="No subscription coffee in this period." format={(v) => `${num(v)} portions`} />
            </SectionCard>
            <Notes
              notes={[
                'Subscription revenue = money received for subscriptions (provider-confirmed payments). Redeeming a subscription coffee adds no revenue: it is consumption, and its theoretical cost is counted as COGS in Finance.',
                'Portions sold (bought) and portions consumed (redeemed) are tracked separately; unused portions expire with the subscription.',
              ]}
            />
          </>
        )}
      </ReportBody>
    </>
  );
}
