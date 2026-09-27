import { apiRequest } from './client';
import { SubscriptionPurchase, SubscriptionRedemptionPage, SubscriptionSummary } from '../../types/api';

// Coffee Subscription — the customer's own subscription. Identity is the session; nothing here sends a customerId, a price or a balance.
export function fetchMySubscription(): Promise<SubscriptionSummary> {
  return apiRequest<SubscriptionSummary>('/subscriptions/me');
}

export function fetchMySubscriptionRedemptions(cursor?: string): Promise<SubscriptionRedemptionPage> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  return apiRequest<SubscriptionRedemptionPage>(`/subscriptions/me/redemptions${query}`);
}

// Creates a purchase waiting for payment (no payment provider is connected yet — nothing is charged). Idempotent on the key.
export function startSubscriptionPurchase(planId: string, idempotencyKey: string, renew: boolean): Promise<SubscriptionPurchase> {
  return apiRequest<SubscriptionPurchase>(renew ? '/subscriptions/renew' : '/subscriptions/purchases', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: { planId },
  });
}

export function cancelSubscriptionPurchase(purchaseId: string): Promise<SubscriptionPurchase> {
  return apiRequest<SubscriptionPurchase>(`/subscriptions/purchases/${encodeURIComponent(purchaseId)}/cancel`, { method: 'POST' });
}
