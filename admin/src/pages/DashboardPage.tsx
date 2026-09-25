import { useMemo, useState } from 'react';
import { deriveHealth, usePulse } from '../lib/health';
import { formatSom } from '../lib/format';
import { AdminPage } from '../lib/nav';
import { AdminProfile } from '../lib/types';
import { useAnalyticsOverview } from '../lib/useAnalyticsOverview';
import { BarChart, Button, ChartContainer, cx, EmptyState, ErrorState, FilterBar, FilterField, HBarList, LoadingState, PageHeader, SectionCard, StatCard, StatGrid } from '../ui';
import { HealthList } from '../ui/HealthList';

type Window = 'today' | 'last7' | 'last30';
const WINDOWS: { key: Window; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'last7', label: 'Last 7 days' },
  { key: 'last30', label: 'Last 30 days' },
];

const number = (n: number) => n.toLocaleString('ru-RU');

// A contextual greeting from the local clock — the only "personal" element; it is a label, not data.
function greeting(now: Date): string {
  const h = now.getHours();
  return h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

interface DashboardPageProps {
  admin: AdminProfile;
  onNavigate: (page: AdminPage) => void;
}

// The operational overview. Every figure is the backend's own (the same /admin/analytics/overview that Sales and Analytics read, and the
// same status that System Health reads); nothing is estimated. Panels for data the API does not expose yet (recent orders, loyalty activity)
// are deliberately absent rather than filled with placeholders.
export function DashboardPage({ admin, onNavigate }: DashboardPageProps) {
  const [windowKey, setWindowKey] = useState<Window>('today');
  const { data, error, loading, reload } = useAnalyticsOverview({ period: windowKey, startDate: '', endDate: '' });
  const pulse = usePulse();
  const health = useMemo(() => deriveHealth(pulse), [pulse]);
  const label = WINDOWS.find((w) => w.key === windowKey)?.label.toLowerCase() ?? '';
  const totalCustomers = data ? data.newCustomers + data.returningCustomers : 0;

  return (
    <>
      <PageHeader
        actions={
          <Button disabled={loading} onClick={reload} variant="secondary">
            Refresh
          </Button>
        }
        description={`Here is how CUP is doing — ${label}. Signed in as ${admin.email}.`}
        title={greeting(new Date())}
      />

      <FilterBar>
        <FilterField label="Period">
          <select className="" onChange={(e) => setWindowKey(e.target.value as Window)} value={windowKey}>
            {WINDOWS.map((w) => (
              <option key={w.key} value={w.key}>
                {w.label}
              </option>
            ))}
          </select>
        </FilterField>
        {data && !error && (
          <span className="text-[13px] leading-snug text-muted self-center">
            {data.period.startDate === data.period.endDate ? data.period.startDate : `${data.period.startDate} → ${data.period.endDate}`}
          </span>
        )}
      </FilterBar>

      {error && <ErrorState message={error} onRetry={reload} title="The figures could not be loaded" />}
      {!data && !error && <LoadingState variant="page" />}

      {data && !error && (
        <div className={cx('flex min-w-0 flex-col gap-5 transition-opacity duration-200', loading && 'opacity-60')}>
          <StatGrid>
            <StatCard hint="CUP + imported POS" label="Revenue" strong value={formatSom(data.revenue)} />
            <StatCard label="Orders" value={number(data.orders)} />
            <StatCard hint={`${number(data.newCustomers)} new · ${number(data.returningCustomers)} returning`} label="Customers" value={number(data.customers)} />
            <StatCard hint="Revenue ÷ orders" label="Average order" value={formatSom(data.averageOrder)} />
          </StatGrid>

          <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <ChartContainer
              actions={
                <Button onClick={() => onNavigate('sales')} variant="ghost">
                  Open Sales
                </Button>
              }
              description="Revenue per business day."
              title="Sales trend"
            >
              <BarChart ariaLabel="Daily revenue" data={data.revenueByDay.map((d) => ({ label: d.date, value: d.revenue }))} format={formatSom} />
            </ChartContainer>

            <SectionCard
              actions={
                <Button onClick={() => onNavigate('system-health')} variant="ghost">
                  Details
                </Button>
              }
              description={pulse.checkedAt ? `Checked ${pulse.checkedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : 'Checking…'}
              title="System status"
            >
              <HealthList compact items={health} />
            </SectionCard>
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <SectionCard
              actions={
                <Button onClick={() => onNavigate('analytics')} variant="ghost">
                  Open Analytics
                </Button>
              }
              description={`Best sellers — ${label}.`}
              title="Top products"
            >
              {data.topProducts.length === 0 ? (
                <EmptyState text="Nothing was sold in this period." title="No products yet" variant="inline" />
              ) : (
                <HBarList
                  items={data.topProducts.slice(0, 5).map((p) => ({ name: p.name, value: p.revenue, valueLabel: formatSom(p.revenue), hint: `${number(p.quantity)} sold` }))}
                />
              )}
            </SectionCard>

            <SectionCard
              actions={
                <Button onClick={() => onNavigate('customers')} variant="ghost">
                  Open Customers
                </Button>
              }
              description={`Who bought — ${label}.`}
              title="Customer activity"
            >
              {totalCustomers === 0 ? (
                <EmptyState text="No customers bought in this period." title="No customer activity" variant="inline" />
              ) : (
                <HBarList
                  items={[
                    { name: 'New customers', value: data.newCustomers, valueLabel: number(data.newCustomers) },
                    { name: 'Returning customers', value: data.returningCustomers, valueLabel: number(data.returningCustomers) },
                  ]}
                />
              )}
            </SectionCard>
          </div>
        </div>
      )}
    </>
  );
}
