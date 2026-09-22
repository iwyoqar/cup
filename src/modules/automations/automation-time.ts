// Phase 13 — pure time rules for CRM automation. No I/O, no clock: every function is a deterministic function of its arguments and the
// FIXED business-timezone offset (BUSINESS_TIMEZONE_OFFSET_MINUTES, no DST), exactly like Analytics / Loyalty 2.0.

const DAY_MS = 86_400_000;

export const localDate = (at: Date, offsetMinutes: number): string => new Date(at.getTime() + offsetMinutes * 60_000).toISOString().slice(0, 10);
export const localMinutes = (at: Date, offsetMinutes: number): number => {
  const local = new Date(at.getTime() + offsetMinutes * 60_000);
  return local.getUTCHours() * 60 + local.getUTCMinutes();
};

export function hhmmToMinutes(hhmm: string): number {
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
}
export function minutesToHhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

// Quiet hours [start, end) in business minutes-of-day; the window may cross midnight (21:00-09:00). start === end means "no quiet hours".
export function inQuietHours(nowMinutes: number, startMinutes: number, endMinutes: number): boolean {
  if (startMinutes === endMinutes) return false;
  return startMinutes < endMinutes ? nowMinutes >= startMinutes && nowMinutes < endMinutes : nowMinutes >= startMinutes || nowMinutes < endMinutes;
}

// The next instant at which quiet hours end (business time) — where deferred sends become due.
export function quietHoursEndAt(now: Date, endMinutes: number, offsetMinutes: number): Date {
  const local = new Date(now.getTime() + offsetMinutes * 60_000);
  const todayLocalMidnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  let endLocal = todayLocalMidnight + endMinutes * 60_000;
  if (endLocal <= local.getTime()) endLocal += DAY_MS;
  return new Date(endLocal - offsetMinutes * 60_000);
}

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

// Birthday rule: "today matches the birthday rule" = the birthday falls on (today + daysBefore) in business time. Returns the MM-DD strings a
// stored birthDate may have to match (a 29 Feb birthday is celebrated on 28 Feb in non-leap years) and the birthday's year (for the trigger key).
export function birthdayTarget(today: string, daysBefore: number): { monthDays: string[]; year: number } {
  const targetMs = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10)) + daysBefore * DAY_MS;
  const target = new Date(targetMs);
  const year = target.getUTCFullYear();
  const md = target.toISOString().slice(5, 10);
  return { monthDays: md === '02-28' && !isLeap(year) ? ['02-28', '02-29'] : [md], year };
}

export interface ScheduleConfig {
  frequency: 'DAILY' | 'WEEKLY';
  weekday?: number;
  time: string;
}

// The most recent scheduled occurrence at or before `now` (business time), as a stable run key + instant. A DAILY schedule fires every local day at
// `time`; a WEEKLY one on `weekday`. The run key is the local date + time, so it is identical for every runner and every retry.
export function latestScheduleOccurrence(now: Date, offsetMinutes: number, schedule: ScheduleConfig): { runKey: string; at: Date } {
  const time = hhmmToMinutes(schedule.time);
  const local = new Date(now.getTime() + offsetMinutes * 60_000);
  let dayMs = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const nowLocal = local.getTime();
  const at = (d: number) => d + time * 60_000;
  if (schedule.frequency === 'DAILY') {
    if (at(dayMs) > nowLocal) dayMs -= DAY_MS;
  } else {
    const weekday = schedule.weekday as number;
    for (let i = 0; i < 8; i += 1) {
      if (new Date(dayMs).getUTCDay() === weekday && at(dayMs) <= nowLocal) break;
      dayMs -= DAY_MS;
    }
  }
  return { runKey: `${new Date(dayMs).toISOString().slice(0, 10)}T${schedule.time}`, at: new Date(at(dayMs) - offsetMinutes * 60_000) };
}
