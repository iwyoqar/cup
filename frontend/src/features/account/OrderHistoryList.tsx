import { useEffect, useState } from 'react';
import { OrderSummary, SubscriptionRedemptionItem } from '../../types/api';
import { fetchMyOrders } from '../../lib/api/orders';
import { fetchMySubscriptionRedemptions } from '../../lib/api/subscriptions';
import { toUserMessage } from '../../lib/api/errors';
import { OrderHistoryCard } from './OrderHistoryCard';
import { SubscriptionHistoryCard } from './SubscriptionHistoryCard';
import { ErrorBanner } from '../../app/ErrorBanner';
import { EmptyState } from '../../app/EmptyState';
import { SectionSkeleton } from '../../app/SectionSkeleton';
import { buttonSecondary } from '../../app/buttonStyles';
import { cx } from '../../lib/cx';

interface OrderHistoryListProps {
  onOpenOrder: (orderId: string) => void;
  onGoToCatalog: () => void;
}

type HistoryEntry = { kind: 'order'; at: number; order: OrderSummary } | { kind: 'subscription'; at: number; item: SubscriptionRedemptionItem };

// Bounded, cursor-paginated (spec sections 3/13) — loads one page on mount, and only fetches
// more when the customer explicitly asks for it, never the whole history at once.
// Coffee Subscription: the same list also shows coffees taken under a subscription (badged). Orders and subscription coffees keep their OWN
// cursors (two backend lists, no merged endpoint); entries are shown newest-first, but only down to the oldest point BOTH lists are known to
// cover — so a later page can never slot an item above one already on screen.
export function OrderHistoryList({ onOpenOrder, onGoToCatalog }: OrderHistoryListProps) {
  const [items, setItems] = useState<OrderSummary[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [subs, setSubs] = useState<SubscriptionRedemptionItem[]>([]);
  const [subCursor, setSubCursor] = useState<string | null>(null);
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
    // Optional: a subscription-history problem must never hide the order history.
    fetchMySubscriptionRedemptions()
      .then((page) => {
        if (cancelled) return;
        setSubs(page.items);
        setSubCursor(page.nextCursor);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const handleLoadMore = async () => {
    if (!nextCursor && !subCursor) return;
    setIsLoadingMore(true);
    setError(null);
    try {
      const [orderPage, subPage] = await Promise.all([nextCursor ? fetchMyOrders(nextCursor) : Promise.resolve(null), subCursor ? fetchMySubscriptionRedemptions(subCursor).catch(() => null) : Promise.resolve(null)]);
      if (orderPage) {
        setItems((current) => [...(current ?? []), ...orderPage.items]);
        setNextCursor(orderPage.nextCursor);
      }
      if (subPage) {
        setSubs((current) => [...current, ...subPage.items]);
        setSubCursor(subPage.nextCursor);
      }
    } catch (err) {
      setError(toUserMessage(err));
    } finally {
      setIsLoadingMore(false);
    }
  };

  if (items === null) {
    if (error) {
      return <p className="text-small leading-[1.45] text-muted">{error}</p>;
    }
    return <SectionSkeleton height={160} />;
  }

  if (items.length === 0 && subs.length === 0) {
    return (
      <EmptyState
        title="Hali buyurtmalar yo'q"
        message="Birinchi buyurtmangiz shu yerda ko'rinadi."
        actionLabel="Coffee tanlash"
        onAction={onGoToCatalog}
      />
    );
  }

  const entries: HistoryEntry[] = [
    ...items.map((order) => ({ kind: 'order' as const, at: new Date(order.createdAt).getTime(), order })),
    ...subs.map((item) => ({ kind: 'subscription' as const, at: new Date(item.at).getTime(), item })),
  ].sort((a, b) => b.at - a.at);
  const boundaries = [nextCursor && items.length ? new Date(items[items.length - 1].createdAt).getTime() : null, subCursor && subs.length ? new Date(subs[subs.length - 1].at).getTime() : null].filter((b): b is number => b !== null);
  const boundary = boundaries.length ? Math.max(...boundaries) : null;
  const visible = boundary === null ? entries : entries.filter((e) => e.at >= boundary);

  return (
    <div className="flex flex-col">
      <ErrorBanner message={error} onDismiss={() => setError(null)} />
      {visible.map((e) =>
        e.kind === 'order' ? <OrderHistoryCard key={e.order.id} order={e.order} onOpen={() => onOpenOrder(e.order.id)} /> : <SubscriptionHistoryCard item={e.item} key={e.item.id} />,
      )}
      {(nextCursor || subCursor) && (
        <button
          className={cx(buttonSecondary, 'mt-3 self-start')}
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
