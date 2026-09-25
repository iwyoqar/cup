import { KeyboardEvent, useRef } from 'react';
import { Button } from './Button';
import { cx } from './cx';

export interface TabItem<T extends string> {
  id: T;
  label: string;
}

// Segmented tabs with roving arrow-key focus (WAI-ARIA tabs pattern).
export function Tabs<T extends string>({ tabs, active, onChange, label }: { tabs: TabItem<T>[]; active: T; onChange: (id: T) => void; label?: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = (i + delta + tabs.length) % tabs.length;
    refs.current[next]?.focus();
    onChange(tabs[next].id);
  };
  return (
    <div aria-label={label} className="inline-flex max-w-full gap-1 overflow-x-auto rounded-md border border-line bg-white p-1" role="tablist">
      {tabs.map((t, i) => {
        const selected = t.id === active;
        return (
          <button
            aria-selected={selected}
            className={cx('h-8 rounded-sm px-3.5 text-[13px] font-semibold whitespace-nowrap transition-colors duration-150', selected ? 'bg-black text-white' : 'text-muted hover:bg-hover hover:text-black')}
            key={t.id}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => onKey(e, i)}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="tab"
            tabIndex={selected ? 0 : -1}
            type="button"
          >
            {t.label}
          </button>
        );
      })}
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

// Numbered page buttons are a compact square shape (min-w-8 px-2) that doesn't fit Button's own sizing — composed
// locally as one atomic string per state (never two classes fighting over the same padding/width utility, since
// cx() has no tailwind-merge — see Button.tsx's sizing() comment for why that matters).
const PAGE_BASE =
  'inline-flex h-8 min-w-8 cursor-pointer items-center justify-center rounded-sm border border-transparent px-2 text-[13px] font-semibold whitespace-nowrap transition-[background-color,border-color,color,box-shadow,transform,opacity] duration-150 ease-out active:not-disabled:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45';
const PAGE_ACTIVE = 'bg-terracotta text-black shadow-soft hover:not-disabled:brightness-[0.94]';
const PAGE_INACTIVE = 'bg-transparent text-muted hover:not-disabled:bg-hover hover:not-disabled:text-black';

// Previous / numbered pages (with gaps) / Next.
export function Pagination({ page, pages, onPage, total, busy }: PaginationProps) {
  if (pages <= 1 && total === undefined) return null;
  const last = Math.max(pages, 1);
  const shown = [...new Set([1, page - 1, page, page + 1, last])].filter((p) => p >= 1 && p <= last).sort((a, b) => a - b);
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-4 py-3 text-[13px] text-muted">
      <span className="mr-auto">{total !== undefined ? `${total.toLocaleString('ru-RU')} total` : `Page ${page} of ${last}`}</span>
      <Button disabled={busy || page <= 1} onClick={() => onPage(page - 1)} size="sm" variant="secondary">
        Previous
      </Button>
      {shown.map((p, i) => (
        <span className="contents" key={p}>
          {i > 0 && p - shown[i - 1] > 1 && <span aria-hidden="true">…</span>}
          <button aria-current={p === page ? 'page' : undefined} className={cx(PAGE_BASE, p === page ? PAGE_ACTIVE : PAGE_INACTIVE)} disabled={busy} onClick={() => onPage(p)} type="button">
            {p}
          </button>
        </span>
      ))}
      <Button disabled={busy || page >= last} onClick={() => onPage(page + 1)} size="sm" variant="secondary">
        Next
      </Button>
    </nav>
  );
}
