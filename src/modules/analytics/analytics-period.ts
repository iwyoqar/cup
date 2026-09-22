import { BadRequestException } from '@nestjs/common';

// Phase 17 — business-day arithmetic for analytics. Pure functions, no I/O.
//
// A "day" in analytics is a BUSINESS-LOCAL calendar day. The backend had no timezone convention before this phase;
// the owner operates in Uzbekistan (UTC+5, no daylight saving), so the offset is one config value
// (BUSINESS_TIMEZONE_OFFSET_MINUTES, default 300). A fixed offset — not a zone database — keeps day boundaries
// deterministic and identical between the JavaScript here and the SQL day-grouping in the repository.
//
// Boundaries: a day D covers [D 00:00 local, D+1 00:00 local) expressed in UTC instants. Ranges are start-inclusive,
// end-exclusive, so a sale is in exactly one day and no period double counts a boundary instant.

export type AnalyticsPeriod = 'today' | 'yesterday' | 'last7' | 'last30' | 'custom';

const DAY_MS = 24 * 3600 * 1000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export interface ResolvedRange {
  startDate: string; // YYYY-MM-DD, business-local, inclusive
  endDate: string; // YYYY-MM-DD, business-local, inclusive
  from: Date; // UTC instant of startDate 00:00 local (inclusive)
  to: Date; // UTC instant of endDate+1 00:00 local (exclusive)
  days: number;
}

export function parseBusinessDate(value: string): { y: number; m: number; d: number } | null {
  if (!DATE_ONLY.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  return { y, m, d };
}

export function businessDateOf(instant: Date, offsetMinutes: number): string {
  return new Date(instant.getTime() + offsetMinutes * 60_000).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const p = parseBusinessDate(date)!;
  return new Date(Date.UTC(p.y, p.m - 1, p.d) + days * DAY_MS).toISOString().slice(0, 10);
}

// UTC instant at which the given business-local date begins.
export function startOfBusinessDay(date: string, offsetMinutes: number): Date {
  const p = parseBusinessDate(date)!;
  return new Date(Date.UTC(p.y, p.m - 1, p.d) - offsetMinutes * 60_000);
}

export function rangeFor(startDate: string, endDate: string, offsetMinutes: number): ResolvedRange {
  const s = parseBusinessDate(startDate)!;
  const e = parseBusinessDate(endDate)!;
  const days = Math.round((Date.UTC(e.y, e.m - 1, e.d) - Date.UTC(s.y, s.m - 1, s.d)) / DAY_MS) + 1;
  return { startDate, endDate, from: startOfBusinessDay(startDate, offsetMinutes), to: startOfBusinessDay(addDays(endDate, 1), offsetMinutes), days };
}

export function resolvePeriod(period: Exclude<AnalyticsPeriod, 'custom'>, now: Date, offsetMinutes: number): ResolvedRange {
  const today = businessDateOf(now, offsetMinutes);
  switch (period) {
    case 'today':
      return rangeFor(today, today, offsetMinutes);
    case 'yesterday':
      return rangeFor(addDays(today, -1), addDays(today, -1), offsetMinutes);
    case 'last7':
      return rangeFor(addDays(today, -6), today, offsetMinutes);
    case 'last30':
      return rangeFor(addDays(today, -29), today, offsetMinutes);
  }
}

// Every business date from start to end inclusive (used to zero-fill the chart so gaps are visible, not skipped).
export function enumerateDates(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  for (let d = startDate; d <= endDate; d = addDays(d, 1)) dates.push(d);
  return dates;
}

export const MAX_CUSTOM_DAYS = 366;

// The ONE place a period query (today | yesterday | last7 | last30 | custom + startDate / endDate) becomes a business-day range. Analytics V1 and Branch
// Intelligence both call it, so their date behaviour cannot differ.
export function resolveAnalyticsRange(query: { period: AnalyticsPeriod; startDate?: string; endDate?: string }, now: Date, offset: number): ResolvedRange {
  if (query.period !== 'custom') return resolvePeriod(query.period, now, offset);
  if (!query.startDate || !query.endDate) throw new BadRequestException('A custom range needs startDate and endDate.');
  if (query.startDate > query.endDate) throw new BadRequestException('startDate must not be after endDate.');
  const range = rangeFor(query.startDate, query.endDate, offset);
  if (range.days > MAX_CUSTOM_DAYS) throw new BadRequestException(`A custom range may span at most ${MAX_CUSTOM_DAYS} days.`);
  return range;
}
