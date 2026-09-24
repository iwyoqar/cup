import { ReactNode } from 'react';
import { Button } from './Button';
import { cx } from './cx';
import { CardSkeleton, ChartSkeleton, Skeleton, TableSkeleton } from './Skeleton';

interface EmptyStateProps {
  title: string;
  text?: ReactNode;
  action?: ReactNode;
  /** `block` (cream card, for a whole section) or `inline` (quiet, for inside a table or panel). */
  variant?: 'block' | 'inline';
}

// Never a blank area: say what is missing and what to do next.
export function EmptyState({ title, text, action, variant = 'block' }: EmptyStateProps) {
  return (
    <div className={cx('flex flex-col items-center gap-1.5 text-center', variant === 'inline' ? 'px-4 py-8' : 'rounded-lg border border-cream bg-cream-soft px-6 py-10')}>
      <span aria-hidden="true" className="mb-1 grid size-9 place-items-center rounded-full bg-canvas text-muted ring-1 ring-line">
        <svg className="size-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth={1.8} viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="7.5" />
          <path d="M9 12h6" />
        </svg>
      </span>
      <div className="font-display text-base font-medium text-black">{title}</div>
      {text && <div className="max-w-md text-[13px] leading-snug text-muted">{text}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

interface LoadingStateProps {
  /** `page` = a header + stat row + panels; `card` = one panel; `table` = rows; `inline` = a single line; `chart` = bars. */
  variant?: 'page' | 'card' | 'table' | 'inline' | 'chart';
  rows?: number;
  label?: string;
}

export function LoadingState({ variant = 'card', rows = 5, label = 'Loading' }: LoadingStateProps) {
  const body =
    variant === 'inline' ? (
      <Skeleton className="h-4.5 w-40" />
    ) : variant === 'table' ? (
      <TableSkeleton rows={rows} />
    ) : variant === 'chart' ? (
      <ChartSkeleton />
    ) : variant === 'page' ? (
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] sm:grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-4">
          {[0, 1, 2, 3].map((i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
        <div className="rounded-lg border border-line bg-white p-6">
          <Skeleton className="mb-5 h-4 w-48" />
          <ChartSkeleton />
        </div>
      </div>
    ) : (
      <div className="rounded-lg border border-line bg-white p-6">
        <Skeleton className="mb-4 h-4 w-40" />
        <Skeleton className="h-28" />
      </div>
    );
  return (
    <div aria-busy="true" aria-label={label} role="status">
      <span className="sr-only">{label}…</span>
      {body}
    </div>
  );
}

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
}

// Errors stay inside the brand language: a soft terracotta-tinted panel with a clear retry, never a red alarm or raw error.
export function ErrorState({ title = 'Something went wrong', message, onRetry }: ErrorStateProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-err/20 bg-err-bg px-5 py-4" role="alert">
      <div className="flex min-w-0 items-start gap-3">
        <span aria-hidden="true" className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-white text-sm font-bold text-err">!</span>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-err">{title}</div>
          <div className="mt-0.5 text-[13px] text-muted-cream">{message}</div>
        </div>
      </div>
      {onRetry && (
        <Button onClick={onRetry} size="sm" variant="secondary">
          Try again
        </Button>
      )}
    </div>
  );
}
