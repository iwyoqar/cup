import { addDays, businessDateOf, startOfBusinessDay } from '../analytics/analytics-period';
import { PlanTerms, SubscriptionEffectiveStatus, SubscriptionIneligibleReason, SubscriptionStatus, SubscriptionUsage } from './subscription.types';

// Coffee Subscription — the pure rules. No I/O: every function takes the rows it needs plus `now`, so the Mini App summary, the
// widget summary, the admin views and the redemption claim (which re-runs these INSIDE its locked transaction on freshly read rows)
// can never disagree. Day arithmetic reuses analytics-period.ts (the canonical UTC+5 business-day helpers) — no second date library.

export interface SubscriptionLike {
  status: string;
  startsAt: Date | null;
  endsAt: Date | null;
  totalPortions: number;
  dailyPortionLimit: number;
  cooldownMinutes: number;
}

export interface RedemptionLike {
  status: string;
  portionCost: number;
  businessDate: string;
  requestedAt: Date;
  redeemedAt: Date | null;
}

const MINUTE = 60_000;

// Calendar-day period: day 1 = startDate, usable THROUGH day `durationDays` (inclusive), expiring at the end of that business day.
// A 30-day plan bought on 1 Sep runs 1 Sep .. 30 Sep; startsAt/endsAt are [1 Sep 00:00 local, 1 Oct 00:00 local) as UTC instants.
export function periodFor(startBusinessDate: string, durationDays: number, offsetMinutes: number) {
  const endBusinessDate = addDays(startBusinessDate, durationDays - 1);
  return {
    startBusinessDate,
    endBusinessDate,
    startsAt: startOfBusinessDay(startBusinessDate, offsetMinutes),
    endsAt: startOfBusinessDay(addDays(endBusinessDate, 1), offsetMinutes),
  };
}

// Where a newly paid subscription starts: today (business day of `now`) — or, when the customer already has a paid subscription
// running or queued, exactly where the LAST of those ends (so periods chain and never overlap). `latestEndsAt` is the max endsAt of
// the customer's ACTIVE / PAUSED subscriptions (the caller reads it under the customer lock).
export function nextStartBusinessDate(now: Date, latestEndsAt: Date | null, offsetMinutes: number): string {
  const today = businessDateOf(now, offsetMinutes);
  if (!latestEndsAt || latestEndsAt.getTime() <= now.getTime()) return today;
  // endsAt is always a business-day boundary (00:00 local), so its business date IS the first free day.
  const next = businessDateOf(latestEndsAt, offsetMinutes);
  return next > today ? next : today;
}

export function effectiveStatus(sub: Pick<SubscriptionLike, 'status' | 'startsAt' | 'endsAt'>, now: Date): SubscriptionEffectiveStatus {
  if (sub.status !== 'ACTIVE') return sub.status as SubscriptionStatus;
  if (sub.endsAt && now.getTime() >= sub.endsAt.getTime()) return 'EXPIRED';
  if (sub.startsAt && now.getTime() < sub.startsAt.getTime()) return 'SCHEDULED';
  return 'ACTIVE';
}

const isHeld = (s: string) => s === 'REQUESTED' || s === 'POSTER_MUTATING' || s === 'UNKNOWN';
const isCounted = (s: string) => isHeld(s) || s === 'CONFIRMED';

// Usage from the subscription's redemption rows. The cooldown runs from the last SUCCESSFUL redemption (redeemedAt); a still
// in-flight / ambiguous one also blocks, measured from its request time, so two baristas can never both start a redemption.
export function computeUsage(sub: SubscriptionLike, redemptions: RedemptionLike[], now: Date, offsetMinutes: number): SubscriptionUsage {
  const today = businessDateOf(now, offsetMinutes);
  let consumed = 0;
  let held = 0;
  let todayUsed = 0;
  let last: Date | null = null;
  for (const r of redemptions) {
    if (!isCounted(r.status)) continue;
    if (r.status === 'CONFIRMED') consumed += r.portionCost;
    else held += r.portionCost;
    if (r.businessDate === today) todayUsed += r.portionCost;
    const at = r.status === 'CONFIRMED' ? (r.redeemedAt ?? r.requestedAt) : r.requestedAt;
    if (!last || at > last) last = at;
  }
  const next = last ? new Date(last.getTime() + sub.cooldownMinutes * MINUTE) : null;
  return {
    totalPortions: sub.totalPortions,
    consumedPortions: consumed,
    heldPortions: held,
    remainingPortions: Math.max(0, sub.totalPortions - consumed - held),
    dailyPortionLimit: sub.dailyPortionLimit,
    todayUsedPortions: todayUsed,
    todayRemainingPortions: Math.max(0, sub.dailyPortionLimit - todayUsed),
    lastRedemptionAt: last ? last.toISOString() : null,
    nextAvailableAt: next && next.getTime() > now.getTime() ? next.toISOString() : null,
    cooldownMinutes: sub.cooldownMinutes,
  };
}

// Can `portionCost` portions be redeemed from this subscription right now? The ONE eligibility decision (status, dates, balance,
// daily limit, cooldown), in a fixed order so the reason shown is always the most fundamental one. Product eligibility is checked
// separately (it depends on the SubscriptionProduct mapping, not the subscription).
export function subscriptionIneligibility(sub: SubscriptionLike | null, redemptions: RedemptionLike[], portionCost: number, now: Date, offsetMinutes: number): SubscriptionIneligibleReason | null {
  if (!sub) return 'NO_ACTIVE_SUBSCRIPTION';
  const status = effectiveStatus(sub, now);
  switch (status) {
    case 'PENDING_PAYMENT':
      return 'SUBSCRIPTION_PENDING_PAYMENT';
    case 'SCHEDULED':
      return 'SUBSCRIPTION_NOT_STARTED';
    case 'EXPIRED':
      return 'SUBSCRIPTION_EXPIRED';
    case 'PAUSED':
      return 'SUBSCRIPTION_PAUSED';
    case 'CANCELLED':
      return 'SUBSCRIPTION_CANCELLED';
    default:
      break;
  }
  if (!sub.startsAt || !sub.endsAt) return 'NO_ACTIVE_SUBSCRIPTION'; // defensive: an ACTIVE row always has dates
  const usage = computeUsage(sub, redemptions, now, offsetMinutes);
  if (usage.remainingPortions <= 0) return 'NO_REMAINING_PORTIONS';
  if (usage.todayRemainingPortions <= 0) return 'DAILY_LIMIT_REACHED';
  if (usage.nextAvailableAt) return 'COOLDOWN_ACTIVE';
  if (portionCost > usage.remainingPortions) return 'NO_REMAINING_PORTIONS';
  if (portionCost > usage.todayRemainingPortions) return 'DAILY_LIMIT_REACHED';
  return null;
}

// Plan field bounds (shared by the admin DTO and the service). Money is integer minor units (UZS has no fractional unit in CUP).
export const PLAN_LIMITS = {
  priceMinor: { min: 1, max: 1_000_000_000 },
  durationDays: { min: 1, max: 366 },
  totalPortions: { min: 1, max: 1000 },
  dailyPortionLimit: { min: 1, max: 20 },
  cooldownMinutes: { min: 0, max: 24 * 60 },
  portionCost: { min: 1, max: 5 },
} as const;

export function termsOf(plan: { name: string; priceMinor: number; durationDays: number; totalPortions: number; dailyPortionLimit: number; cooldownMinutes: number; product?: { posterProductId: string } | null }): PlanTerms {
  return { planName: plan.name, priceMinor: plan.priceMinor, durationDays: plan.durationDays, totalPortions: plan.totalPortions, dailyPortionLimit: plan.dailyPortionLimit, cooldownMinutes: plan.cooldownMinutes, posterProductId: plan.product?.posterProductId ?? null };
}
