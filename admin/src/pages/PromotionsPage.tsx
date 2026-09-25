import { useEffect, useState } from 'react';
import { fetchPromotions } from '../lib/adminPromotions';
import { ApiError } from '../lib/api';
import { formatDate } from '../lib/format';
import { Promotion, PromotionListItem } from '../lib/types';
import { PromotionForm } from '../components/PromotionForm';
import { PromotionDetailView } from '../components/PromotionDetailView';

import { findNav } from '../lib/nav';
import { Button, Column, DataTable, EmptyState, ErrorState, LoadingState, PageHeader, SectionCard, StatusBadge } from '../ui';
type View = { kind: 'list' } | { kind: 'create' } | { kind: 'edit'; promotion: Promotion } | { kind: 'detail'; promotionId: string };

function describeBenefit(item: PromotionListItem): string {
  switch (item.benefit.type) {
    case 'PERCENT_DISCOUNT':
      return `${item.benefit.value}% off`;
    case 'FIXED_DISCOUNT':
      return `${item.benefit.value?.toLocaleString('ru-RU')} so'm off`;
    case 'FREE_PRODUCT':
      return `Free ${item.benefit.product?.name ?? 'product'} × ${item.benefit.quantity ?? 1}`;
    case 'LOYALTY_POINTS':
      return `+${item.benefit.value} points`;
    default:
      return item.benefit.type;
  }
}

export function PromotionsPage() {
  const [view, setView] = useState<View>({ kind: 'list' });
  const [items, setItems] = useState<PromotionListItem[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const loadList = () => {
    setItems(null);
    setError(null);
    fetchPromotions()
      .then((page) => {
        setItems(page.items);
        setNextCursor(page.nextCursor);
      })
      .catch((err) => setError(err instanceof ApiError ? err.backendMessage : 'Failed to load promotions.'));
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
      const page = await fetchPromotions(nextCursor);
      setItems((current) => [...(current ?? []), ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (err) {
      setError(err instanceof ApiError ? err.backendMessage : 'Failed to load more promotions.');
    } finally {
      setIsLoadingMore(false);
    }
  };

  if (view.kind === 'create') {
    return (
      <PromotionForm onCancel={() => setView({ kind: 'list' })} onSaved={(saved) => setView({ kind: 'detail', promotionId: saved.id })} />
    );
  }

  if (view.kind === 'edit') {
    return (
      <PromotionForm
        existing={view.promotion}
        onCancel={() => setView({ kind: 'detail', promotionId: view.promotion.id })}
        onSaved={(saved) => setView({ kind: 'detail', promotionId: saved.id })}
      />
    );
  }

  if (view.kind === 'detail') {
    return (
      <PromotionDetailView
        onBack={() => setView({ kind: 'list' })}
        onDeleted={() => setView({ kind: 'list' })}
        onEdit={(promotion) => setView({ kind: 'edit', promotion })}
        promotionId={view.promotionId}
      />
    );
  }

  const columns: Column<PromotionListItem>[] = [
    { key: 'name', header: 'Promotion', cell: (promotion) => <span className="font-semibold text-black">{promotion.name}</span> },
    { key: 'segment', header: 'Audience', low: true, cell: (promotion) => (promotion.segment ? promotion.segment.name : 'Everyone') },
    { key: 'benefit', header: 'Benefit', cell: (promotion) => describeBenefit(promotion) },
    { key: 'status', header: 'Status', cell: (promotion) => (promotion.isActive ? <StatusBadge dot tone="ok">Active</StatusBadge> : <StatusBadge dot>Inactive</StatusBadge>) },
    {
      key: 'validity',
      header: 'Validity',
      low: true,
      cell: (promotion) => (
        <>
          {formatDate(promotion.startsAt)}
          {promotion.endsAt ? ` – ${formatDate(promotion.endsAt)}` : ' – no end'}
        </>
      ),
    },
    { key: 'limit', header: 'Usage limit', numeric: true, low: true, cell: (promotion) => promotion.usageLimitPerCustomer ?? 'Unlimited' },
    { key: 'updated', header: 'Updated', low: true, cell: (promotion) => formatDate(promotion.updatedAt) },
  ];

  return (
    <>
      <PageHeader
        actions={
          <Button onClick={() => setView({ kind: 'create' })} variant="primary">
            + Create promotion
          </Button>
        }
        description={findNav('promotions').item.description}
        title={findNav('promotions').item.label}
      />

      {error && <ErrorState message={error} title="Promotions could not be loaded" />}

      <SectionCard
        description="Select a promotion to see who is eligible and how often it was used."
        flush
        footer={
          nextCursor ? (
            <Button disabled={isLoadingMore} onClick={handleLoadMore} variant="secondary">
              {isLoadingMore ? 'Loading…' : 'Load more'}
            </Button>
          ) : undefined
        }
        title="Promotions"
      >
        {items === null && !error ? (
          <LoadingState variant="table" />
        ) : (
          <DataTable
            columns={columns}
            empty={
              <EmptyState
                action={
                  <Button onClick={() => setView({ kind: 'create' })} variant="primary">
                    + Create promotion
                  </Button>
                }
                text="Promotions give a chosen segment a discount or a free item for a period. Create the first one."
                title="No promotions yet"
                variant="block"
              />
            }
            onRowClick={(promotion) => setView({ kind: 'detail', promotionId: promotion.id })}
            rowKey={(promotion) => promotion.id}
            rows={items ?? []}
          />
        )}
      </SectionCard>
    </>
  );
}
