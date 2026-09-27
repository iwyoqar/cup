import { cupGet, cupPost } from './poster';
import type { CheckPosterOrderPaymentResult, ErrorKind, Identifier, Overview, PurchaseSubscriptionCashResult, PurchaseSubscriptionPosterOrderResult, RedeemPromotionResult, RedeemRewardResult, RedeemSubscriptionResult } from './types';

// The public CUP backend base URL — the ONLY configuration compiled into the bundle (VITE_CUP_API_URL). No secret, token or credential exists in this file or anywhere in
// the widget: authentication is done by Poster itself, which signs the proxied request (see docs/PHASE-21-POS-CAPABILITY.md).
const BASE = ((import.meta.env.VITE_CUP_API_URL as string | undefined) ?? '').trim().replace(/\/+$/, '');

export const apiConfigured = BASE !== '';

export type OverviewResult = { kind: 'OK'; overview: Overview } | { kind: 'ERROR'; error: ErrorKind };

export async function fetchOverview(id: Identifier, ref: string): Promise<OverviewResult> {
  if (!apiConfigured) return { kind: 'ERROR', error: 'NOT_CONFIGURED' };
  const params = new URLSearchParams();
  if ('posterClientId' in id) params.set('posterClientId', id.posterClientId);
  else if ('code' in id) params.set('code', id.code);
  else params.set('phone', id.phone);
  params.set('ref', ref);
  const res = await cupGet(`${BASE}/pos-widget/overview?${params.toString()}`);
  if (res.kind === 'ERROR') return res;
  const body = res.body as Partial<Overview> | null;
  if (!body || typeof body !== 'object' || typeof body.state !== 'string') return { kind: 'ERROR', error: 'INVALID' };
  return { kind: 'OK', overview: body as Overview };
}

// Phase 22 — the one write call. `ErrorKind` here means the redeem call ITSELF could not be completed (transport/auth/feature-off — same layer as
// fetchOverview's ErrorKind); a redemption attempt that WAS completed but ended FAILED/UNKNOWN is a normal 'OK' with that status inside RedeemRewardResult
// — never thrown as an ErrorKind, because it is not a transport failure.
export type RedeemResult = { kind: 'OK'; result: RedeemRewardResult } | { kind: 'ERROR'; error: ErrorKind };

export interface RedeemRewardBody {
  attemptId: string;
  posterClientId: string;
  posterOrderId: string;
  rewardProgramId: string;
  posterProductId: string;
  employeeIdentifier?: string | null;
}

export async function redeemReward(body: RedeemRewardBody): Promise<RedeemResult> {
  if (!apiConfigured) return { kind: 'ERROR', error: 'NOT_CONFIGURED' };
  const res = await cupPost(`${BASE}/pos-widget/rewards/redeem`, body);
  if (res.kind === 'ERROR') return res;
  const r = res.body as Partial<RedeemRewardResult> | null;
  if (!r || typeof r !== 'object' || typeof r.attemptId !== 'string' || typeof r.status !== 'string') return { kind: 'ERROR', error: 'INVALID' };
  return { kind: 'OK', result: r as RedeemRewardResult };
}

// Phase 23 — the promotion equivalent of redeemReward. Same ErrorKind/result-layer split: a transport-level failure (feature off, auth, network) is an
// ErrorKind, never conflated with a completed-but-FAILED/UNKNOWN business result.
export type RedeemPromotionApiResult = { kind: 'OK'; result: RedeemPromotionResult } | { kind: 'ERROR'; error: ErrorKind };

export interface RedeemPromotionBody {
  attemptId: string;
  posterClientId: string;
  posterOrderId: string;
  promotionId: string;
  employeeIdentifier?: string | null;
}

export async function redeemPromotion(body: RedeemPromotionBody): Promise<RedeemPromotionApiResult> {
  if (!apiConfigured) return { kind: 'ERROR', error: 'NOT_CONFIGURED' };
  const res = await cupPost(`${BASE}/pos-widget/promotions/redeem`, body);
  if (res.kind === 'ERROR') return res;
  const r = res.body as Partial<RedeemPromotionResult> | null;
  if (!r || typeof r !== 'object' || typeof r.attemptId !== 'string' || typeof r.status !== 'string') return { kind: 'ERROR', error: 'INVALID' };
  return { kind: 'OK', result: r as RedeemPromotionResult };
}

// Coffee Subscription — the redemption call. Same transport/business split as redeemReward: an ErrorKind means the call itself failed; a completed
// FAILED / UNKNOWN attempt is a normal OK result. The customer is the order's Poster client OR the customer's CUP code (from a QR scan) — never both.
export type RedeemSubscriptionApiResult = { kind: 'OK'; result: RedeemSubscriptionResult } | { kind: 'ERROR'; error: ErrorKind };

export interface RedeemSubscriptionBody {
  attemptId: string;
  posterClientId?: string;
  code?: string;
  posterOrderId: string;
  posterProductId: string;
  employeeIdentifier?: string | null;
}

export async function redeemSubscription(body: RedeemSubscriptionBody): Promise<RedeemSubscriptionApiResult> {
  if (!apiConfigured) return { kind: 'ERROR', error: 'NOT_CONFIGURED' };
  const res = await cupPost(`${BASE}/pos-widget/subscriptions/redeem`, body);
  if (res.kind === 'ERROR') return res;
  const r = res.body as Partial<RedeemSubscriptionResult> | null;
  if (!r || typeof r !== 'object' || typeof r.attemptId !== 'string' || typeof r.status !== 'string') return { kind: 'ERROR', error: 'INVALID' };
  return { kind: 'OK', result: r as RedeemSubscriptionResult };
}

// Coffee Subscription cash sale — a cashier sells a plan for cash. Same OK/ErrorKind split as every other write call: a REJECTED result (plan turned
// off, a pending purchase already exists, ...) is a normal OK, never a transport failure. Requires an Idempotency-Key so a double-tapped confirm
// button can never sell (or charge) the customer twice — same discipline as the customer/admin purchase endpoints.
export type PurchaseSubscriptionCashApiResult = { kind: 'OK'; result: PurchaseSubscriptionCashResult } | { kind: 'ERROR'; error: ErrorKind };

export interface PurchaseSubscriptionCashBody {
  planId: string;
  posterClientId?: string;
  code?: string;
  employeeIdentifier?: string | null;
}

export async function purchaseSubscriptionCash(body: PurchaseSubscriptionCashBody, idempotencyKey: string): Promise<PurchaseSubscriptionCashApiResult> {
  if (!apiConfigured) return { kind: 'ERROR', error: 'NOT_CONFIGURED' };
  const res = await cupPost(`${BASE}/pos-widget/subscriptions/purchase-cash`, body, [`Idempotency-Key: ${idempotencyKey}`]);
  if (res.kind === 'ERROR') return res;
  const r = res.body as Partial<PurchaseSubscriptionCashResult> | null;
  if (!r || typeof r !== 'object' || typeof r.status !== 'string') return { kind: 'ERROR', error: 'INVALID' };
  return { kind: 'OK', result: r as PurchaseSubscriptionCashResult };
}

// Coffee Subscription — real Poster order purchase. Same OK/ErrorKind split: a REJECTED result is a normal OK, never a transport failure.
// Same Idempotency-Key discipline as the cash endpoint (a double-tapped confirm must never add the line twice).
export type PurchaseSubscriptionPosterOrderApiResult = { kind: 'OK'; result: PurchaseSubscriptionPosterOrderResult } | { kind: 'ERROR'; error: ErrorKind };

export interface PurchaseSubscriptionPosterOrderBody {
  planId: string;
  posterClientId?: string;
  code?: string;
  posterOrderId: string;
  employeeIdentifier?: string | null;
}

export async function purchaseSubscriptionPosterOrder(body: PurchaseSubscriptionPosterOrderBody, idempotencyKey: string): Promise<PurchaseSubscriptionPosterOrderApiResult> {
  if (!apiConfigured) return { kind: 'ERROR', error: 'NOT_CONFIGURED' };
  const res = await cupPost(`${BASE}/pos-widget/subscriptions/purchase-poster-order`, body, [`Idempotency-Key: ${idempotencyKey}`]);
  if (res.kind === 'ERROR') return res;
  const r = res.body as Partial<PurchaseSubscriptionPosterOrderResult> | null;
  if (!r || typeof r !== 'object' || typeof r.status !== 'string') return { kind: 'ERROR', error: 'INVALID' };
  return { kind: 'OK', result: r as PurchaseSubscriptionPosterOrderResult };
}

// The on-demand fast path: called right after the customer pays (and a few times auto-polled), instead of only waiting for the periodic
// importer safety net. Same OK/ErrorKind split as every write call here.
export type CheckPosterOrderPaymentApiResult = { kind: 'OK'; result: CheckPosterOrderPaymentResult } | { kind: 'ERROR'; error: ErrorKind };

export async function checkPosterOrderPayment(purchaseId: string): Promise<CheckPosterOrderPaymentApiResult> {
  if (!apiConfigured) return { kind: 'ERROR', error: 'NOT_CONFIGURED' };
  const res = await cupPost(`${BASE}/pos-widget/subscriptions/purchases/${encodeURIComponent(purchaseId)}/check-payment`, {});
  if (res.kind === 'ERROR') return res;
  const r = res.body as Partial<CheckPosterOrderPaymentResult> | null;
  if (!r || typeof r !== 'object' || typeof r.status !== 'string') return { kind: 'ERROR', error: 'INVALID' };
  return { kind: 'OK', result: r as CheckPosterOrderPaymentResult };
}
