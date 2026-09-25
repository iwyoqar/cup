import { ReactNode } from 'react';
import { cx } from './cx';
import { tableClass } from './table';
import { EmptyState } from './States';
import { TableSkeleton } from './Skeleton';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Numbers and money align right and use tabular figures. */
  numeric?: boolean;
  /** Secondary columns are hidden on phones so the table stays readable without sideways scrolling. */
  low?: boolean;
  /** Right-aligned action buttons. */
  actions?: boolean;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  /** `index` is only for rows with no other stable identity (e.g. a static preview list with no id field). */
  rowKey: (row: T, index: number) => string;
  onRowClick?: (row: T) => void;
  /** Shown instead of the table when there are no rows. */
  empty?: ReactNode;
  /** Wrap the table in its own bordered box (when it is not inside a SectionCard). */
  boxed?: boolean;
  caption?: string;
  /** Show skeleton rows instead of the table (first load only — reloads keep the old rows visible). */
  loading?: boolean;
  /** Long tables: the table scrolls inside a 70vh box with a sticky header. */
  stickyHeader?: boolean;
  /** Extra classes for one row (e.g. highlighting the selected row) — composed after the base row classes. */
  rowClassName?: (row: T) => string | undefined;
}

// One table for the whole Admin — pure Tailwind. Quiet uppercase
// header, 48px rows, subtle hover, right-aligned tabular figures, horizontal scroll inside its own wrapper. The
// 760px breakpoint is an arbitrary value (`max-[760px]:*`) rather than Tailwind's default `md` (768px) to match the
// exact breakpoint the legacy CSS used — this project's mobile/icon-rail breakpoints are deliberately exact values.
const { th: TH_BASE, td: TD_BASE, num: NUM, actions: ACTIONS, low: LOW } = tableClass;

export function DataTable<T>({ columns, rows, rowKey, onRowClick, empty, boxed, caption, loading, stickyHeader, rowClassName }: DataTableProps<T>) {
  if (loading && rows.length === 0) return <TableSkeleton />;
  if (rows.length === 0) {
    return <>{empty ?? <EmptyState title="Nothing here yet" variant="inline" />}</>;
  }
  const thCls = (c: Column<T>) => cx(TH_BASE, c.numeric && NUM, c.actions && ACTIONS, c.low && LOW);
  const tdCls = (c: Column<T>) => cx(TD_BASE, c.numeric && NUM, c.actions && ACTIONS, c.low && LOW);
  return (
    <div className={cx(tableClass.wrap, boxed && 'rounded-md border border-line bg-white', stickyHeader && 'max-h-[70vh] overflow-y-auto [&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-10')}>
      <table className={tableClass.table}>
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((c) => (
              <th className={thCls(c)} key={c.key} scope="col">
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              className={cx(tableClass.tr, onRowClick && 'cursor-pointer focus-visible:[outline-offset:-2px]', rowClassName?.(row))}
              key={rowKey(row, index)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={
                onRowClick
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onRowClick(row);
                      }
                    }
                  : undefined
              }
              tabIndex={onRowClick ? 0 : undefined}
            >
              {columns.map((c) => (
                <td className={tdCls(c)} key={c.key}>
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
