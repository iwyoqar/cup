import { OrderStatus } from '../../common/enums/order-status';

// Centralized status label mapping (spec section 20): no `if (status === '0')` scattered
// through the codebase. Only Poster status "0" -> 'pending' and "1" -> 'accepted' are verified
// (poster-status-map.ts) — every other value here gets a neutral, literal description of the
// CUP-internal status name itself, never an invented business meaning ("tayyor", "olib
// keting") the backend/Poster semantics don't actually establish. Mirrors
// frontend/src/lib/orderStatusLabels.ts so the Mini App and Telegram messages agree.
const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'Buyurtma qabul qilinmoqda',
  sent_to_poster: 'Buyurtma yuborildi, tasdiqlanishi kutilmoqda',
  accepted: 'Buyurtma filial tomonidan qabul qilindi',
  preparing: 'Buyurtma holati yangilandi',
  ready: 'Buyurtma holati yangilandi',
  completed: 'Buyurtma yakunlandi',
  cancelled: 'Buyurtma bekor qilindi',
  failed: 'Buyurtma amalga oshmadi',
  uncertain: 'Buyurtma holati aniqlanmagan',
};

export function getOrderStatusLabel(status: OrderStatus): string {
  return ORDER_STATUS_LABELS[status] ?? 'Buyurtma holati yangilandi.';
}

// Spec section 24: the customer must never get a Telegram message purely because the FIRST
// sync cycle after checkout observed the order's initial pre-acceptance state — 'pending' and
// 'sent_to_poster' both mean "not yet meaningfully different from what checkout already
// implied" from the customer's point of view. Notifications start only once the order reaches
// a status that actually says something new: accepted, or a later/terminal state.
const SILENT_ORDER_STATUSES: readonly OrderStatus[] = ['pending', 'sent_to_poster'];

export function isNotifiableStatusTransition(newStatus: OrderStatus): boolean {
  return !SILENT_ORDER_STATUSES.includes(newStatus);
}
