import { useEffect, useState } from 'react';
import { fetchSegments } from '../lib/adminSegments';
import { ApiError } from '../lib/api';
import { formatDate } from '../lib/format';
import { Segment } from '../lib/types';
import { SegmentForm } from '../components/SegmentForm';
import { SegmentDetailView } from '../components/SegmentDetailView';

import { findNav } from '../lib/nav';
import { Column, DataTable, EmptyState, ErrorState, LoadingState, PageHeader, SectionCard, StatusBadge } from '../ui';
type View = { kind: 'list' } | { kind: 'create' } | { kind: 'edit'; segment: Segment } | { kind: 'detail'; segmentId: string };

export function SegmentsPage() {
  const [view, setView] = useState<View>({ kind: 'list' });
  const [items, setItems] = useState<Segment[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const loadList = () => {
    setItems(null);
    setError(null);
    fetchSegments()
      .then((page) => {
        setItems(page.items);
        setNextCursor(page.nextCursor);
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.backendMessage : 'Failed to load segments.');
      });
  };

  useEffect(() => {
    if (view.kind === 'list') {
      loadList();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.kind]);

  const handleLoadMore = async () => {
    if (!nextCursor) return;
    setIsLoadingMore(true);
    try {
      const page = await fetchSegments(nextCursor);
      setItems((current) => [...(current ?? []), ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (err) {
      setError(err instanceof ApiError ? err.backendMessage : 'Failed to load more segments.');
    } finally {
      setIsLoadingMore(false);
    }
  };

  if (view.kind === 'create') {
    return (
      <SegmentForm
        onCancel={() => setView({ kind: 'list' })}
        onSaved={(saved) => setView({ kind: 'detail', segmentId: saved.id })}
      />
    );
  }

  if (view.kind === 'edit') {
    return (
      <SegmentForm
        existing={view.segment}
        onCancel={() => setView({ kind: 'detail', segmentId: view.segment.id })}
        onSaved={(saved) => setView({ kind: 'detail', segmentId: saved.id })}
      />
    );
  }

  if (view.kind === 'detail') {
    return (
      <SegmentDetailView
        onBack={() => setView({ kind: 'list' })}
        onDeleted={() => setView({ kind: 'list' })}
        onEdit={(segment) => setView({ kind: 'edit', segment })}
        segmentId={view.segmentId}
      />
    );
  }

  const columns: Column<Segment>[] = [
    { key: 'name', header: 'Segment', cell: (segment) => <span className="table__primary">{segment.name}</span> },
    { key: 'description', header: 'Description', low: true, cell: (segment) => segment.description ?? '—' },
    { key: 'logic', header: 'Logic', low: true, cell: (segment) => segment.logic },
    { key: 'conditions', header: 'Conditions', numeric: true, cell: (segment) => segment.conditions.length },
    { key: 'status', header: 'Status', cell: (segment) => (segment.isActive ? <StatusBadge dot tone="ok">Active</StatusBadge> : <StatusBadge dot>Inactive</StatusBadge>) },
    { key: 'updated', header: 'Updated', low: true, cell: (segment) => formatDate(segment.updatedAt) },
  ];

  return (
    <>
      <PageHeader
        actions={
          <button className="button-primary" onClick={() => setView({ kind: 'create' })} type="button">
            + Create segment
          </button>
        }
        description={findNav('segments').item.description}
        title={findNav('segments').item.label}
      />

      {error && <ErrorState message={error} title="Segments could not be loaded" />}

      <SectionCard
        description="Select a segment to see its rules and the customers who match now."
        flush
        footer={
          nextCursor ? (
            <button className="button-secondary" disabled={isLoadingMore} onClick={handleLoadMore} type="button">
              {isLoadingMore ? 'Loading…' : 'Load more'}
            </button>
          ) : undefined
        }
        title="Segments"
      >
        {items === null && !error ? (
          <LoadingState variant="table" />
        ) : (
          <DataTable
            columns={columns}
            empty={
              <EmptyState
                action={
                  <button className="button-primary" onClick={() => setView({ kind: 'create' })} type="button">
                    + Create segment
                  </button>
                }
                text="A segment is a rule-based group of customers. Campaigns, promotions and automations target segments."
                title="No segments yet"
                variant="block"
              />
            }
            onRowClick={(segment) => setView({ kind: 'detail', segmentId: segment.id })}
            rowKey={(segment) => segment.id}
            rows={items ?? []}
          />
        )}
      </SectionCard>
    </>
  );
}
