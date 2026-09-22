import { apiRequest } from './client';
import { CheckoutResponse, Order, OrderListPage } from '../../types/api';

// Reuses the exact existing Phase 1.5 contract: empty body, Idempotency-Key header, customer
// and branch resolved server-side from the authenticated session and the cart itself. Never
// sends customerId/branchId/price — see cart.controller.ts.
export function checkout(idempotencyKey: string): Promise<CheckoutResponse> {
  return apiRequest<CheckoutResponse>('/cart/checkout', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

// GET /orders/:id is ownership-checked server-side from the authenticated session — never
// pass or need a customerId here.
export function fetchOrder(orderId: string): Promise<Order> {
  return apiRequest<Order>(`/orders/${orderId}`);
}

// Phase 2: GET /orders (the authenticated customer's own order history). `cursor` is opaque —
// pass back exactly whatever the previous page's `nextCursor` was, never construct one.
export function fetchMyOrders(cursor?: string): Promise<OrderListPage> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  return apiRequest<OrderListPage>(`/orders${query}`);
}
