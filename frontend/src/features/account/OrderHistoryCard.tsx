import { OrderSummary } from '../../types/api';
import { formatDateTime, formatSom } from '../../lib/format';
import { getOrderStatusLabel, getOrderStatusTone } from '../../lib/orderStatusLabels';

interface OrderHistoryCardProps {
  order: OrderSummary;
  onOpen: () => void;
}

// The list endpoint deliberately doesn't include line items (spec section 13 — avoiding an
// N+1-shaped cost on every history row), so a row shows only what GET /orders actually returns:
// status, total, branch, date. Full item detail is one tap away via Order Detail. The raw order
// id is never displayed — the date is the consumer-facing handle.
export function OrderHistoryCard({ order, onOpen }: OrderHistoryCardProps) {
  const tone = getOrderStatusTone(order.status);
  return (
    <button className="row" onClick={onOpen} type="button">
      <span className="row__main">
        <span className="row__title">{formatDateTime(order.createdAt)}</span>
        {order.branch && <span className="row__meta">{order.branch.name}</span>}
        <span className={`status${tone === 'active' ? ' status--active' : tone === 'muted' ? ' status--muted' : ''}`}>
          {getOrderStatusLabel(order.status)}
        </span>
      </span>
      <span className="row__aside">
        <span className="row__amount">{formatSom(order.totalMinor)}</span>
      </span>
    </button>
  );
}
