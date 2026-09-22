import { ReactNode } from 'react';

interface EmptyStateProps {
  title: string;
  text?: ReactNode;
  action?: ReactNode;
  /** `block` (cream card, for a whole section) or `inline` (quiet, for inside a table or panel). */
  variant?: 'block' | 'inline';
}

// Never a blank area: when the API has nothing, say so and say what to do next (the Mini App's cream empty block).
export function EmptyState({ title, text, action, variant = 'block' }: EmptyStateProps) {
  return (
    <div className={`state-empty${variant === 'inline' ? ' state-empty--inline' : ''}`}>
      <div className="state-empty__title">{title}</div>
      {text && <div className="state-empty__text">{text}</div>}
      {action && <div className="state-empty__action">{action}</div>}
    </div>
  );
}

interface LoadingStateProps {
  /** `page` = a header + stat row + panels; `card` = one panel; `table` = rows; `inline` = a single line. */
  variant?: 'page' | 'card' | 'table' | 'inline';
  rows?: number;
  label?: string;
}

export function LoadingState({ variant = 'card', rows = 5, label = 'Loading' }: LoadingStateProps) {
  if (variant === 'inline') {
    return (
      <div aria-busy="true" aria-label={label} className="skeleton" style={{ height: 18, width: 160 }} />
    );
  }
  if (variant === 'table') {
    return (
      <div aria-busy="true" aria-label={label} className="stack" style={{ padding: 16 }}>
        {Array.from({ length: rows }, (_, i) => (
          <div className="skeleton" key={i} style={{ height: 38 }} />
        ))}
      </div>
    );
  }
  if (variant === 'page') {
    return (
      <div aria-busy="true" aria-label={label} className="loading-page">
        <div className="skeleton" style={{ height: 40, width: 'min(320px, 60%)' }} />
        <div className="loading-page__stats">
          {[0, 1, 2, 3].map((i) => (
            <div className="skeleton" key={i} style={{ height: 96 }} />
          ))}
        </div>
        <div className="skeleton" style={{ height: 240 }} />
      </div>
    );
  }
  return <div aria-busy="true" aria-label={label} className="skeleton" style={{ height: 160 }} />;
}

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
}

// Errors stay inside the brand language: a cream banner with a terracotta edge, never a red alarm.
export function ErrorState({ title = 'Something went wrong', message, onRetry }: ErrorStateProps) {
  return (
    <div className="state-error" role="alert">
      <div>
        <div className="state-error__title">{title}</div>
        <div className="state-error__text">{message}</div>
      </div>
      {onRetry && (
        <button className="button-primary button--sm" onClick={onRetry} type="button">
          Retry
        </button>
      )}
    </div>
  );
}
