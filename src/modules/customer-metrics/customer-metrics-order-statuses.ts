import { OrderStatus } from '../../common/enums/order-status';

// Phase 4/5: which CUP OrderStatus values count toward customer metrics (orderCount,
// totalSpentMinor, first/lastOrderAt, favoriteBranch, and segment matching). The single
// canonical definition — reused by Customer 360 (admin-customers) AND segment evaluation
// (segments), never redefined. Documented explicitly per the instruction not to silently
// include/exclude statuses.
//
// EXCLUDED, and why:
// - 'pending'    — the order row was created but Poster was never confirmed to have received
//                  it (this status only persists if the process crashed between creating the
//                  row and getting Poster's response — see orders.service.ts's
//                  attemptFreshCreate). Not a confirmed purchase.
// - 'failed'     — Poster explicitly rejected the request; no real order exists at Poster.
// - 'cancelled'  — the order was cancelled (no current code path sets this yet, excluded on
//                  principle per the explicit instruction).
// - 'uncertain'  — CUP cannot confirm whether Poster ever created this order (an ambiguous
//                  create outcome). Counting it risks crediting a purchase that may not exist.
//
// INCLUDED, and why:
// - 'sent_to_poster' — Poster's createIncomingOrder call succeeded; a real Poster order exists.
// - 'accepted'        — Poster additionally confirmed staff acceptance (the only other status
//                        actually verified live against the real Poster account — see
//                        poster-status-map.ts).
// - 'preparing' / 'ready' / 'completed' — declared-but-not-yet-reached CUP lifecycle stages
//                        (see order-status.ts); if a future Poster status mapping starts
//                        setting these, they represent equally real, later-stage orders and
//                        should already count.
export const CUSTOMER_METRICS_ORDER_STATUSES: readonly OrderStatus[] = [
  'sent_to_poster',
  'accepted',
  'preparing',
  'ready',
  'completed',
];
