import { SubscriptionRedemptionItem } from '../../types/api';
import { formatDateTime } from '../../lib/format';

// One coffee taken under the subscription, shown in the same purchase-history list as paid orders but clearly marked: it is consumption from a
// prepaid subscription (portions), never a paid purchase.
export function SubscriptionHistoryCard({ item }: { item: SubscriptionRedemptionItem }) {
  const pending = item.status !== 'CONFIRMED';
  return (
    <div className="flex min-h-11 w-full items-center justify-between gap-3 border-t border-line py-4 text-left">
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="self-start rounded-[4px] bg-black px-2 py-[3px] text-micro font-bold tracking-[0.14em] text-cream uppercase">Coffee Subscription</span>
        <span className="text-lead font-semibold">{formatDateTime(item.at)}</span>
        <span className="text-small text-muted">
          {item.productName}
          {item.branchName ? ` · ${item.branchName}` : ''}
        </span>
        {pending && <span className="text-small font-semibold text-muted">Tekshirilmoqda</span>}
      </span>
      <span className="flex shrink-0 flex-col items-end gap-0.5 text-right tabular-nums">
        <span className="text-lead font-semibold text-terracotta-deep">−{item.portionCost} porsiya</span>
      </span>
    </div>
  );
}
