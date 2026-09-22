// CUP-internal order status union. Stored as a plain `String` column (not a Prisma enum)
// because the sqlite connector does not support Prisma enums — see docs/PHASE-0-PLAN.md.
//
// Only "pending" (Poster status "0") and "accepted" (Poster status "1") have been verified
// against the real Poster test account. The remaining values are provisional CUP-side
// concepts for later lifecycle stages; poster-status-map.ts only ever maps verified Poster
// codes and throws for anything else, so no undocumented Poster behavior is assumed here.
export const ORDER_STATUSES = [
  'pending',
  'sent_to_poster',
  'uncertain',
  'accepted',
  'preparing',
  'ready',
  'completed',
  'cancelled',
  'failed',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const TERMINAL_ORDER_STATUSES: readonly OrderStatus[] = ['completed', 'cancelled', 'failed'];

export function isOrderStatus(value: string): value is OrderStatus {
  return (ORDER_STATUSES as readonly string[]).includes(value);
}

// Orders eligible for the background status poller: they have a known posterIncomingOrderId
// and have not reached a terminal state. "pending" (not yet sent) and "uncertain" (ambiguous
// create outcome, no known incoming_order_id) are deliberately excluded — see docs/PHASE-0-PLAN.md.
export const POLLABLE_ORDER_STATUSES: readonly OrderStatus[] = ['sent_to_poster', 'accepted', 'preparing', 'ready'];

export function isPollableOrderStatus(status: OrderStatus): boolean {
  return POLLABLE_ORDER_STATUSES.includes(status);
}
