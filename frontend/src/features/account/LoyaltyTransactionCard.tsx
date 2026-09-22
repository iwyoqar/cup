import { LoyaltyTransaction } from '../../types/api';
import { formatDateTime } from '../../lib/format';
import { getLoyaltyTransactionLabel } from '../../lib/loyaltyTransactionLabels';

interface LoyaltyTransactionCardProps {
  transaction: LoyaltyTransaction;
}

// Only customer-safe fields are shown — never loyaltyAccountId or any other internal field
// (spec section 5/11). id is used only as the React key, never rendered.
export function LoyaltyTransactionCard({ transaction }: LoyaltyTransactionCardProps) {
  const isGain = transaction.points > 0;
  const sign = isGain ? `+${transaction.points}` : String(transaction.points);
  return (
    <div className="row">
      <div className="row__main">
        <div className="row__title" style={{ fontSize: 'var(--fs-body)' }}>
          {getLoyaltyTransactionLabel(transaction.type)}
        </div>
        <div className="row__meta">{formatDateTime(transaction.createdAt)}</div>
      </div>
      <div className="row__aside">
        <span className={`row__amount${isGain ? ' row__amount--plus' : ''}`}>{sign}</span>
        <span className="row__meta">ball</span>
      </div>
    </div>
  );
}
