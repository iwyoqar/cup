import { useEffect, useState } from 'react';
import { OrderSummary } from '../../types/api';
import { fetchMyOrders } from '../../lib/api/orders';
import { toUserMessage } from '../../lib/api/errors';
import { OrderHistoryCard } from './OrderHistoryCard';
import { ErrorBanner } from '../../app/ErrorBanner';
import { EmptyState } from '../../app/EmptyState';
import { SectionSkeleton } from '../../app/SectionSkeleton';

interface OrderHistoryListProps {
  onOpenOrder: (orderId: string) => void;
  onGoToCatalog: () => void;
}

// Bounded, cursor-paginated (spec sections 3/13) — loads one page on mount, and only fetches
// more when the customer explicitly asks for it, never the whole history at once.
export function OrderHistoryList({ onOpenOrder, onGoToCatalog }: OrderHistoryListProps) {
  const [items, setItems] = useState<OrderSummary[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchMyOrders()
      .then((page) => {
        if (cancelled) return;
        setItems(page.items);
        setNextCursor(page.nextCursor);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(toUserMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleLoadMore = async () => {
    if (!nextCursor) return;
    setIsLoadingMore(true);
    setError(null);
    try {
      const page = await fetchMyOrders(nextCursor);
      setItems((current) => [...(current ?? []), ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (err) {
      setError(toUserMessage(err));
    } finally {
      setIsLoadingMore(false);
    }
  };

  if (items === null) {
    if (error) {
      return <p className="hint-text">{error}</p>;
    }
    return <SectionSkeleton height={160} />;
  }

  if (items.length === 0) {
    return (
      <EmptyState
        title="Hali buyurtmalar yo'q"
        message="Birinchi buyurtmangiz shu yerda ko'rinadi."
        actionLabel="Coffee tanlash"
        onAction={onGoToCatalog}
      />
    );
  }

  return (
    <div className="rows">
      <ErrorBanner message={error} onDismiss={() => setError(null)} />
      {items.map((order) => (
        <OrderHistoryCard key={order.id} order={order} onOpen={() => onOpenOrder(order.id)} />
      ))}
      {nextCursor && (
        <button
          className="button-secondary"
          style={{ alignSelf: 'flex-start', marginTop: 'var(--space-3)' }}
          disabled={isLoadingMore}
          onClick={handleLoadMore}
          type="button"
        >
          {isLoadingMore ? 'Yuklanmoqda...' : "Ko'proq yuklash"}
        </button>
      )}
    </div>
  );
}
