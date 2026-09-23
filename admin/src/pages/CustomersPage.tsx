import { useEffect, useState } from 'react';
import { deactivateCustomer, fetchCustomers } from '../lib/adminCustomers';
import { ApiError } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { formatDateTime, formatSom } from '../lib/format';
import { AdminCustomerListItem } from '../lib/types';
import { CustomerDetailView } from '../components/CustomerDetailView';
import { LIFECYCLE_LABELS, LifecycleState } from '../lib/adminGrowth';
import { findNav } from '../lib/nav';
import { Column, ConfirmDialog, DataTable, EmptyState, ErrorState, FilterBar, LoadingState, PageHeader, SearchInput, SectionCard } from '../ui';

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
  const [deactivateFor, setDeactivateFor] = useState<AdminCustomerListItem | null>(null);
  const [deactivating, setDeactivating] = useState(false);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Debounced search: avoids firing a request on every keystroke (spec Part 10 — server-side
  // search should not be hit more than necessary). reloadKey forces a fresh page-1 fetch after a
  // customer is deactivated, so they disappear from the list without a manual refresh (Phase 26).
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
  }, [searchInput, reloadKey]);

  // Phase 26: soft delete only (Customer.isActive = false) — historical orders/loyalty/rewards/
  // referrals are never touched. Deactivating from either the list or the detail page ends up here.
  const handleDeactivate = async () => {
    if (!deactivateFor) return;
    setDeactivating(true);
    setDeactivateError(null);
    try {
      await deactivateCustomer(deactivateFor.id);
      setNotice(`${deactivateFor.displayName ?? 'Customer'} was removed from the active customer list. Their historical orders and activity are retained.`);
      setDeactivateFor(null);
      setReloadKey((k) => k + 1);
    } catch (err) {
      setDeactivateError(errorMessage(err, "Mijozni o'chirib bo'lmadi. Qayta urinib ko'ring."));
    } finally {
      setDeactivating(false);
    }
  };

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
    return (
      <CustomerDetailView
        customerId={selectedCustomerId}
        onBack={() => setSelectedCustomerId(null)}
        onDeactivated={() => {
          setSelectedCustomerId(null);
          setNotice('Customer was removed from the active customer list. Their historical orders and activity are retained.');
          setReloadKey((k) => k + 1);
        }}
      />
    );
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
    {
      key: 'actions',
      header: '',
      actions: true,
      cell: (c) => (
        <button
          className="button-secondary button--sm"
          onClick={(e) => {
            e.stopPropagation();
            setDeactivateFor(c);
          }}
          type="button"
        >
          Deactivate
        </button>
      ),
    },
  ];

  return (
    <>
      <PageHeader description={findNav('customers').item.description} title="Customers" />

      <FilterBar>
        <SearchInput label="Search customers" onChange={setSearchInput} placeholder="Search name or phone" value={searchInput} />
      </FilterBar>

      {notice && <div className="callout callout--ok">{notice}</div>}
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

      {deactivateFor && (
        <ConfirmDialog
          busy={deactivating}
          confirmLabel="Deactivate"
          error={deactivateError}
          message={`${deactivateFor.displayName ?? 'This customer'} will be removed from the active customer list and search. Their historical orders, loyalty activity and any linked Poster identity are retained — this cannot be undone from the Admin panel.`}
          onCancel={() => {
            setDeactivateFor(null);
            setDeactivateError(null);
          }}
          onConfirm={handleDeactivate}
          tone="danger"
          title="Deactivate this customer?"
        />
      )}
    </>
  );
}
