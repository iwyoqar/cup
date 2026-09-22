import { useEffect, useState } from 'react';
import { fetchRewardPrograms } from '../lib/adminRewardPrograms';
import { ApiError } from '../lib/api';
import { formatDate } from '../lib/format';
import { RewardProgram, RewardProgramListItem } from '../lib/types';
import { RewardProgramForm } from '../components/RewardProgramForm';
import { RewardProgramDetailView } from '../components/RewardProgramDetailView';

import { findNav } from '../lib/nav';
import { Column, DataTable, EmptyState, ErrorState, LoadingState, PageHeader, SectionCard, StatusBadge } from '../ui';
type View = { kind: 'list' } | { kind: 'create' } | { kind: 'edit'; program: RewardProgram } | { kind: 'detail'; programId: string };

export function RewardProgramsPage() {
  const [view, setView] = useState<View>({ kind: 'list' });
  const [items, setItems] = useState<RewardProgramListItem[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const loadList = () => {
    setItems(null);
    setError(null);
    fetchRewardPrograms()
      .then((page) => {
        setItems(page.items);
        setNextCursor(page.nextCursor);
      })
      .catch((err) => setError(err instanceof ApiError ? err.backendMessage : 'Failed to load reward programs.'));
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
      const page = await fetchRewardPrograms(nextCursor);
      setItems((current) => [...(current ?? []), ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (err) {
      setError(err instanceof ApiError ? err.backendMessage : 'Failed to load more reward programs.');
    } finally {
      setIsLoadingMore(false);
    }
  };

  if (view.kind === 'create') {
    return (
      <RewardProgramForm onCancel={() => setView({ kind: 'list' })} onSaved={(saved) => setView({ kind: 'detail', programId: saved.id })} />
    );
  }

  if (view.kind === 'edit') {
    return (
      <RewardProgramForm
        existing={view.program}
        onCancel={() => setView({ kind: 'detail', programId: view.program.id })}
        onSaved={(saved) => setView({ kind: 'detail', programId: saved.id })}
      />
    );
  }

  if (view.kind === 'detail') {
    return (
      <RewardProgramDetailView
        onBack={() => setView({ kind: 'list' })}
        onDeleted={() => setView({ kind: 'list' })}
        onEdit={(program) => setView({ kind: 'edit', program })}
        programId={view.programId}
      />
    );
  }

  const columns: Column<RewardProgramListItem>[] = [
    { key: 'name', header: 'Program', cell: (program) => <span className="table__primary">{program.name}</span> },
    { key: 'rule', header: 'Qualifying condition', cell: (program) => `Buy ${program.buyQuantity}, get ${program.rewardQuantity} free — ${program.qualifyingCategory.name}` },
    { key: 'status', header: 'Status', cell: (program) => (program.isActive ? <StatusBadge dot tone="ok">Active</StatusBadge> : <StatusBadge dot>Inactive</StatusBadge>) },
    { key: 'updated', header: 'Updated', low: true, cell: (program) => formatDate(program.updatedAt) },
  ];

  return (
    <>
      <PageHeader
        actions={
          <button className="button-primary" onClick={() => setView({ kind: 'create' })} type="button">
            + Create reward program
          </button>
        }
        description={findNav('rewards').item.description}
        title={findNav('rewards').item.label}
      />

      {error && <ErrorState message={error} title="Reward programs could not be loaded" />}

      <SectionCard
        description="Select a program to see its progress, eligible customers and redemptions."
        flush
        footer={
          nextCursor ? (
            <button className="button-secondary" disabled={isLoadingMore} onClick={handleLoadMore} type="button">
              {isLoadingMore ? 'Loading…' : 'Load more'}
            </button>
          ) : undefined
        }
        title="Reward programs"
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
                    + Create reward program
                  </button>
                }
                text="A reward program gives customers a free item after they buy a set number. Create the first one."
                title="No reward programs yet"
                variant="block"
              />
            }
            onRowClick={(program) => setView({ kind: 'detail', programId: program.id })}
            rowKey={(program) => program.id}
            rows={items ?? []}
          />
        )}
      </SectionCard>
    </>
  );
}
