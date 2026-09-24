import { HealthItem } from '../lib/health';
import { cx } from './cx';
import { HEALTH_DOT, HealthBadge } from './StatusBadge';

// One calm line per component. A healthy row is quiet; a problem row gets a tinted edge so it is the first thing the eye finds.
export function HealthList({ items, compact }: { items: HealthItem[]; compact?: boolean }) {
  return (
    <div className="flex flex-col divide-y divide-line">
      {items.map((item) => {
        const problem = item.state === 'error' || item.state === 'warning';
        return (
          <div className={cx('grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 py-3 first:pt-0 last:pb-0', problem && '-mx-3 rounded-sm border-l-2 border-terracotta bg-cream-soft px-3 first:pt-3 last:pb-3')} key={item.id}>
            <span aria-hidden="true" className={cx('size-2 rounded-full', HEALTH_DOT[item.state])} />
            <div className="min-w-0">
              <span className="block text-sm font-semibold">{item.name}</span>
              {!compact && <span className="block truncate text-[13px] text-muted">{item.detail}</span>}
            </div>
            <HealthBadge state={item.state} />
          </div>
        );
      })}
    </div>
  );
}
