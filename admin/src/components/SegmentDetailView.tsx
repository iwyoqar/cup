import { useEffect, useState } from 'react';
import { deleteSegment, fetchSegment, fetchSegmentCustomers } from '../lib/adminSegments';
import { ApiError } from '../lib/api';
import { formatDateTime, formatSom } from '../lib/format';
import { Segment, SEGMENT_FIELD_META, SEGMENT_OPERATOR_LABELS, SegmentMatchingCustomer } from '../lib/types';
import { Button, tableClass } from '../ui';

interface SegmentDetailViewProps {
  segmentId: string;
  onBack: () => void;
  onEdit: (segment: Segment) => void;
  onDeleted: () => void;
}

export function SegmentDetailView({ segmentId, onBack, onEdit, onDeleted }: SegmentDetailViewProps) {
  const [segment, setSegment] = useState<Segment | null>(null);
  const [customers, setCustomers] = useState<SegmentMatchingCustomer[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSegment(null);
    setCustomers(null);
    setError(null);
    Promise.all([fetchSegment(segmentId), fetchSegmentCustomers(segmentId)])
      .then(([segmentResult, customersPage]) => {
        if (cancelled) return;
        setSegment(segmentResult);
        setCustomers(customersPage.items);
        setNextCursor(customersPage.nextCursor);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.backendMessage : 'Failed to load segment.');
      });
    return () => {
      cancelled = true;
    };
  }, [segmentId]);

  const handleLoadMore = async () => {
    if (!nextCursor) return;
    setIsLoadingMore(true);
    try {
      const page = await fetchSegmentCustomers(segmentId, nextCursor);
      setCustomers((current) => [...(current ?? []), ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (err) {
      setError(err instanceof ApiError ? err.backendMessage : 'Failed to load more customers.');
    } finally {
      setIsLoadingMore(false);
    }
  };

  const handleDelete = async () => {
    if (!segment) return;
    setIsDeleting(true);
    try {
      await deleteSegment(segment.id);
      onDeleted();
    } catch (err) {
      setError(err instanceof ApiError ? err.backendMessage : 'Failed to delete segment.');
      setIsDeleting(false);
    }
  };

  return (
    <div>
      <Button onClick={onBack} className="mb-4" variant="secondary">
        ← Back to segments
      </Button>

      {error && <p className="text-[13px] font-semibold text-err">{error}</p>}
      {!segment && !error && <p className="text-[13px] leading-snug text-muted">Loading...</p>}

      {segment && (
        <>
          <h1>{segment.name}</h1>
          {segment.description && <p className="text-[13px] leading-snug text-muted">{segment.description}</p>}
          <p className="text-[13px] leading-snug text-muted">{segment.isActive ? 'Active' : 'Inactive'}</p>

          <div className="mt-4 flex flex-col gap-4 rounded-lg border border-line bg-white p-6 [&>h3]:font-display [&>h3]:text-xl [&>h3]:font-medium">
            <h3 className="m-0">Conditions ({segment.logic === 'AND' ? 'match ALL' : 'match ANY'})</h3>
            {segment.conditions.map((condition, index) => (
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4 last:border-b-0 last:pb-0" key={index}>
                <span className="text-sm font-semibold">{SEGMENT_FIELD_META[condition.field].label}</span>
                <span>
                  {SEGMENT_OPERATOR_LABELS[condition.operator]} {condition.value}
                  {SEGMENT_FIELD_META[condition.field].valueType === 'number' &&
                  (condition.field === 'totalSpentMinor' || condition.field === 'averageOrderMinor')
                    ? " so'm"
                    : ''}
                </span>
              </div>
            ))}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Button onClick={() => onEdit(segment)} variant="primary">
              Edit
            </Button>
            <Button disabled={isDeleting} onClick={handleDelete} variant="secondary">
              {isDeleting ? 'Deleting...' : 'Delete'}
            </Button>
          </div>

          <h3>Matching customers</h3>
          {customers === null ? (
            <p className="text-[13px] leading-snug text-muted">Loading...</p>
          ) : customers.length === 0 ? (
            <p className="text-[13px] leading-snug text-muted">No customers currently match this segment.</p>
          ) : (
            <>
              <table className={tableClass.table}>
                <thead>
                  <tr>
                    <th className={tableClass.th}>Name</th>
                    <th className={tableClass.th}>Phone</th>
                    <th className={tableClass.th}>Orders</th>
                    <th className={tableClass.th}>Total spent</th>
                    <th className={tableClass.th}>Average order</th>
                    <th className={tableClass.th}>Last order</th>
                    <th className={tableClass.th}>Favorite branch</th>
                    <th className={tableClass.th}>Loyalty</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((customer) => (
                    <tr className={tableClass.tr} key={customer.id}>
                      <td className={tableClass.td}>{customer.displayName ?? '—'}</td>
                      <td className={tableClass.td}>{customer.phone ?? '—'}</td>
                      <td className={tableClass.td}>{customer.orderCount}</td>
                      <td className={tableClass.td}>{formatSom(customer.totalSpentMinor)}</td>
                      <td className={tableClass.td}>{formatSom(customer.averageOrderMinor)}</td>
                      <td className={tableClass.td}>{customer.lastOrderAt ? formatDateTime(customer.lastOrderAt) : '—'}</td>
                      <td className={tableClass.td}>{customer.favoriteBranch ?? '—'}</td>
                      <td className={tableClass.td}>{customer.loyaltyBalance.toLocaleString('ru-RU')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {nextCursor && (
                <Button disabled={isLoadingMore} onClick={handleLoadMore} className="mt-3" variant="secondary">
                  {isLoadingMore ? 'Loading...' : 'Load more'}
                </Button>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
