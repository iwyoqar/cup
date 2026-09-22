import { QualifyingPurchase } from '../loyalty2/loyalty2.repository';
import { ReferralSettings } from './referral-settings.service';

const DAY_MS = 86_400_000;

// The pure qualification rules — no I/O, so the decision for a referral is deterministic and explainable from its inputs alone.
//
//   A            = the moment the attribution was stored.
//   PRIOR_PURCHASE — the friend has a qualifying purchase made BEFORE A. They were not a new customer (this also catches an older POS purchase
//                    that was imported late), so the referral is closed and never rewarded — rewards are never retroactive.
//   minimum      = max(1, minimumPurchaseAmount): a zero-value purchase (e.g. a fully reward-covered order) never qualifies.
//   window       = attributionWindowDays; 0 means the attribution NEVER expires. The window applies to the PURCHASE time (a purchase made inside the
//                  window qualifies even if the job processes it later); after the window with nothing qualifying the referral is EXPIRED.
//   rewardOnFirstPurchaseOnly = true  — only the friend's very first qualifying purchase can qualify it; if that one is below the minimum the
//                  referral is closed (FIRST_PURCHASE_BELOW_MINIMUM) instead of waiting for a bigger one.
//   rewardOnFirstPurchaseOnly = false — the friend's earliest purchase that is at least the minimum qualifies it.
export type ReferralDecision =
  | { kind: 'QUALIFY'; purchase: QualifyingPurchase }
  | { kind: 'CLOSE'; status: 'REJECTED' | 'INVALID' | 'EXPIRED'; reason: 'PRIOR_PURCHASE' | 'FIRST_PURCHASE_BELOW_MINIMUM' | 'SELF_REFERRAL' | 'ATTRIBUTION_EXPIRED' }
  | { kind: 'KEEP' };

export interface ReferralForDecision {
  referrerCustomerId: string;
  referredCustomerId: string;
  attributedAt: Date | null;
  createdAt: Date;
}

export function decideReferral(
  referral: ReferralForDecision,
  purchases: readonly QualifyingPurchase[], // ascending (time, source, id) — the canonical order
  settings: Pick<ReferralSettings, 'minimumPurchaseAmount' | 'rewardOnFirstPurchaseOnly' | 'attributionWindowDays'>,
  now: Date,
): ReferralDecision {
  if (referral.referrerCustomerId === referral.referredCustomerId) return { kind: 'CLOSE', status: 'INVALID', reason: 'SELF_REFERRAL' };

  const attributedAt = (referral.attributedAt ?? referral.createdAt).getTime();
  const windowEnd = settings.attributionWindowDays > 0 ? attributedAt + settings.attributionWindowDays * DAY_MS : Number.POSITIVE_INFINITY;
  const minimum = Math.max(1, settings.minimumPurchaseAmount);

  if (purchases.some((p) => p.at.getTime() < attributedAt)) return { kind: 'CLOSE', status: 'REJECTED', reason: 'PRIOR_PURCHASE' };

  const pastWindow = now.getTime() > windowEnd;
  const expired = { kind: 'CLOSE', status: 'EXPIRED', reason: 'ATTRIBUTION_EXPIRED' } as const;

  if (settings.rewardOnFirstPurchaseOnly) {
    const first = purchases[0];
    if (first) {
      if (first.at.getTime() > windowEnd) return expired;
      return first.amountMinor >= minimum ? { kind: 'QUALIFY', purchase: first } : { kind: 'CLOSE', status: 'REJECTED', reason: 'FIRST_PURCHASE_BELOW_MINIMUM' };
    }
  } else {
    const candidate = purchases.find((p) => p.at.getTime() <= windowEnd && p.amountMinor >= minimum);
    if (candidate) return { kind: 'QUALIFY', purchase: candidate };
  }
  return pastWindow ? expired : { kind: 'KEEP' };
}

export const purchaseKey = (p: Pick<QualifyingPurchase, 'sourceType' | 'sourceId'>): string => `${p.sourceType}:${p.sourceId}`;
