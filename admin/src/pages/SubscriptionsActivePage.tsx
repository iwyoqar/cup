import { useEffect, useState } from 'react';
import { ActiveRow, Paged, SubPlan, useSubscriptionsGet } from '../lib/adminSubscriptions';
import { findNav } from '../lib/nav';
import { Column, DataTable, EmptyState, FilterBar, FilterField, PageHeader, Pagination, SearchInput, SectionCard, Select } from '../ui';
import { num, ReportBody } from './reportsShared';
import { businessDate, CustomerCell, StatusPill, SubscriptionCustomerDrawer, timeOrDash } from './subscriptionsShared';

const columns: Column<ActiveRow>[] = [
  { key: 'c', header: 'Customer', cell: (r) => <CustomerCell c={r.customer} /> },
  { key: 'p', header: 'Plan', cell: (r) => r.planName },
  { key: 's', header: 'Status', cell: (r) => <StatusPill status={r.effectiveStatus} /> },
  { key: 'st', header: 'Start', low: true, cell: (r) => businessDate(r.startBusinessDate) },
  { key: 'e', header: 'Expires', cell: (r) => businessDate(r.endBusinessDate) },
  { key: 't', header: 'Total', numeric: true, low: true, cell: (r) => num(r.usage.totalPortions) },
  { key: 'u', header: 'Used', numeric: true, low: true, cell: (r) => num(r.usage.consumedPortions) },
  { key: 'r', header: 'Remaining', numeric: true, cell: (r) => num(r.usage.remainingPortions) },
  { key: 'd', header: 'Today', numeric: true, cell: (r) => `${r.usage.todayUsedPortions} / ${r.usage.dailyPortionLimit}` },
  { key: 'l', header: 'Last', low: true, cell: (r) => timeOrDash(r.usage.lastRedemptionAt) },
  { key: 'n', header: 'Next available', low: true, cell: (r) => (r.usage.nextAvailableAt ? timeOrDash(r.usage.nextAvailableAt) : 'Now') },
];

export function SubscriptionsActivePage() {
  const { item } = findNav('subscriptions-active');
  const [searchInput, setSearchInput] = useState('');
  const [q, setQ] = useState('');
  const [planId, setPlanId] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setQ(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);
  useEffect(() => setPage(1), [q, planId, status]);
  const plans = useSubscriptionsGet<SubPlan[]>('/plans');
  const { data, error, loading, reload } = useSubscriptionsGet<Paged<ActiveRow>>('/active', { q, planId, status, page });

  return (
    <>
      <PageHeader description={item.description} title={item.label} />
      <FilterBar>
        <SearchInput label="Customer" onChange={setSearchInput} placeholder="Name, CUP code or phone" value={searchInput} />
        <FilterField label="Plan">
          <Select onChange={(e) => setPlanId(e.target.value)} value={planId}>
            <option value="">All plans</option>
            {(plans.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </FilterField>
        <FilterField label="Status">
          <Select onChange={(e) => setStatus(e.target.value)} value={status}>
            <option value="">Running + scheduled + paused</option>
            <option value="RUNNING">Running</option>
            <option value="SCHEDULED">Scheduled (renewal)</option>
            <option value="PAUSED">Paused</option>
          </Select>
        </FilterField>
      </FilterBar>
      <ReportBody data={data} error={error} loading={loading} ready reload={reload} title="Active subscriptions could not be loaded">
        {(d) => (
          <SectionCard description={`${num(d.total)} subscription(s). Branch is not applicable: a subscription can be used at any branch.`} flush title="Subscriptions">
            <DataTable columns={columns} empty={<EmptyState text="No subscription matches these filters." title="Nothing here" variant="inline" />} onRowClick={(r) => setSelected(r.customer.id)} rowKey={(r) => r.id} rows={d.items} />
            <div className="px-5 py-3">
              <Pagination busy={loading} onPage={setPage} page={d.page} pages={d.pages} total={d.total} />
            </div>
          </SectionCard>
        )}
      </ReportBody>
      {selected && <SubscriptionCustomerDrawer customerId={selected} onChanged={reload} onClose={() => setSelected(null)} />}
    </>
  );
}
