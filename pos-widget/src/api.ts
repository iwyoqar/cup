import { cupGet, cupPost } from './poster';
import type { ErrorKind, Identifier, Overview, RedeemPromotionResult, RedeemRewardResult } from './types';

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
