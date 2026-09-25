import { CSSProperties } from 'react';
import { cx } from './cx';

// Loading placeholders in the CUP skeleton tone (#F1ECE4) with a gentle shimmer (static under reduced motion).
export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return <div aria-hidden="true" className={cx('animate-shimmer rounded-sm bg-skeleton', className)} style={style} />;
}

export function CardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cx('flex flex-col gap-3 rounded-lg border border-line bg-white p-5', className)}>
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-3 w-32" />
    </div>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="flex flex-col">
      {Array.from({ length: rows }, (_, i) => (
        <div className="flex items-center gap-4 border-b border-line px-4 py-3.5 last:border-b-0" key={i}>
          <Skeleton className="h-3.5 w-1/4" />
          <Skeleton className="h-3.5 w-1/5" />
          <Skeleton className="ml-auto h-3.5 w-20" />
        </div>
      ))}
    </div>
  );
}

export function ChartSkeleton({ className }: { className?: string }) {
  const heights = [40, 65, 50, 80, 55, 90, 70, 60, 85, 45, 75, 95];
  return (
    <div className={cx('flex h-44 items-end gap-2', className)}>
      {heights.map((h, i) => (
        <Skeleton className="flex-1 rounded-b-none" key={i} style={{ height: `${h}%` }} />
      ))}
    </div>
  );
}
