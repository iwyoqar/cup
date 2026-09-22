import { addDays, businessDateOf, startOfBusinessDay } from '../analytics/analytics-period';
import { birthdayTarget } from '../automations/automation-time';
import {
  GrowthMetrics,
  GrowthOpportunity,
  GrowthSettings,
  GrowthSignal,
  LifecycleState,
  OpportunityType,
  PRIORITIES,
  Priority,
  Recommendation,
  SIGNAL_SEVERITY,
  SignalType,
} from './growth-intelligence.types';

// Phase 15 — the pure rules. No I/O, no clock, no database: every function is a deterministic function of its arguments, so the same purchases
// and the same configuration always produce the same lifecycle, scores, signals and opportunities. Nothing here predicts anything.

const DAY_MS = 86_400_000;

// One row per purchasing customer, produced by ONE bulk aggregate query (growth-intelligence.repository.ts).
export interface CustomerAggregate {
  customerId: string;
  purchases: number;
  revenue: number;
  firstAt: number;
  lastAt: number;
  secondAt: number | null;
  highValueAt: number | null;
  lookbackPurchases: number;
  lookbackRevenue: number;
}

// Business-local calendar day number (fixed offset, like Analytics): two instants on the same local date are 0 days apart.
export const dayNumber = (ms: number, offsetMinutes: number): number => Math.floor((ms + offsetMinutes * 60_000) / DAY_MS);
export const daysBetween = (thenMs: number, nowMs: number, offsetMinutes: number): number => Math.max(0, dayNumber(nowMs, offsetMinutes) - dayNumber(thenMs, offsetMinutes));
// The UTC instant at which the given business-local day number begins.
export const startOfDayNumber = (day: number, offsetMinutes: number): number => day * DAY_MS - offsetMinutes * 60_000;

const som = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} so'm`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const ago = (n: number) => (n === 0 ? 'today' : `${plural(n, 'day', 'days')} ago`);

// ---- RFM scoring (absolute, configurable boundaries — never percentiles, never a model) ------------------------------------------------------

// Recency: boundaries are the MAXIMUM days since the last purchase for scores 5, 4, 3, 2. days <= b[0] -> 5 ... anything longer than b[3] -> 1.
export function scoreRecency(days: number, boundaries: readonly number[]): number {
  if (days <= boundaries[0]) return 5;
  if (days <= boundaries[1]) return 4;
  if (days <= boundaries[2]) return 3;
  if (days <= boundaries[3]) return 2;
  return 1;
}

// Frequency / monetary: boundaries are the MINIMUM value for scores 2, 3, 4, 5 (ascending). value < b[0] -> 1.
export function scoreAscending(value: number, boundaries: readonly number[]): number {
  return 1 + boundaries.filter((b) => value >= b).length;
}

// ---- lifecycle ------------------------------------------------------------------------------------------------------------------------------

// Explicit precedence (first match wins) — the states cannot overlap. "Beyond" a threshold is strictly greater: with activeDays = 14, a customer
// who last purchased 14 days ago is still ACTIVE and 15 days ago is AT_RISK; with churnDays = 60, 60 days is DORMANT and 61 is CHURNED.
export function classifyLifecycle(
  m: { lifetimePurchases: number; lifetimeRevenue: number; daysSinceFirstPurchase: number | null; daysSinceLastPurchase: number | null },
  s: Pick<GrowthSettings, 'newDays' | 'activeDays' | 'dormantDays' | 'churnDays' | 'loyalMinPurchases' | 'loyalMinRevenue'>,
): LifecycleState | null {
  if (m.lifetimePurchases <= 0 || m.daysSinceLastPurchase === null || m.daysSinceFirstPurchase === null) return null;
  if (m.daysSinceLastPurchase > s.churnDays) return 'CHURNED';
  if (m.daysSinceLastPurchase > s.dormantDays) return 'DORMANT';
  if (m.daysSinceLastPurchase > s.activeDays) return 'AT_RISK';
  if (m.daysSinceFirstPurchase <= s.newDays) return 'NEW';
  if (m.lifetimePurchases >= s.loyalMinPurchases && m.lifetimeRevenue >= s.loyalMinRevenue) return 'LOYAL';
  return 'ACTIVE';
}

export function emptyMetrics(): GrowthMetrics {
  return {
    lifetimePurchases: 0,
    lifetimeRevenue: 0,
    firstPurchaseAt: null,
    lastPurchaseAt: null,
    secondPurchaseAt: null,
    highValueAt: null,
    daysSinceFirstPurchase: null,
    daysSinceLastPurchase: null,
    frequency: 0,
    monetary: 0,
    recencyScore: null,
    frequencyScore: null,
    monetaryScore: null,
    rfmScore: null,
    rfmTotal: null,
    lifecycleState: null,
    highValue: false,
  };
}

export function computeMetrics(agg: CustomerAggregate | undefined, s: GrowthSettings, nowMs: number, offsetMinutes: number): GrowthMetrics {
  if (!agg || agg.purchases <= 0) return emptyMetrics();
  const daysSinceFirst = daysBetween(agg.firstAt, nowMs, offsetMinutes);
  const daysSinceLast = daysBetween(agg.lastAt, nowMs, offsetMinutes);
  const recencyScore = scoreRecency(daysSinceLast, s.recencyDaysBoundaries);
  const frequencyScore = scoreAscending(agg.lookbackPurchases, s.frequencyBoundaries);
  const monetaryScore = scoreAscending(agg.lookbackRevenue, s.monetaryBoundaries);
  const base = {
    lifetimePurchases: agg.purchases,
    lifetimeRevenue: agg.revenue,
    daysSinceFirstPurchase: daysSinceFirst,
    daysSinceLastPurchase: daysSinceLast,
  };
  return {
    ...base,
    firstPurchaseAt: new Date(agg.firstAt),
    lastPurchaseAt: new Date(agg.lastAt),
    secondPurchaseAt: agg.secondAt === null ? null : new Date(agg.secondAt),
    highValueAt: agg.highValueAt === null ? null : new Date(agg.highValueAt),
    frequency: agg.lookbackPurchases,
    monetary: agg.lookbackRevenue,
    recencyScore,
    frequencyScore,
    monetaryScore,
    rfmScore: `${recencyScore}${frequencyScore}${monetaryScore}`,
    rfmTotal: recencyScore + frequencyScore + monetaryScore,
    lifecycleState: classifyLifecycle(base, s),
    highValue: agg.revenue >= s.highValueRevenue,
  };
}

// ---- signals --------------------------------------------------------------------------------------------------------------------------------

export interface SignalExtras {
  rewards?: { programId: string; programName: string; earned: number; available: number }[];
  referrals?: { referralId: string; qualifiedAt: Date }[];
  levelUps?: { levelCode: string; levelName: string; reachedAt: Date }[];
  birthDate?: Date | null;
}

const lower = (t: SignalType) => t.toLowerCase().replace(/_/g, '-');

// Signals are DERIVED from canonical data every time they are asked for — nothing is stored, so nothing can be generated twice. Each occurrence has
// a deterministic key (customer + the event / period that defines it), so the same condition always yields the same key and the same output.
//   detectedAt = when the condition became true, when the canonical data records it (first / second purchase, high-value crossing, the moment a
//   lifecycle threshold was passed, a referral qualifying, a level-up). REWARD_AVAILABLE is a current balance with no recorded earn moment (null).
export function deriveSignals(customerId: string, m: GrowthMetrics, extras: SignalExtras, s: GrowthSettings, nowMs: number, offsetMinutes: number): GrowthSignal[] {
  const out: GrowthSignal[] = [];
  const add = (type: SignalType, key: string, detectedAt: Date | null, reason: string) => out.push({ type, key, severity: SIGNAL_SEVERITY[type], detectedAt, reason });

  if (m.firstPurchaseAt && m.daysSinceFirstPurchase !== null && m.daysSinceFirstPurchase <= s.newDays) {
    add('FIRST_PURCHASE', `first-purchase:${customerId}`, m.firstPurchaseAt, `First qualifying purchase was ${ago(m.daysSinceFirstPurchase)}.`);
  }
  if (m.secondPurchaseAt && daysBetween(m.secondPurchaseAt.getTime(), nowMs, offsetMinutes) <= s.signalWindowDays) {
    add('SECOND_PURCHASE', `second-purchase:${customerId}`, m.secondPurchaseAt, `Second qualifying purchase was ${ago(daysBetween(m.secondPurchaseAt.getTime(), nowMs, offsetMinutes))}.`);
  }
  if (m.highValue && m.highValueAt) {
    add('HIGH_VALUE_CUSTOMER', `high-value:${customerId}`, m.highValueAt, `Lifetime revenue ${som(m.lifetimeRevenue)} reached the configured high-value threshold (${som(s.highValueRevenue)}).`);
    const since = daysBetween(m.highValueAt.getTime(), nowMs, offsetMinutes);
    if (since <= s.risingDays) {
      add('RISING_CUSTOMER', `rising:${customerId}:${businessDateOf(m.highValueAt, offsetMinutes)}`, m.highValueAt, `Crossed the configured high-value threshold ${ago(since)} (within ${s.risingDays} days).`);
    }
  }

  if (m.lastPurchaseAt && m.daysSinceLastPurchase !== null && m.lifecycleState) {
    const lastDay = dayNumber(m.lastPurchaseAt.getTime(), offsetMinutes);
    const rule: Partial<Record<LifecycleState, { type: SignalType; over: number }>> = {
      AT_RISK: { type: 'AT_RISK', over: s.activeDays },
      DORMANT: { type: 'DORMANT', over: s.dormantDays },
      CHURNED: { type: 'CHURNED', over: s.churnDays },
    };
    const r = rule[m.lifecycleState];
    if (r) {
      // Identity = customer + the purchase that started the inactivity period: a new purchase ends the period, a later lapse is a new period.
      add(r.type, `${lower(r.type)}:${customerId}:${businessDateOf(m.lastPurchaseAt, offsetMinutes)}`, new Date(startOfDayNumber(lastDay + r.over + 1, offsetMinutes)), `Customer has not purchased for ${plural(m.daysSinceLastPurchase, 'day', 'days')} (configured ${r.type} rule: more than ${r.over} days).`);
    }
  }

  for (const r of extras.rewards ?? []) {
    if (r.available > 0) add('REWARD_AVAILABLE', `reward:${customerId}:${r.programId}:${r.earned}`, null, `${plural(r.available, 'reward', 'rewards')} available in "${r.programName}".`);
  }
  for (const ref of extras.referrals ?? []) {
    if (daysBetween(ref.qualifiedAt.getTime(), nowMs, offsetMinutes) <= s.signalWindowDays) add('REFERRAL_SUCCESS', `referral:${ref.referralId}`, ref.qualifiedAt, 'A referred friend made their first qualifying purchase.');
  }
  for (const l of extras.levelUps ?? []) {
    if (daysBetween(l.reachedAt.getTime(), nowMs, offsetMinutes) <= s.signalWindowDays) add('LOYALTY_LEVEL_UP', `level:${customerId}:${l.levelCode}`, l.reachedAt, `Reached loyalty level ${l.levelName}.`);
  }
  if (extras.birthDate) {
    const md = extras.birthDate.toISOString().slice(5, 10); // birthDate is a date-only value stored as UTC midnight
    const today = businessDateOf(new Date(nowMs), offsetMinutes);
    for (let d = 0; d <= s.birthdayLookaheadDays; d += 1) {
      const target = birthdayTarget(today, d);
      if (target.monthDays.includes(md)) {
        const birthdayDate = addDays(today, d);
        add('BIRTHDAY_UPCOMING', `birthday:${customerId}:${target.year}`, startOfBusinessDay(addDays(birthdayDate, -s.birthdayLookaheadDays), offsetMinutes), d === 0 ? 'Birthday is today.' : `Birthday is in ${plural(d, 'day', 'days')}.`);
        break;
      }
    }
  }
  return out;
}

// ---- opportunities --------------------------------------------------------------------------------------------------------------------------

// The recommendation names an EXISTING Segment definition and an EXISTING Phase 13 trigger type. Growth Intelligence never creates or activates
// either, and never sends anything: sending stays behind the CRM automation safety gates.
export const RECOMMENDATIONS: Record<OpportunityType, Recommendation> = {
  WIN_BACK: { segment: 'Lifecycle state equals AT_RISK (or DORMANT)', automationTrigger: 'INACTIVE_CUSTOMER' },
  SECOND_PURCHASE: { segment: 'Lifetime purchases equals 1', automationTrigger: 'FIRST_PURCHASE' },
  REWARD_REDEMPTION: { segment: 'Growth signal equals REWARD_AVAILABLE', automationTrigger: 'REWARD_UNLOCKED' },
  VIP_RETENTION: { segment: 'Growth signal equals HIGH_VALUE_CUSTOMER', automationTrigger: 'SCHEDULED_SEGMENT' },
  REFERRAL: { segment: 'Lifecycle state equals LOYAL', automationTrigger: null },
  BIRTHDAY: { segment: 'Growth signal equals BIRTHDAY_UPCOMING', automationTrigger: 'BIRTHDAY' },
  LOYALTY_UPGRADE: { segment: 'Lifetime revenue greater than or equal to a level threshold', automationTrigger: 'LOYALTY_MILESTONE' },
};

export interface OpportunityContext {
  referralEnabled: boolean;
  // Loyalty 2.0 (only while the program is on): the next level and how far along the customer is.
  upgrade: { levelName: string; spendToNext: number; percentReached: number } | null;
}

const INACTIVE: readonly LifecycleState[] = ['AT_RISK', 'DORMANT', 'CHURNED'];
const LIVE: readonly LifecycleState[] = ['NEW', 'ACTIVE', 'LOYAL'];
const PRIORITY_RANK: Record<Priority, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
const TYPE_RANK: Record<OpportunityType, number> = { WIN_BACK: 0, REWARD_REDEMPTION: 1, SECOND_PURCHASE: 2, VIP_RETENTION: 3, BIRTHDAY: 4, LOYALTY_UPGRADE: 5, REFERRAL: 6 };

// Priority is the OUTPUT of the rule table below, never an opinion:
//   WIN_BACK           HIGH if high-value and AT_RISK/DORMANT; MEDIUM if AT_RISK/DORMANT; LOW if CHURNED
//   SECOND_PURCHASE    MEDIUM once secondPurchaseDueDays have passed since the only purchase; LOW before that
//   REWARD_REDEMPTION  HIGH if the customer is inactive (AT_RISK/DORMANT/CHURNED); MEDIUM otherwise
//   VIP_RETENTION      MEDIUM if RISING_CUSTOMER; LOW otherwise
//   BIRTHDAY           MEDIUM;   LOYALTY_UPGRADE  MEDIUM;   REFERRAL  LOW
export function deriveOpportunities(m: GrowthMetrics, signals: readonly GrowthSignal[], ctx: OpportunityContext, s: GrowthSettings): GrowthOpportunity[] {
  const out: GrowthOpportunity[] = [];
  const state = m.lifecycleState;
  if (!state) return out;
  const add = (type: OpportunityType, priority: Priority, reason: string) => out.push({ type, priority, reason, recommended: RECOMMENDATIONS[type] });
  const days = m.daysSinceLastPurchase ?? 0;

  if (INACTIVE.includes(state)) {
    const priority: Priority = state === 'CHURNED' ? 'LOW' : m.highValue ? 'HIGH' : 'MEDIUM';
    add('WIN_BACK', priority, `Customer meets the configured ${state} rule (last purchase ${plural(days, 'day', 'days')} ago)${m.highValue && state !== 'CHURNED' ? ' and the configured high-value threshold' : ''}.`);
  }
  if (m.lifetimePurchases === 1 && (state === 'NEW' || state === 'ACTIVE')) {
    const since = m.daysSinceFirstPurchase ?? 0;
    add('SECOND_PURCHASE', since >= s.secondPurchaseDueDays ? 'MEDIUM' : 'LOW', `Only one purchase so far (${ago(since)}; a second purchase is due after ${s.secondPurchaseDueDays} days).`);
  }
  const rewards = signals.filter((x) => x.type === 'REWARD_AVAILABLE');
  if (rewards.length > 0) add('REWARD_REDEMPTION', INACTIVE.includes(state) ? 'HIGH' : 'MEDIUM', rewards.map((r) => r.reason).join(' '));
  if (m.highValue && LIVE.includes(state)) {
    add('VIP_RETENTION', signals.some((x) => x.type === 'RISING_CUSTOMER') ? 'MEDIUM' : 'LOW', 'Meets the configured high-value threshold and is currently active.');
  }
  const birthday = signals.find((x) => x.type === 'BIRTHDAY_UPCOMING');
  if (birthday) add('BIRTHDAY', 'MEDIUM', birthday.reason);
  if (ctx.upgrade && ctx.upgrade.percentReached >= 100 - s.upgradeProximityPercent) {
    add('LOYALTY_UPGRADE', 'MEDIUM', `${som(ctx.upgrade.spendToNext)} left to reach loyalty level ${ctx.upgrade.levelName} (${ctx.upgrade.percentReached}% of its threshold).`);
  }
  if (ctx.referralEnabled && state === 'LOYAL') add('REFERRAL', 'LOW', `Loyal customer (${m.lifetimePurchases} purchases) and the referral program is on.`);

  return out.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || TYPE_RANK[a.type] - TYPE_RANK[b.type]);
}

export const PRIORITY_ORDER = PRIORITIES;
export const priorityRank = (p: Priority): number => PRIORITY_RANK[p];
