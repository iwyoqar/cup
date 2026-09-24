import { BadRequestException } from '@nestjs/common';
import { addDays, businessDateOf, MAX_CUSTOM_DAYS, ResolvedRange, rangeFor } from '../analytics/analytics-period';

// Finance's own period vocabulary (spec Phase 3: today/yesterday/this week/this month/last
// month/custom — a different set from Analytics V1's today/yesterday/last7/last30/custom), built
// from the SAME business-local-day primitives Analytics already established (rangeFor/addDays/
// businessDateOf) so a given calendar day means exactly the same UTC instants in both places.
export type FinancePeriod = 'today' | 'yesterday' | 'thisWeek' | 'thisMonth' | 'lastMonth' | 'custom';

export interface FinancePeriodQuery {
  period: FinancePeriod;
  startDate?: string;
  endDate?: string;
}

function startOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

function endOfMonth(date: string): string {
  const [y, m] = date.slice(0, 7).split('-').map(Number);
  const firstOfNext = new Date(Date.UTC(y, m, 1)); // m is 1-based here, so this IS next month's day 1
  const lastDay = new Date(firstOfNext.getTime() - 86_400_000);
  return lastDay.toISOString().slice(0, 10);
}

// Business-local Monday..today (a partial week for "this week" is expected and correct — it is
// not a rolling 7 days, see startOfWeek's own note).
function startOfWeek(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun..6=Sat
  const back = dow === 0 ? 6 : dow - 1; // days back to Monday
  return addDays(date, -back);
}

export function resolveFinanceRange(query: FinancePeriodQuery, now: Date, offsetMinutes: number): ResolvedRange {
  const today = businessDateOf(now, offsetMinutes);
  switch (query.period) {
    case 'today':
      return rangeFor(today, today, offsetMinutes);
    case 'yesterday':
      return rangeFor(addDays(today, -1), addDays(today, -1), offsetMinutes);
    case 'thisWeek':
      return rangeFor(startOfWeek(today), today, offsetMinutes);
    case 'thisMonth':
      return rangeFor(startOfMonth(today), today, offsetMinutes);
    case 'lastMonth': {
      const lastMonthAnyDay = addDays(startOfMonth(today), -1); // last day of the previous month
      return rangeFor(startOfMonth(lastMonthAnyDay), endOfMonth(lastMonthAnyDay), offsetMinutes);
    }
    case 'custom': {
      if (!query.startDate || !query.endDate) throw new BadRequestException('A custom range needs startDate and endDate.');
      if (query.startDate > query.endDate) throw new BadRequestException('startDate must not be after endDate.');
      const range = rangeFor(query.startDate, query.endDate, offsetMinutes);
      if (range.days > MAX_CUSTOM_DAYS) throw new BadRequestException(`A custom range may span at most ${MAX_CUSTOM_DAYS} days.`);
      return range;
    }
  }
}
