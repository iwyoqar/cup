// Phase 12 — Loyalty 2.0: the pure rules. No I/O, no clock, no database: every function is a deterministic function of its
// arguments so level / XP / streak / birthday / cashback behaviour can be checked directly. All money is whole-UZS integers
// and every rate is an integer (basis points / percent) — no float is ever produced for persistence.

export interface LevelDef {
  code: string;
  name: string;
  color: string;
  icon: string;
  minLifetimeSpend: number;
  cashbackRateBps: number; // 250 = 2.50%
  pointMultiplierPercent: number; // 150 = x1.5
  prioritySupport: boolean;
}

export function sortLevels<T extends { minLifetimeSpend: number }>(levels: T[]): T[] {
  return [...levels].sort((a, b) => a.minLifetimeSpend - b.minLifetimeSpend);
}

// Level is DERIVED, never assigned: the highest level whose threshold the lifetime spend has reached.
export function resolveLevel<T extends { minLifetimeSpend: number }>(sortedLevels: T[], lifetimeSpend: number): { current: T | null; next: T | null } {
  let current: T | null = null;
  for (const level of sortedLevels) {
    if (level.minLifetimeSpend <= lifetimeSpend) current = level;
    else return { current, next: level };
  }
  return { current, next: null };
}

// XP: `xpRate` XP for every full `xpUnitAmount` so'm spent (default 1 XP per 1 so'm). Whole units only, so it never rounds up.
export function xpForSpend(spend: number, xpRate: number, xpUnitAmount: number): number {
  if (spend <= 0 || xpRate <= 0 || xpUnitAmount <= 0) return 0;
  return Math.floor(spend / xpUnitAmount) * xpRate;
}

export interface XpProgress {
  lifetimeXP: number;
  levelStartXP: number; // XP at which the current level began
  levelXP: number; // XP earned inside the current level
  nextLevelXP: number | null; // absolute XP at which the next level begins (null at the top level)
  xpToNextLevel: number | null;
}

export function computeXp(spend: number, current: LevelDef | null, next: LevelDef | null, xpRate: number, xpUnitAmount: number): XpProgress {
  const lifetimeXP = xpForSpend(spend, xpRate, xpUnitAmount);
  const levelStartXP = current ? xpForSpend(current.minLifetimeSpend, xpRate, xpUnitAmount) : 0;
  const nextLevelXP = next ? xpForSpend(next.minLifetimeSpend, xpRate, xpUnitAmount) : null;
  return {
    lifetimeXP,
    levelStartXP,
    levelXP: Math.max(0, lifetimeXP - levelStartXP),
    nextLevelXP,
    xpToNextLevel: nextLevelXP === null ? null : Math.max(0, nextLevelXP - lifetimeXP),
  };
}

// Cashback for one purchase: whole so'm, rounded DOWN (never credits more than the rate).
export function cashbackFor(amountMinor: number, rateBps: number): number {
  if (amountMinor <= 0 || rateBps <= 0) return 0;
  return Math.floor((amountMinor * rateBps) / 10000);
}

// Points for one purchase using the EXISTING loyalty earn settings, scaled by the level's multiplier (percent, floored).
export function pointsFor(amountMinor: number, earnRate: number, earnUnitAmount: number, minimumOrderAmount: number, multiplierPercent: number): number {
  if (amountMinor <= 0 || earnRate <= 0 || earnUnitAmount <= 0 || amountMinor < minimumOrderAmount) return 0;
  const base = Math.floor(amountMinor / earnUnitAmount) * earnRate;
  return Math.floor((base * multiplierPercent) / 100);
}

// --- calendar days (business dates, "YYYY-MM-DD") --------------------------------------------------------------------

export function dayNumber(date: string): number {
  return Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) / 86400000;
}

export interface Streak {
  current: number;
  best: number;
  lastVisitDate: string | null;
}

// Visit streak over the DISTINCT business days on which the customer had a qualifying purchase:
//   two purchases on the same day count once (no increment), the next calendar day adds one, skipping a whole day resets.
// `current` is the run that ends on the last visit day and is still alive only if that day is today or yesterday (today's
// visit may simply not have happened yet); anything older has been reset to 0. `best` is the longest run ever.
export function computeStreak(visitDays: string[], today: string): Streak {
  const days = [...new Set(visitDays)].sort();
  if (days.length === 0) return { current: 0, best: 0, lastVisitDate: null };
  let best = 1;
  let run = 1;
  for (let i = 1; i < days.length; i += 1) {
    run = dayNumber(days[i]) - dayNumber(days[i - 1]) === 1 ? run + 1 : 1;
    if (run > best) best = run;
  }
  const last = days[days.length - 1];
  const alive = dayNumber(today) - dayNumber(last) <= 1;
  return { current: alive ? run : 0, best, lastVisitDate: last };
}

// --- birthday ---------------------------------------------------------------------------------------------------------

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

export interface BirthdayStatus {
  birthdaySet: boolean;
  eligible: boolean;
  rewardYear: number | null; // the birthday year whose window contains today
  windowEndsOn: string | null;
}

// Eligibility only (nothing is granted here): the reward is available from the birthday for `windowDays` days (birthday
// included), once per birthday year. A 29 Feb birthday is celebrated on 28 Feb in non-leap years. The window may straddle
// New Year, so both this year's and last year's birthday are checked. `claimedYears` are years already rewarded.
export function birthdayStatus(birthDate: Date | null, today: string, windowDays: number, claimedYears: ReadonlySet<number>, enabled: boolean): BirthdayStatus {
  if (!birthDate) return { birthdaySet: false, eligible: false, rewardYear: null, windowEndsOn: null };
  const month = birthDate.getUTCMonth();
  const dayOfMonth = birthDate.getUTCDate();
  const todayYear = +today.slice(0, 4);
  const todayN = dayNumber(today);
  for (const year of [todayYear, todayYear - 1]) {
    const day = month === 1 && dayOfMonth === 29 && !isLeap(year) ? 28 : dayOfMonth;
    const startN = Date.UTC(year, month, day) / 86400000;
    const endN = startN + Math.max(1, windowDays) - 1;
    if (todayN >= startN && todayN <= endN) {
      return { birthdaySet: true, eligible: enabled && !claimedYears.has(year), rewardYear: year, windowEndsOn: new Date(endN * 86400000).toISOString().slice(0, 10) };
    }
  }
  return { birthdaySet: true, eligible: false, rewardYear: null, windowEndsOn: null };
}
