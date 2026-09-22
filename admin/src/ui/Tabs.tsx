export interface TabItem<T extends string> {
  id: T;
  label: string;
}

export function Tabs<T extends string>({ tabs, active, onChange, label }: { tabs: TabItem<T>[]; active: T; onChange: (id: T) => void; label?: string }) {
  return (
    <div aria-label={label} className="tabs" role="tablist">
      {tabs.map((t) => (
        <button aria-selected={t.id === active} className={`tab${t.id === active ? ' tab--active' : ''}`} key={t.id} onClick={() => onChange(t.id)} role="tab" type="button">
          {t.label}
        </button>
      ))}
    </div>
  );
}

interface PaginationProps {
  page: number;
  pages: number;
  onPage: (page: number) => void;
  total?: number;
  busy?: boolean;
}

export function Pagination({ page, pages, onPage, total, busy }: PaginationProps) {
  if (pages <= 1 && total === undefined) return null;
  return (
    <div className="pager">
      {total !== undefined && <span>{total.toLocaleString('ru-RU')} total</span>}
      <button className="button-secondary button--sm" disabled={busy || page <= 1} onClick={() => onPage(page - 1)} type="button">
        Previous
      </button>
      <span>
        Page {page} of {Math.max(pages, 1)}
      </span>
      <button className="button-secondary button--sm" disabled={busy || page >= pages} onClick={() => onPage(page + 1)} type="button">
        Next
      </button>
    </div>
  );
}
