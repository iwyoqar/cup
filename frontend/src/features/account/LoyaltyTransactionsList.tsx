import { useEffect, useState } from 'react';
import { LoyaltyTransaction } from '../../types/api';
import { fetchMyLoyaltyTransactions } from '../../lib/api/loyalty';
import { toUserMessage } from '../../lib/api/errors';
import { LoyaltyTransactionCard } from './LoyaltyTransactionCard';
import { ErrorBanner } from '../../app/ErrorBanner';
import { EmptyState } from '../../app/EmptyState';
import { SectionSkeleton } from '../../app/SectionSkeleton';
import { buttonSecondary } from '../../app/buttonStyles';
import { cx } from '../../lib/cx';

interface LoyaltyTransactionsListProps {
  onBack: () => void;
}

// Same bounded, cursor-paginated pattern as OrderHistoryList — loads one page on mount, only
// fetches more when explicitly asked.
export function LoyaltyTransactionsList({ onBack }: LoyaltyTransactionsListProps) {
  const [items, setItems] = useState<LoyaltyTransaction[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchMyLoyaltyTransactions()
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
      const page = await fetchMyLoyaltyTransactions(nextCursor);
      setItems((current) => [...(current ?? []), ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (err) {
      setError(toUserMessage(err));
    } finally {
      setIsLoadingMore(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col gap-6 px-4 pt-3 pb-8">
      <div className="-mx-4 flex min-h-11 items-center gap-2 px-4">
        <button className="min-h-11 cursor-pointer py-2.5 text-small font-semibold tracking-[0.02em] text-black" onClick={onBack} type="button">
          ← Hisobim
        </button>
      </div>

      <h1 className="font-display text-display leading-[1.08] font-medium tracking-[-0.01em]">Ballar tarixi</h1>

      {items === null ? (
        error ? (
          <p className="text-small leading-[1.45] text-muted">Ballar ma'lumotini yuklab bo'lmadi</p>
        ) : (
          <SectionSkeleton height={160} />
        )
      ) : items.length === 0 ? (
        <EmptyState variant="inline" title="Hali ballar tarixi yo'q" />
      ) : (
        <div className="flex flex-col">
          <ErrorBanner message={error} onDismiss={() => setError(null)} />
          {items.map((transaction) => (
            <LoyaltyTransactionCard key={transaction.id} transaction={transaction} />
          ))}
          {nextCursor && (
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
      )}
    </div>
  );
}
