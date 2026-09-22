import { apiRequest } from './client';
import { LoyaltyAccount, LoyaltyHistoryPage, LoyaltyOverview, LoyaltyTransactionPage } from '../../types/api';

export function fetchMyLoyalty(): Promise<LoyaltyAccount> {
  return apiRequest<LoyaltyAccount>('/loyalty');
}

// Cursor is opaque — pass back exactly whatever the previous page's `nextCursor` was, same
// convention as fetchMyOrders (lib/api/orders.ts).
export function fetchMyLoyaltyTransactions(cursor?: string): Promise<LoyaltyTransactionPage> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  return apiRequest<LoyaltyTransactionPage>(`/loyalty/transactions${query}`);
}

// Phase 12 — Loyalty 2.0. The overview call also brings the customer's own loyalty state up to date on the server.
export function fetchMyLoyaltyOverview(): Promise<LoyaltyOverview> {
  return apiRequest<LoyaltyOverview>('/loyalty/overview');
}

export function fetchMyLoyaltyHistory(cursor?: string): Promise<LoyaltyHistoryPage> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  return apiRequest<LoyaltyHistoryPage>(`/loyalty/history${query}`);
}

// The customer's own birthday, settable once.
export function setMyBirthday(birthDate: string): Promise<void> {
  return apiRequest<void>('/loyalty/birthday', { method: 'PUT', body: { birthDate } });
}
