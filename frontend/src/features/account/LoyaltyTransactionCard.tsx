import { LoyaltyTransaction } from '../../types/api';
import { formatDateTime } from '../../lib/format';
import { getLoyaltyTransactionLabel } from '../../lib/loyaltyTransactionLabels';
import { cx } from '../../lib/cx';

interface LoyaltyTransactionCardProps {
  transaction: LoyaltyTransaction;
}

// Only customer-safe fields are shown — never loyaltyAccountId or any other internal field
// (spec section 5/11). id is used only as the React key, never rendered.
export function LoyaltyTransactionCard({ transaction }: LoyaltyTransactionCardProps) {
  const isGain = transaction.points > 0;
  const sign = isGain ? `+${transaction.points}` : String(transaction.points);
  return (
    <div className="flex min-h-11 w-full items-center justify-between gap-3 border-t border-line py-4 text-left">
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="text-body font-semibold">
          {getLoyaltyTransactionLabel(transaction.type)}
        </div>
        <div className="text-small text-muted">{formatDateTime(transaction.createdAt)}</div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-0.5 text-right tabular-nums">
        <span className={cx('text-lead font-semibold', isGain && 'text-terracotta-deep')}>{sign}</span>
        <span className="text-small text-muted">ball</span>
      </div>
    </div>
  );
}
