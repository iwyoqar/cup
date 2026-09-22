import { ReactNode } from 'react';
import { SectionCard } from './Cards';
import { EmptyState } from './States';

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
        <div className="chart__legend">
          {legend.map((l) => (
            <span className="chart__legend-item" key={l.label}>
              <span className="chart__swatch" />
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

// Lightweight SVG bar chart (no chart library). Bar height is only a drawing of the backend's numbers; the latest bar is the one accent.
export function BarChart({ data, format, ariaLabel, emptyText = 'No data for this period.' }: BarChartProps) {
  const max = Math.max(...data.map((d) => d.value), 0);
  if (data.length === 0 || max === 0) return <EmptyState text={emptyText} title="Nothing to chart" variant="inline" />;
  const width = 640;
  const height = 180;
  const gap = data.length > 45 ? 1 : 4;
  const barWidth = Math.max(2, (width - gap * (data.length - 1)) / data.length);
  return (
    <div className="bar-chart">
      <svg aria-label={ariaLabel} preserveAspectRatio="none" role="img" viewBox={`0 0 ${width} ${height}`}>
        {data.map((d, i) => {
          const h = d.value === 0 ? 0 : Math.max(2, (d.value / max) * (height - 8));
          const latest = i === data.length - 1;
          return (
            <rect className="bar-chart__bar" height={h} key={d.label} rx={1} style={latest ? { fill: 'var(--cup-terracotta)' } : undefined} width={barWidth} x={i * (barWidth + gap)} y={height - h}>
              <title>{`${d.label}: ${format(d.value)}`}</title>
            </rect>
          );
        })}
      </svg>
      <div className="bar-chart__axis">
        <span>{data[0].label}</span>
        {data.length > 2 && <span>{data[Math.floor(data.length / 2)].label}</span>}
        <span>{data[data.length - 1].label}</span>
      </div>
    </div>
  );
}

// A ranked list with a proportional bar behind each row — for "top products" style breakdowns.
export function HBarList({ items }: { items: { name: string; value: number; valueLabel: string; hint?: string }[] }) {
  const max = Math.max(...items.map((i) => i.value), 0);
  return (
    <div className="hbar">
      {items.map((item) => (
        <div className="hbar__row" key={item.name}>
          <span className="hbar__name" title={item.name}>
            {item.name}
          </span>
          <span className="hbar__value">
            {item.valueLabel}
            {item.hint ? ` · ${item.hint}` : ''}
          </span>
          <span className="hbar__track">
            <span className="hbar__fill" style={{ width: `${max > 0 ? Math.max(2, (item.value / max) * 100) : 0}%` }} />
          </span>
        </div>
      ))}
    </div>
  );
}
