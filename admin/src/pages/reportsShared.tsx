import { ReactNode } from 'react';
import { ErrorState, FilterField, LoadingState } from '../ui';

// Reports Phase D-G — small shared pieces so every new Reports page reads the same way as Overview/Sales/Locations.

export const num = (n: number) => n.toLocaleString('ru-RU');
export const pctOrDash = (n: number | null) => (n === null ? '—' : `${n.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}%`);

export function BranchSelect({ branches, value, onChange }: { branches: { id: string; name: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <FilterField label="Branch">
      <select className="select" onChange={(e) => onChange(e.target.value)} value={value}>
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
    <span className="hint-text" style={{ alignSelf: 'center' }}>
      {period.startDate === period.endDate ? period.startDate : `${period.startDate} → ${period.endDate}`}
      {loading && ' · updating…'}
    </span>
  );
}

export function Notes({ notes }: { notes: string[] }) {
  if (notes.length === 0) return null;
  return (
    <div className="callout">
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
  return <div className="stack" style={{ opacity: loading ? 0.6 : 1, transition: 'opacity var(--motion-base) var(--ease)' }}>{children(data)}</div>;
}
