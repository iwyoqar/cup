import { ReactNode } from 'react';
import { cx, ErrorState, FilterField, LoadingState } from '../ui';

// Reports Phase D-G — small shared pieces so every new Reports page reads the same way as Overview/Sales/Locations.

export const num = (n: number) => n.toLocaleString('ru-RU');
export const pctOrDash = (n: number | null) => (n === null ? '—' : `${n.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}%`);

export function BranchSelect({ branches, value, onChange }: { branches: { id: string; name: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <FilterField label="Branch">
      <select className="" onChange={(e) => onChange(e.target.value)} value={value}>
        <option value="">All branches</option>
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
    </FilterField>
  );
}

export function PeriodHint({ period, loading }: { period?: { startDate: string; endDate: string }; loading: boolean }) {
  if (!period) return null;
  return (
    <span className="text-[13px] leading-snug text-muted self-center">
      {period.startDate === period.endDate ? period.startDate : `${period.startDate} → ${period.endDate}`}
      {loading && ' · updating…'}
    </span>
  );
}

export function Notes({ notes }: { notes: string[] }) {
  if (notes.length === 0) return null;
  return (
    <div className="block space-y-1 rounded-md border-l-[3px] px-4 py-3 text-sm leading-relaxed [&_p]:m-0 border-muted-cream bg-neutral-bg text-muted-cream">
      {notes.map((n) => (
        <p key={n}>{n}</p>
      ))}
    </div>
  );
}

// Error / first-load / content switch used by every page; keeps stale data dimmed while a new filter loads.
export function ReportBody<T>({ data, error, loading, ready, reload, title, children }: { data: T | null; error: string | null; loading: boolean; ready: boolean; reload: () => void; title: string; children: (data: T) => ReactNode }) {
  if (error) return <ErrorState message={error} onRetry={reload} title={title} />;
  if (!data) return ready ? <LoadingState variant="page" /> : null;
  return <div className={cx('flex min-w-0 flex-col gap-5 transition-opacity duration-200', loading && 'opacity-60')}>{children(data)}</div>;
}
