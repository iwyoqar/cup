import { ReactNode } from 'react';
import { Icon } from './icons';

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
}

export function SearchInput({ value, onChange, placeholder = 'Search', label = 'Search' }: SearchInputProps) {
  return (
    <div className="search">
      <Icon name="search" />
      <input aria-label={label} className="input" onChange={(e) => onChange(e.target.value)} placeholder={placeholder} type="search" value={value} />
    </div>
  );
}

// A row of filters that wraps instead of overflowing on a narrow screen.
export function FilterBar({ children }: { children: ReactNode }) {
  return <div className="filter-bar">{children}</div>;
}

export function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="filter-bar__group">
      <span className="filter-bar__label">{label}</span>
      {children}
    </label>
  );
}

export type PeriodKey = 'today' | 'yesterday' | 'last7' | 'last30' | 'custom';

export const PERIOD_OPTIONS: { key: PeriodKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'last7', label: 'Last 7 days' },
  { key: 'last30', label: 'Last 30 days' },
  { key: 'custom', label: 'Custom range' },
];

export interface DateRangeValue {
  period: PeriodKey;
  startDate: string;
  endDate: string;
}

interface DateRangePickerProps {
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  disabled?: boolean;
}

export function isRangeReady(value: DateRangeValue): boolean {
  return value.period !== 'custom' || (value.startDate !== '' && value.endDate !== '' && value.startDate <= value.endDate);
}

// Presets plus a custom range. The parent decides when it is "ready" to fetch (a custom range needs both dates, start not after end).
export function DateRangePicker({ value, onChange, disabled }: DateRangePickerProps) {
  return (
    <div className="range">
      <label className="filter-bar__group">
        <span className="filter-bar__label">Period</span>
        <select
          className="select"
          disabled={disabled}
          onChange={(e) => onChange({ ...value, period: e.target.value as PeriodKey })}
          value={value.period}
        >
          {PERIOD_OPTIONS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      {value.period === 'custom' && (
        <>
          <label className="filter-bar__group">
            <span className="filter-bar__label">From</span>
            <input className="input" disabled={disabled} onChange={(e) => onChange({ ...value, startDate: e.target.value })} type="date" value={value.startDate} />
          </label>
          <label className="filter-bar__group">
            <span className="filter-bar__label">To</span>
            <input className="input" disabled={disabled} onChange={(e) => onChange({ ...value, endDate: e.target.value })} type="date" value={value.endDate} />
          </label>
          {!isRangeReady(value) && <span className="range__hint">Choose a start date that is not after the end date.</span>}
        </>
      )}
    </div>
  );
}
