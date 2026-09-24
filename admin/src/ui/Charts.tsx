import { ReactNode, useEffect, useRef, useState } from 'react';
import { SectionCard } from './Cards';
import { cx } from './cx';
import { EmptyState } from './States';

// Charts animate ONCE, when they first scroll into view (transform/opacity only; instant under reduced motion).
function useInView<T extends Element>(): [React.RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (typeof IntersectionObserver === 'undefined') {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setSeen(true);
        io.disconnect();
      }
    }, { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return [ref, seen];
}

interface ChartContainerProps {
  title: string;
  description?: ReactNode;
  legend?: { label: string }[];
  actions?: ReactNode;
  children: ReactNode;
}

// A chart is a section with a title and (optionally) a legend — charts never sit on the page bare, and never dominate it.
export function ChartContainer({ title, description, legend, actions, children }: ChartContainerProps) {
  return (
    <SectionCard actions={actions} description={description} title={title}>
      {legend && (
        <div className="mb-3 flex flex-wrap gap-4 text-xs text-muted">
          {legend.map((l) => (
            <span className="inline-flex items-center gap-1.5" key={l.label}>
              <span className="size-2.5 rounded-[3px] bg-black" />
              {l.label}
            </span>
          ))}
        </div>
      )}
      {children}
    </SectionCard>
  );
}

interface BarChartProps {
  data: { label: string; value: number }[];
  format: (value: number) => string;
  ariaLabel: string;
  emptyText?: string;
}

// Lightweight bar chart (no chart library): black bars, the latest bar in terracotta, a hairline grid and a hover
// tooltip. Heights only draw the backend's numbers.
export function BarChart({ data, format, ariaLabel, emptyText = 'No data for this period.' }: BarChartProps) {
  const [ref, seen] = useInView<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...data.map((d) => d.value), 0);
  if (data.length === 0 || max === 0) return <EmptyState text={emptyText} title="Nothing to chart" variant="inline" />;
  const active = hover === null ? null : data[hover];
  return (
    <div className="relative" ref={ref}>
      <div className="mb-2 h-5 text-xs text-muted" aria-live="polite">
        {active ? (
          <>
            <span className="font-semibold text-black">{format(active.value)}</span> · {active.label}
          </>
        ) : (
          <>Peak {format(max)}</>
        )}
      </div>
      <div aria-label={ariaLabel} className="relative flex h-44 items-end gap-[3px] border-b border-line" onMouseLeave={() => setHover(null)} role="img">
        {[0.25, 0.5, 0.75].map((f) => (
          <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 border-t border-dashed border-line" key={f} style={{ bottom: `${f * 100}%` }} />
        ))}
        {data.map((d, i) => {
          const h = d.value === 0 ? 0 : Math.max(1.5, (d.value / max) * 100);
          const latest = i === data.length - 1;
          return (
            <div className="relative flex h-full min-w-[2px] flex-1 items-end" key={d.label} onMouseEnter={() => setHover(i)} title={`${d.label}: ${format(d.value)}`}>
              <div
                className={cx('w-full origin-bottom rounded-t-[3px] transition-[transform,opacity] duration-500 ease-out', latest ? 'bg-terracotta' : 'bg-black/80', hover !== null && hover !== i && 'opacity-40')}
                style={{ height: `${h}%`, transform: seen ? 'scaleY(1)' : 'scaleY(0)', transitionDelay: seen ? `${Math.min(i * 12, 300)}ms` : '0ms' }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-muted tabular-nums">
        <span>{data[0].label}</span>
        {data.length > 2 && <span>{data[Math.floor(data.length / 2)].label}</span>}
        <span>{data[data.length - 1].label}</span>
      </div>
    </div>
  );
}

// A ranked list with a proportional bar under each row — for "top products" style breakdowns.
export function HBarList({ items }: { items: { name: string; value: number; valueLabel: string; hint?: string }[] }) {
  const [ref, seen] = useInView<HTMLDivElement>();
  const max = Math.max(...items.map((i) => i.value), 0);
  return (
    <div className="flex flex-col gap-3.5" ref={ref}>
      {items.map((item, i) => {
        const pct = max > 0 ? Math.max(2, (item.value / max) * 100) : 0;
        return (
          <div className="flex flex-col gap-1.5" key={item.name}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate font-medium" title={item.name}>
                {item.name}
              </span>
              <span className="shrink-0 text-[13px] text-muted tabular-nums">
                <span className="font-semibold text-black">{item.valueLabel}</span>
                {item.hint ? ` · ${item.hint}` : ''}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-skeleton">
              <div
                className={cx('h-full origin-left rounded-full transition-transform duration-700 ease-out', i === 0 ? 'bg-terracotta' : 'bg-black/75')}
                style={{ width: `${pct}%`, transform: seen ? 'scaleX(1)' : 'scaleX(0)', transitionDelay: seen ? `${Math.min(i * 40, 320)}ms` : '0ms' }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
