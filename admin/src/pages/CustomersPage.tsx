import { useEffect, useState } from 'react';
import { fetchCustomers } from '../lib/adminCustomers';
import { ApiError } from '../lib/api';
import { formatDateTime, formatSom } from '../lib/format';
import { AdminCustomerListItem } from '../lib/types';
import { CustomerDetailView } from '../components/CustomerDetailView';
import { LIFECYCLE_LABELS, LifecycleState } from '../lib/adminGrowth';
import { findNav } from '../lib/nav';
import { Column, DataTable, EmptyState, ErrorState, FilterBar, LoadingState, PageHeader, SearchInput, SectionCard } from '../ui';

// Phase 4 Part 9: Customers page — search + table, click a row to open Customer 360. Detail
// navigation is local to this page (no router library, same pattern as Dashboard/Loyalty
// pages swapping via App.tsx, just one level deeper).
export function CustomersPage() {
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [items, setItems] = useState<AdminCustomerListItem[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // Debounced search: avoids firing a request on every keystroke (spec Part 10 — server-side
  // search should not be hit more than necessary).
  useEffect(() => {
    const search = searchInput.trim();
    setItems(null);
    setError(null);
    const timer = setTimeout(() => {
      fetchCustomers({ search: search || undefined })
        .then((page) => {
          setItems(page.items);
          setNextCursor(page.nextCursor);
        })
        .catch((err) => {
          setError(err instanceof ApiError ? err.backendMessage : 'Failed to load customers.');
        });
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const handleLoadMore = async () => {
    if (!nextCursor) return;
    setIsLoadingMore(true);
    try {
      const page = await fetchCustomers({ search: searchInput.trim() || undefined, cursor: nextCursor });
      setItems((current) => [...(current ?? []), ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (err) {
      setError(err instanceof ApiError ? err.backendMessage : 'Failed to load more customers.');
    } finally {
      setIsLoadingMore(false);
    }
  };

  if (selectedCustomerId) {
    return <CustomerDetailView customerId={selectedCustomerId} onBack={() => setSelectedCustomerId(null)} />;
  }

  const columns: Column<AdminCustomerListItem>[] = [
    { key: 'name', header: 'Name', cell: (c) => <span className="table__primary">{c.displayName ?? '—'}</span> },
    { key: 'phone', header: 'Phone', low: true, cell: (c) => c.phone ?? '—' },
    { key: 'orders', header: 'Orders', numeric: true, cell: (c) => c.orderCount },
    { key: 'spent', header: 'Total spent', numeric: true, cell: (c) => formatSom(c.totalSpentMinor) },
    { key: 'last', header: 'Last order', low: true, cell: (c) => (c.lastOrderAt ? formatDateTime(c.lastOrderAt) : '—') },
    {
      key: 'lifecycle',
      header: 'Lifecycle · RFM',
      low: true,
      cell: (customer) => (
        <span title={customer.growth.lifetimePurchases > 0 ? `Last purchase ${customer.growth.daysSinceLastPurchase} days ago · ${customer.growth.lifetimePurchases} purchases · ${formatSom(customer.growth.lifetimeRevenue)} (CUP + POS)` : 'No qualifying purchase yet'}>
          {customer.growth.lifecycleState ? (
            <span className={`growth__badge growth__badge--${customer.growth.lifecycleState.toLowerCase()}`}>{LIFECYCLE_LABELS[customer.growth.lifecycleState as LifecycleState] ?? customer.growth.lifecycleState}</span>
          ) : (
            '—'
          )}
          {customer.growth.rfmScore && <span className="growth__rfm"> {customer.growth.rfmScore}</span>}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader description={findNav('customers').item.description} title="Customers" />

      <FilterBar>
        <SearchInput label="Search customers" onChange={setSearchInput} placeholder="Search name or phone" value={searchInput} />
      </FilterBar>

      {error && <ErrorState message={error} title="Customers could not be loaded" />}

      <SectionCard
        description="Select a customer to open their full profile: loyalty, rewards, promotions, orders and activity."
        flush
        footer={
          nextCursor ? (
            <button className="button-secondary" disabled={isLoadingMore} onClick={handleLoadMore} type="button">
              {isLoadingMore ? 'Loading…' : 'Load more'}
            </button>
          ) : undefined
        }
        title="All customers"
      >
        {items === null && !error ? (
          <LoadingState variant="table" />
        ) : (
          <DataTable
            columns={columns}
            empty={<EmptyState text={searchInput.trim() ? 'No customer matches this search.' : 'Customers appear here after they register in the Mini App.'} title={searchInput.trim() ? 'No customers found' : 'No customers yet'} variant="inline" />}
            onRowClick={(c) => setSelectedCustomerId(c.id)}
            rowKey={(c) => c.id}
            rows={items ?? []}
          />
        )}
      </SectionCard>
    </>
  );
}
