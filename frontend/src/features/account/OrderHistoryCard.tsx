import { OrderSummary } from '../../types/api';
import { formatDateTime, formatSom } from '../../lib/format';
import { getOrderStatusLabel, getOrderStatusTone } from '../../lib/orderStatusLabels';
import { cx } from '../../lib/cx';

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
    <button className="flex min-h-11 w-full items-center justify-between gap-3 border-t border-line py-4 text-left cursor-pointer active:bg-cream-soft" onClick={onOpen} type="button">
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-lead font-semibold">{formatDateTime(order.createdAt)}</span>
        {order.branch && <span className="text-small text-muted">{order.branch.name}</span>}
        <span className={cx("inline-flex items-center gap-1.5 text-small font-semibold before:size-[7px] before:shrink-0 before:rounded-full before:content-['']", tone === 'active' ? 'before:bg-terracotta' : tone === 'muted' ? 'text-muted before:bg-muted' : 'before:bg-black')}>
          {getOrderStatusLabel(order.status)}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-0.5 text-right tabular-nums">
        <span className="text-lead font-semibold">{formatSom(order.totalMinor)}</span>
      </span>
    </button>
  );
}
