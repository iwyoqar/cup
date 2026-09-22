import { ReactNode } from 'react';

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

// The one container every page section uses: white, hairline border, 16 px radius, serif title — the same card language as the Mini App.
export function SectionCard({ title, description, actions, tone = 'default', flush, footer, children, className }: SectionCardProps) {
  return (
    <section className={`card${tone === 'cream' ? ' card--cream' : ''}${className ? ` ${className}` : ''}`}>
      {(title || actions) && (
        <div className="card__head">
          <div>
            {title && <h2 className="card__title">{title}</h2>}
            {description && <p className="card__desc">{description}</p>}
          </div>
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      {children !== undefined && <div className={`card__body${flush ? ' card__body--flush' : ''}`}>{children}</div>}
      {footer && <div className="card__foot">{footer}</div>}
    </section>
  );
}

interface StatCardProps {
  label: string;
  value: string;
  hint?: ReactNode;
  /** One emphasised figure per row at most; never every card. */
  strong?: boolean;
}

export function StatCard({ label, value, hint, strong }: StatCardProps) {
  return (
    <div className={`stat${strong ? ' stat--strong' : ''}`}>
      <div className="stat__label">{label}</div>
      <div className="stat__value">{value}</div>
      {hint && <div className="stat__hint">{hint}</div>}
    </div>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="stat-grid">{children}</div>;
}

export function KeyValue({ rows }: { rows: { key: string; label: ReactNode; value: ReactNode }[] }) {
  return (
    <div className="kv">
      {rows.map((row) => (
        <div className="kv__row" key={row.key}>
          <div className="kv__k">{row.label}</div>
          <div className="kv__v">{row.value}</div>
        </div>
      ))}
    </div>
  );
}
