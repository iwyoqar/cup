import { forwardRef, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cx } from './cx';
import { Icon } from './icons';

// Form controls — pure Tailwind. Shared field chrome (border/hover/focus
// ring/disabled/invalid) lives in FIELD_BASE so Input/Select/Textarea render identically to before.
const FIELD_BASE =
  'h-10 min-w-0 rounded-sm border border-line-strong bg-white px-3 text-sm text-black transition-[border-color,box-shadow] duration-150 ease-out hover:not-disabled:border-black/30 disabled:cursor-not-allowed disabled:bg-neutral-bg disabled:text-muted placeholder:text-muted/70 focus:border-terracotta focus:outline-none focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-terracotta)_18%,transparent)] aria-invalid:border-err';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input({ className, invalid, ...rest }, ref) {
  return <input {...rest} aria-invalid={invalid || undefined} className={cx(FIELD_BASE, className)} ref={ref} />;
});

// The chevron is a fixed data-URI SVG, not a static token — kept as an inline style (merged with any caller style)
// rather than an awkward Tailwind arbitrary-value class encoding a whole data: URL.
const CHEVRON_STYLE = {
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%236f6a63' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 10px center',
  backgroundSize: '16px',
} as const;

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, style, ...rest }, ref) {
  return <select {...rest} className={cx(FIELD_BASE, 'appearance-none pr-9', className)} ref={ref} style={{ ...CHEVRON_STYLE, ...style }} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(function Textarea({ className, invalid, ...rest }, ref) {
  return <textarea {...rest} aria-invalid={invalid || undefined} className={cx(FIELD_BASE, 'h-auto min-h-24 py-2.5 leading-relaxed', className)} ref={ref} />;
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
      {/* pl-9! (important): FIELD_BASE's own px-3 sets the same padding-left utility axis, and cx() does not merge
          conflicting utilities (no tailwind-merge) — the `!` suffix makes this override deterministic rather than
          depending on Tailwind's generation order. */}
      <Input aria-label={label} className="w-full pl-9!" onChange={(e) => onChange(e.target.value)} placeholder={placeholder} type="search" value={value} />
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
        <Select disabled={disabled} onChange={(e) => onChange({ ...value, period: e.target.value as PeriodKey })} value={value.period}>
          {PERIOD_OPTIONS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </Select>
      </FilterField>
      {value.period === 'custom' && (
        <>
          <FilterField label="From">
            <Input disabled={disabled} onChange={(e) => onChange({ ...value, startDate: e.target.value })} type="date" value={value.startDate} />
          </FilterField>
          <FilterField label="To">
            <Input disabled={disabled} onChange={(e) => onChange({ ...value, endDate: e.target.value })} type="date" value={value.endDate} />
          </FilterField>
          {!isRangeReady(value) && <span className="self-center text-[13px] text-err">Choose a start date that is not after the end date.</span>}
        </>
      )}
    </div>
  );
}
