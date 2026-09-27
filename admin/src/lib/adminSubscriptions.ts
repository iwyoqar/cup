import { useCallback, useEffect, useState } from 'react';
import { apiRequest, ApiError } from './api';

// Coffee Subscription — Admin API client + types (GET/POST /admin/subscriptions/*). Every figure is computed server-side.

export interface SubUsage {
  totalPortions: number;
  consumedPortions: number;
  heldPortions: number;
  remainingPortions: number;
  dailyPortionLimit: number;
  todayUsedPortions: number;
  todayRemainingPortions: number;
  lastRedemptionAt: string | null;
  nextAvailableAt: string | null;
  cooldownMinutes: number;
}

export interface SubView {
  id: string;
  planId: string;
  planName: string;
  status: string;
  effectiveStatus: string;
  priceMinor: number;
  durationDays: number;
  startBusinessDate: string | null;
  endBusinessDate: string | null;
  activatedAt: string | null;
  usage: SubUsage;
}

export interface CustomerRef {
  id: string;
  name: string | null;
  phone: string | null;
  code: string | null;
}

export interface SubPlan {
  id: string;
  name: string;
  description: string | null;
  priceMinor: number;
  durationDays: number;
  totalPortions: number;
  dailyPortionLimit: number;
  cooldownMinutes: number;
  isActive: boolean;
  // Coffee Subscription — real Poster order purchase. Null when the plan has no mapping yet (cash sale still works; a real Poster order
  // purchase does not until one is set).
  posterProduct: { productId: string; posterProductId: string; name: string; isActive: boolean } | null;
}

// The Admin plan form's "Poster mahsulot" dropdown source (GET /admin/subscriptions/eligible-products): every active synced product.
export interface EligibleProduct {
  id: string;
  name: string;
  posterProductId: string;
  priceMinor: number;
  categoryName: string;
}

export interface SubProductMapping {
  id: string;
  productId: string;
  productName: string;
  categoryName: string;
  posterProductId: string;
  productActive: boolean;
  priceMinor: number;
  theoreticalCostMinor: number | null;
  portionCost: number;
  isActive: boolean;
  usable: boolean;
}

export interface SubSettings {
  manualActivationEnabled: boolean;
  posRedemptionEnabled: boolean;
  posCashSaleEnabled: boolean;
  posPosterPurchaseEnabled: boolean;
  paymentProviders: { id: string }[];
  policy: { autoRenew: boolean; refunds: boolean; rollover: boolean; cashValue: boolean };
}

export interface SubOverview {
  period: { startDate: string; endDate: string };
  activeSubscriptions: number;
  scheduledSubscriptions: number;
  newSubscriptions: number;
  renewals: number;
  expiredSubscriptions: number;
  cancelledSubscriptions: number;
  subscriptionRevenueMinor: number;
  manualActivations: { count: number; nominalMinor: number };
  portionsSold: number;
  portionsIssuedManually: number;
  portionsConsumed: number;
  unusedExpiredPortions: number;
  redemptionCount: number;
  customersWithActiveSubscription: number;
  customersEver: number;
  daily: { date: string; portions: number; redemptions: number; revenueMinor: number; sales: number }[];
}

export interface Paged<T> {
  page: number;
  pages: number;
  total: number;
  items: T[];
}

export type ActiveRow = SubView & { customer: CustomerRef };

export interface RedemptionRow {
  id: string;
  status: string;
  failureReason: string | null;
  at: string;
  requestedAt: string;
  redeemedAt: string | null;
  customer: CustomerRef;
  subscriptionId: string;
  planName: string;
  productName: string;
  portionCost: number;
  branchName: string | null;
  posterTransactionId: string | null;
  reconciliationStatus: string | null;
}

export interface RedemptionDetail extends RedemptionRow {
  attemptId: string;
  posterProductId: string;
  posterAccount: string;
  posterSpotId: string | null;
  posterTabletId: string | null;
  posterOrderId: string;
  posterTransactionProductId: string | null;
  employeeIdentifier: string | null;
  claimSequence: number | null;
  businessDate: string;
  reconciledAt: string | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
  subscription: { id: string; planName: string; startBusinessDate: string | null; endBusinessDate: string | null; status: string };
  createdAt: string;
  updatedAt: string;
}

export interface RedemptionsPage extends Paged<RedemptionRow> {
  period: { startDate: string; endDate: string };
  filters: { branches: { id: string; name: string }[]; products: { id: string; name: string }[]; plans: { id: string; name: string }[] };
  byStatus: { status: string; count: number; portions: number }[];
}

export interface CustomerRow {
  customer: CustomerRef;
  currentPlan: string | null;
  currentRemaining: number | null;
  nextAvailableAt: string | null;
  totalSubscriptions: number;
  portionsPurchased: number;
  portionsConsumed: number;
  unusedExpiredPortions: number;
  redemptionCount: number;
  lastRedemptionAt: string | null;
}

export interface PurchaseRow {
  id: string;
  kind: string;
  status: string;
  planName: string;
  amountMinor: number;
  activationSource: string | null;
  provider: string | null;
  createdAt: string;
  paidAt: string | null;
  subscriptionId: string;
}

export interface CustomerDetail {
  customer: CustomerRef & { isActive: boolean };
  current: SubView | null;
  upcoming: SubView[];
  pendingPurchase: { id: string; planName: string; amountMinor: number; kind: string; status: string; createdAt: string } | null;
  subscriptions: SubView[];
  purchases: PurchaseRow[];
  redemptions: RedemptionRow[];
}

export interface RevenueOverview {
  period: { startDate: string; endDate: string };
  subscriptionSalesMinor: number;
  subscriptionsSold: number;
  newSubscriptions: number;
  renewals: number;
  activeSubscriptions: number;
  manualActivations: { count: number; nominalMinor: number };
  byPlan: { planId: string; planName: string; count: number; revenueMinor: number; manualCount: number }[];
  byProvider: { provider: string; count: number; revenueMinor: number }[];
  byDay: { date: string; count: number; revenueMinor: number }[];
  paymentProvidersIntegrated: boolean;
  notes: string[];
}

export function errorText(err: unknown): string {
  if (err instanceof ApiError && err.status !== 0 && err.backendMessage !== 'network_error') return err.backendMessage;
  return "Ma'lumotni yuklab bo'lmadi";
}

// One generic loader for GET /admin/subscriptions/<path>: cancels stale responses, keeps previous data visible while reloading.
export function useSubscriptionsGet<T>(path: string, params: Record<string, string | number | undefined> = {}, ready = true) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)])).toString();

  const load = useCallback(() => {
    if (!ready) return undefined;
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    apiRequest<T>(`/admin/subscriptions${path}${qs ? `?${qs}` : ''}`, { signal: controller.signal })
      .then((r) => !cancelled && setData(r))
      .catch((err) => !cancelled && setError(errorText(err)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [path, qs, ready]);

  useEffect(() => load(), [load, reloadKey]);
  return { data, error, loading, reload: () => setReloadKey((k) => k + 1) };
}

function key(): string {
  try {
    if (crypto.randomUUID) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `adm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// The plan create/update body: everything SubPlan has except its id and the read-only posterProduct — a plain productId (or null to
// unmap) goes over the wire instead.
export type PlanFormBody = Omit<SubPlan, 'id' | 'posterProduct'> & { productId?: string | null };

export const subscriptionsApi = {
  createPlan: (body: PlanFormBody) => apiRequest<SubPlan>('/admin/subscriptions/plans', { method: 'POST', body }),
  updatePlan: (id: string, body: Partial<PlanFormBody>) => apiRequest<SubPlan>(`/admin/subscriptions/plans/${id}`, { method: 'PATCH', body }),
  eligibleProducts: () => apiRequest<EligibleProduct[]>('/admin/subscriptions/eligible-products'),
  addProduct: (productId: string, portionCost: number) => apiRequest<SubProductMapping[]>('/admin/subscriptions/products', { method: 'POST', body: { productId, portionCost } }),
  updateProduct: (id: string, body: { portionCost?: number; isActive?: boolean }) => apiRequest<SubProductMapping[]>(`/admin/subscriptions/products/${id}`, { method: 'PATCH', body }),
  resolveRedemption: (id: string, outcome: 'CONFIRMED' | 'FAILED', note: string) => apiRequest<RedemptionDetail>(`/admin/subscriptions/redemptions/${id}/resolve`, { method: 'POST', body: { outcome, note } }),
  redemption: (id: string) => apiRequest<RedemptionDetail>(`/admin/subscriptions/redemptions/${id}`),
  customer: (id: string) => apiRequest<CustomerDetail>(`/admin/subscriptions/customers/${id}`),
  createPurchase: (customerId: string, planId: string) => apiRequest<{ id: string }>('/admin/subscriptions/purchases', { method: 'POST', body: { customerId, planId }, headers: { 'Idempotency-Key': key() } }),
  manualActivate: (purchaseId: string, note: string) => apiRequest<unknown>(`/admin/subscriptions/purchases/${purchaseId}/manual-activate`, { method: 'POST', body: { note } }),
  cancelPurchase: (purchaseId: string) => apiRequest<unknown>(`/admin/subscriptions/purchases/${purchaseId}/cancel`, { method: 'POST' }),
  cancelSubscription: (id: string, reason: string) => apiRequest<unknown>(`/admin/subscriptions/${id}/cancel`, { method: 'POST', body: { reason } }),
};

export const REDEMPTION_STATUSES = ['CONFIRMED', 'UNKNOWN', 'FAILED', 'POSTER_MUTATING', 'REQUESTED'] as const;

export const FAILURE_LABELS: Record<string, string> = {
  NO_ACTIVE_SUBSCRIPTION: 'No active subscription',
  SUBSCRIPTION_PENDING_PAYMENT: 'Payment not confirmed',
  SUBSCRIPTION_NOT_STARTED: 'Subscription not started yet',
  SUBSCRIPTION_EXPIRED: 'Subscription expired',
  SUBSCRIPTION_PAUSED: 'Subscription paused',
  SUBSCRIPTION_CANCELLED: 'Subscription cancelled',
  NO_REMAINING_PORTIONS: 'No portions left',
  DAILY_LIMIT_REACHED: 'Daily limit reached',
  COOLDOWN_ACTIVE: 'Cooldown active',
  PRODUCT_NOT_ALLOWED: 'Drink not in subscription',
  PRODUCT_INACTIVE: 'Product inactive',
  CUSTOMER_MISMATCH: 'Order belongs to another customer',
  REDEMPTION_CONFLICT: 'Another redemption in flight',
  ALREADY_REDEEMED_FOR_ORDER: 'Already redeemed on this order',
  POSTER_TRANSACTION_UNAVAILABLE: 'Open order not confirmed (Poster unchanged)',
  POSTER_MUTATION_FAILED: 'Poster rejected / line missing',
  RESOLVED_BY_ADMIN: 'Resolved by admin',
};
