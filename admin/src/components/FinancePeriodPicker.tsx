import { FinancePeriodKey } from '../lib/types';

// Finance's own period vocabulary (today/yesterday/this week/this month/last month/custom — Phase 3's spec),
// distinct from Analytics' PeriodKey (today/yesterday/last7/last30/custom) — see finance-period.ts on the backend.
export interface FinanceRangeValue {
  period: FinancePeriodKey;
  startDate: string;
  endDate: string;
}

const OPTIONS: { key: FinancePeriodKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'thisWeek', label: 'This week' },
  { key: 'thisMonth', label: 'This month' },
  { key: 'lastMonth', label: 'Last month' },
  { key: 'custom', label: 'Custom range' },
];

export function isFinanceRangeReady(value: FinanceRangeValue): boolean {
  return value.period !== 'custom' || (value.startDate !== '' && value.endDate !== '' && value.startDate <= value.endDate);
}

export function FinancePeriodPicker({ value, onChange, disabled }: { value: FinanceRangeValue; onChange: (value: FinanceRangeValue) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex min-w-0 flex-col gap-1.5">
        <span className="text-xs font-semibold text-muted">Period</span>
        <select className="" disabled={disabled} onChange={(e) => onChange({ ...value, period: e.target.value as FinancePeriodKey })} value={value.period}>
          {OPTIONS.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      {value.period === 'custom' && (
        <>
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="text-xs font-semibold text-muted">From</span>
            <input className="" disabled={disabled} onChange={(e) => onChange({ ...value, startDate: e.target.value })} type="date" value={value.startDate} />
          </label>
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="text-xs font-semibold text-muted">To</span>
            <input className="" disabled={disabled} onChange={(e) => onChange({ ...value, endDate: e.target.value })} type="date" value={value.endDate} />
          </label>
          {!isFinanceRangeReady(value) && <span className="self-center text-[13px] text-err">Choose a start date that is not after the end date.</span>}
        </>
      )}
    </div>
  );
}
