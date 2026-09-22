import { useEffect, useState } from 'react';
import { deleteSegment, fetchSegment, fetchSegmentCustomers } from '../lib/adminSegments';
import { ApiError } from '../lib/api';
import { formatDateTime, formatSom } from '../lib/format';
import { Segment, SEGMENT_FIELD_META, SEGMENT_OPERATOR_LABELS, SegmentMatchingCustomer } from '../lib/types';

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
      <button className="button-secondary" onClick={onBack} type="button" style={{ marginBottom: 16 }}>
        ← Back to segments
      </button>

      {error && <p className="error-text">{error}</p>}
      {!segment && !error && <p className="hint-text">Loading...</p>}

      {segment && (
        <>
          <h1>{segment.name}</h1>
          {segment.description && <p className="hint-text">{segment.description}</p>}
          <p className="hint-text">{segment.isActive ? 'Active' : 'Inactive'}</p>

          <div className="settings-card">
            <h3 style={{ margin: 0 }}>Conditions ({segment.logic === 'AND' ? 'match ALL' : 'match ANY'})</h3>
            {segment.conditions.map((condition, index) => (
              <div className="settings-row" key={index}>
                <span className="settings-row__label">{SEGMENT_FIELD_META[condition.field].label}</span>
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

          <div className="settings-footer">
            <button className="button-primary" onClick={() => onEdit(segment)} type="button">
              Edit
            </button>
            <button className="button-secondary" disabled={isDeleting} onClick={handleDelete} type="button">
              {isDeleting ? 'Deleting...' : 'Delete'}
            </button>
          </div>

          <h3>Matching customers</h3>
          {customers === null ? (
            <p className="hint-text">Loading...</p>
          ) : customers.length === 0 ? (
            <p className="hint-text">No customers currently match this segment.</p>
          ) : (
            <>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Phone</th>
                    <th>Orders</th>
                    <th>Total spent</th>
                    <th>Average order</th>
                    <th>Last order</th>
                    <th>Favorite branch</th>
                    <th>Loyalty</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((customer) => (
                    <tr key={customer.id}>
                      <td>{customer.displayName ?? '—'}</td>
                      <td>{customer.phone ?? '—'}</td>
                      <td>{customer.orderCount}</td>
                      <td>{formatSom(customer.totalSpentMinor)}</td>
                      <td>{formatSom(customer.averageOrderMinor)}</td>
                      <td>{customer.lastOrderAt ? formatDateTime(customer.lastOrderAt) : '—'}</td>
                      <td>{customer.favoriteBranch ?? '—'}</td>
                      <td>{customer.loyaltyBalance.toLocaleString('ru-RU')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {nextCursor && (
                <button
                  className="button-secondary"
                  disabled={isLoadingMore}
                  onClick={handleLoadMore}
                  style={{ marginTop: 12 }}
                  type="button"
                >
                  {isLoadingMore ? 'Loading...' : 'Load more'}
                </button>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
