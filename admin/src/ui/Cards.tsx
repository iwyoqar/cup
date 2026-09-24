import { ReactNode } from 'react';
import { cx } from './cx';

interface SectionCardProps {
  title?: string;
  description?: ReactNode;
  actions?: ReactNode;
  tone?: 'default' | 'cream';
  /** Remove the body padding — for a table or list that should run edge to edge. */
  flush?: boolean;
  footer?: ReactNode;
  children?: ReactNode;
  className?: string;
}

// The one container every page section uses: white surface, hairline border, 16 px radius, serif title.
export function SectionCard({ title, description, actions, tone = 'default', flush, footer, children, className }: SectionCardProps) {
  return (
    <section className={cx('min-w-0 overflow-hidden rounded-lg border', tone === 'cream' ? 'border-cream bg-cream-soft' : 'border-line bg-white', className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-3 px-6 pt-5 pb-1">
          <div className="min-w-0">
            {title && <h2 className="font-display text-lg leading-tight font-medium text-black">{title}</h2>}
            {description && <p className="mt-1 max-w-3xl text-[13px] leading-snug text-muted">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children !== undefined && <div className={flush ? cx('mt-3', title || actions ? 'border-t border-line' : '') : 'px-6 pt-4 pb-5'}>{children}</div>}
      {footer && <div className="border-t border-line bg-canvas/60 px-6 py-3">{footer}</div>}
    </section>
  );
}

// A plain card surface for custom layouts.
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('rounded-lg border border-line bg-white p-5', className)}>{children}</div>;
}

interface StatCardProps {
  label: string;
  value: string;
  hint?: ReactNode;
  /** One emphasised figure per row at most; never every card. */
  strong?: boolean;
}

// KPI tile: quiet uppercase label, a large serif figure, muted metadata. `strong` inverts it to the brand black.
export function StatCard({ label, value, hint, strong }: StatCardProps) {
  return (
    <div className={cx('group flex min-w-0 flex-col gap-2 rounded-lg border p-4 sm:p-5 transition-colors duration-200', strong ? 'border-black bg-black text-white' : 'border-line bg-white hover:border-line-strong')}>
      <div className={cx('text-[11px] font-semibold tracking-[0.08em] uppercase', strong ? 'text-cream' : 'text-muted')}>{label}</div>
      <div className="font-display text-[22px] leading-[1.15] sm:text-[26px] tabular-nums [overflow-wrap:anywhere] xl:text-[28px]">{value}</div>
      {hint && <div className={cx('text-xs leading-snug', strong ? 'text-white/65' : 'text-muted')}>{hint}</div>}
    </div>
  );
}

// KPI with an optional change figure ("+12.4% vs previous period"). The direction is shown with a restrained status tone.
export function KPICard({ label, value, change, changeLabel = 'vs previous period', hint }: { label: string; value: string; change?: number | null; changeLabel?: string; hint?: ReactNode }) {
  const tone = change === undefined || change === null ? null : change > 0 ? 'text-ok bg-ok-bg' : change < 0 ? 'text-err bg-err-bg' : 'text-neutral bg-neutral-bg';
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-line bg-white p-5">
      <div className="text-[11px] font-semibold tracking-[0.08em] text-muted uppercase">{label}</div>
      <div className="font-display text-[22px] leading-[1.15] sm:text-[26px] tabular-nums [overflow-wrap:anywhere] xl:text-[28px]">{value}</div>
      {tone && (
        <div className="flex items-center gap-2 text-xs text-muted">
          <span className={cx('rounded-full px-2 py-0.5 font-semibold tabular-nums', tone)}>
            {change! > 0 ? '+' : ''}
            {change!.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%
          </span>
          {changeLabel}
        </div>
      )}
      {hint && <div className="text-xs leading-snug text-muted">{hint}</div>}
    </div>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] sm:grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-4">{children}</div>;
}

export function KeyValue({ rows }: { rows: { key: string; label: ReactNode; value: ReactNode }[] }) {
  return (
    <dl className="m-0 divide-y divide-line">
      {rows.map((row) => (
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-2.5 first:pt-0 last:pb-0" key={row.key}>
          <dt className="text-[13px] text-muted">{row.label}</dt>
          <dd className="m-0 text-right text-sm font-semibold tabular-nums">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
