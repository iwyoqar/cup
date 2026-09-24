import { forwardRef, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cx } from './cx';
import { Icon } from './icons';

// Form controls share the `.input` / `.select` styles in ui/components.css (hover, terracotta focus ring, error, disabled).
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input({ className, invalid, ...rest }, ref) {
  return <input {...rest} aria-invalid={invalid || undefined} className={cx('input', className)} ref={ref} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, ...rest }, ref) {
  return <select {...rest} className={cx('select', className)} ref={ref} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(function Textarea({ className, invalid, ...rest }, ref) {
  return <textarea {...rest} aria-invalid={invalid || undefined} className={cx('input h-auto min-h-24 py-2.5 leading-relaxed', className)} ref={ref} />;
});

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
}

export function SearchInput({ value, onChange, placeholder = 'Search', label = 'Search' }: SearchInputProps) {
  return (
    <div className="relative flex min-w-[220px] flex-1 items-end self-end">
      <Icon className="pointer-events-none absolute bottom-3 left-3 size-4 text-muted" name="search" />
      <input aria-label={label} className="input w-full pl-9" onChange={(e) => onChange(e.target.value)} placeholder={placeholder} type="search" value={value} />
    </div>
  );
}

// A row of filters that wraps instead of overflowing on a narrow screen.
export function FilterBar({ children }: { children: ReactNode }) {
  return <div className="mb-5 flex flex-wrap items-end gap-3">{children}</div>;
}

export function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-xs font-semibold text-muted">{label}</span>
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
    <div className="flex flex-wrap items-end gap-3">
      <FilterField label="Period">
        <select className="select" disabled={disabled} onChange={(e) => onChange({ ...value, period: e.target.value as PeriodKey })} value={value.period}>
          {PERIOD_OPTIONS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
      </FilterField>
      {value.period === 'custom' && (
        <>
          <FilterField label="From">
            <input className="input" disabled={disabled} onChange={(e) => onChange({ ...value, startDate: e.target.value })} type="date" value={value.startDate} />
          </FilterField>
          <FilterField label="To">
            <input className="input" disabled={disabled} onChange={(e) => onChange({ ...value, endDate: e.target.value })} type="date" value={value.endDate} />
          </FilterField>
          {!isRangeReady(value) && <span className="self-center text-[13px] text-err">Choose a start date that is not after the end date.</span>}
        </>
      )}
    </div>
  );
}
