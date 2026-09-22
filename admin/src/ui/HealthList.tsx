import { HealthItem } from '../lib/health';
import { HealthBadge } from './StatusBadge';

// One calm line per component. A healthy row is quiet; a problem row gets a tinted edge so it is the first thing the eye finds.
export function HealthList({ items, compact }: { items: HealthItem[]; compact?: boolean }) {
  return (
    <div className="health">
      {items.map((item) => (
        <div className={`health__row${item.state === 'error' || item.state === 'warning' ? ' health__row--problem' : ''}`} key={item.id}>
          <span aria-hidden="true" className={`dot dot--${item.state}`} />
          <div>
            <span className="health__name">{item.name}</span>
            {!compact && <span className="health__detail">{item.detail}</span>}
          </div>
          <HealthBadge state={item.state} />
        </div>
      ))}
    </div>
  );
}
