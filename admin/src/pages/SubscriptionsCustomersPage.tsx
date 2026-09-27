import { useEffect, useState } from 'react';
import { CustomerRow, Paged, useSubscriptionsGet } from '../lib/adminSubscriptions';
import { apiRequest } from '../lib/api';
import { findNav } from '../lib/nav';
import { Button, Column, DataTable, EmptyState, FilterBar, Input, PageHeader, Pagination, SearchInput, SectionCard } from '../ui';
import { num, ReportBody } from './reportsShared';
import { CustomerCell, SubscriptionCustomerDrawer, timeOrDash } from './subscriptionsShared';

const columns: Column<CustomerRow>[] = [
  { key: 'c', header: 'Customer', cell: (r) => <CustomerCell c={r.customer} /> },
  { key: 'p', header: 'Current plan', cell: (r) => r.currentPlan ?? '—' },
  { key: 'r', header: 'Remaining', numeric: true, cell: (r) => (r.currentRemaining === null ? '—' : num(r.currentRemaining)) },
  { key: 's', header: 'Subscriptions', numeric: true, low: true, cell: (r) => num(r.totalSubscriptions) },
  { key: 'pp', header: 'Portions bought', numeric: true, low: true, cell: (r) => num(r.portionsPurchased) },
  { key: 'pc', header: 'Consumed', numeric: true, cell: (r) => num(r.portionsConsumed) },
  { key: 'pu', header: 'Unused (expired)', numeric: true, low: true, cell: (r) => num(r.unusedExpiredPortions) },
  { key: 'n', header: 'Redemptions', numeric: true, low: true, cell: (r) => num(r.redemptionCount) },
  { key: 'l', header: 'Last redemption', low: true, cell: (r) => timeOrDash(r.lastRedemptionAt) },
  { key: 'na', header: 'Next available', low: true, cell: (r) => (r.currentPlan ? (r.nextAvailableAt ? timeOrDash(r.nextAvailableAt) : 'Now') : '—') },
];

interface LookupCustomer {
  id: string;
  displayName: string | null;
  phone: string | null;
  loyaltyCode: string | null;
}

export function SubscriptionsCustomersPage() {
  const { item } = findNav('subscriptions-customers');
  const [searchInput, setSearchInput] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [lookup, setLookup] = useState('');
  const [lookupResult, setLookupResult] = useState<LookupCustomer[] | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setQ(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);
  useEffect(() => setPage(1), [q]);
  const { data, error, loading, reload } = useSubscriptionsGet<Paged<CustomerRow>>('/customers', { q, page });

  // Finding a customer WITHOUT a subscription yet (to create their first purchase) reuses the existing Commerce → Customers search endpoint.
  const find = async () => {
    const res = await apiRequest<{ items: LookupCustomer[] }>(`/admin/customers?search=${encodeURIComponent(lookup.trim())}&limit=10`).catch(() => ({ items: [] }));
    setLookupResult(res.items ?? []);
  };

  return (
    <>
      <PageHeader description={item.description} title={item.label} />
      <FilterBar>
        <SearchInput label="Customer" onChange={setSearchInput} placeholder="Name, CUP code or phone" value={searchInput} />
      </FilterBar>
      <ReportBody data={data} error={error} loading={loading} ready reload={reload} title="Subscription customers could not be loaded">
        {(d) => (
          <SectionCard description={`${num(d.total)} customer(s) with at least one activated subscription.`} flush title="Customers">
            <DataTable columns={columns} empty={<EmptyState text="No customer has a subscription yet." title="Nothing here" variant="inline" />} onRowClick={(r) => setSelected(r.customer.id)} rowKey={(r) => r.customer.id} rows={d.items} />
            <div className="px-5 py-3">
              <Pagination busy={loading} onPage={setPage} page={d.page} pages={d.pages} total={d.total} />
            </div>
          </SectionCard>
        )}
      </ReportBody>
      <SectionCard className="mt-5" description="Open any customer (with or without a subscription) to create a purchase for them." title="Find a customer">
        <div className="flex flex-wrap items-end gap-2">
          <Input className="min-w-[240px]" onChange={(e) => setLookup(e.target.value)} placeholder="Name, CUP code or phone" value={lookup} />
          <Button disabled={lookup.trim().length < 2} onClick={() => void find()} variant="secondary">
            Search
          </Button>
        </div>
        {lookupResult && (
          <ul className="m-0 mt-3 flex list-none flex-col gap-1 p-0">
            {lookupResult.length === 0 && <li className="text-sm text-muted">No customer found.</li>}
            {lookupResult.map((c) => (
              <li key={c.id}>
                <button className="w-full cursor-pointer rounded-sm px-3 py-2 text-left text-sm hover:bg-hover" onClick={() => setSelected(c.id)} type="button">
                  <strong>{c.displayName ?? 'Unnamed'}</strong> <span className="text-muted">{[c.loyaltyCode, c.phone].filter(Boolean).join(' · ')}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
      {selected && <SubscriptionCustomerDrawer customerId={selected} onChanged={reload} onClose={() => setSelected(null)} />}
    </>
  );
}
