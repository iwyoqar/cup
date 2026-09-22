import { OrderStatus } from '../types/api';

// Spec section 13/32: only Poster status "0" -> 'pending' and "1" -> 'accepted' are verified
// (see poster-status-map.ts). 'preparing'/'ready'/'completed'/'cancelled' are declared in the
// backend's OrderStatus enum but no current code path sets them yet. Every label here is a
// neutral, literal description of the CUP-internal status name itself — never an invented
// pickup/readiness meaning like "tayyor" or "olib keting" that the backend doesn't establish.
const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'Buyurtma qabul qilinmoqda...',
  sent_to_poster: 'Buyurtma yuborildi, tasdiqlanishi kutilmoqda...',
  accepted: 'Buyurtma filial tomonidan qabul qilindi',
  preparing: 'Buyurtma holati yangilanmoqda...',
  ready: 'Buyurtma holati yangilanmoqda...',
  completed: 'Buyurtma yakunlandi',
  cancelled: 'Buyurtma bekor qilindi',
  failed: 'Buyurtma amalga oshmadi',
  uncertain: 'Buyurtma holati aniqlanmagan — tekshirilmoqda',
};

export function getOrderStatusLabel(status: OrderStatus): string {
  return ORDER_STATUS_LABELS[status] ?? 'Buyurtma holati yangilanmoqda...';
}

// Mirrors src/common/enums/order-status.ts's TERMINAL_ORDER_STATUSES exactly — polling must
// stop here, not on 'accepted' (spec section 14 explicitly warns against assuming that's final).
const TERMINAL_ORDER_STATUSES: readonly OrderStatus[] = ['completed', 'cancelled', 'failed'];

export function isTerminalOrderStatus(status: OrderStatus): boolean {
  return TERMINAL_ORDER_STATUSES.includes(status);
}

// Phase 10: presentation-only grouping for the small status dot — which statuses are "still moving"
// (terracotta), settled (black), or dead ends (muted). Purely visual; the labels above remain the
// only customer-facing wording, and no new status semantics are implied.
export type OrderStatusTone = 'active' | 'settled' | 'muted';

export function getOrderStatusTone(status: OrderStatus): OrderStatusTone {
  if (status === 'cancelled' || status === 'failed') return 'muted';
  if (status === 'accepted' || status === 'completed') return 'settled';
  return 'active';
}
