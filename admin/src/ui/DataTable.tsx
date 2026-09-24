import { ReactNode } from 'react';
import { cx } from './cx';
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
  rowKey: (row: T) => string;
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
}

// One table for the whole Admin (styles: `.table*` in ui/components.css, shared with raw tables in pages): quiet
// uppercase header, 48 px rows, subtle hover, right-aligned tabular figures, horizontal scroll inside its own wrapper.
export function DataTable<T>({ columns, rows, rowKey, onRowClick, empty, boxed, caption, loading, stickyHeader }: DataTableProps<T>) {
  if (loading && rows.length === 0) return <TableSkeleton />;
  if (rows.length === 0) {
    return <>{empty ?? <EmptyState title="Nothing here yet" variant="inline" />}</>;
  }
  const cls = (c: Column<T>) => cx(c.numeric && 'table__num', c.actions && 'table__actions', c.low && 'table__col--low') || undefined;
  return (
    <div className={cx('table-wrap', boxed && 'table-wrap--boxed', stickyHeader && 'table-wrap--sticky')}>
      <table className="table">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((c) => (
              <th className={cls(c)} key={c.key} scope="col">
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              className={onRowClick ? 'table__row--click' : undefined}
              key={rowKey(row)}
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
                <td className={cls(c)} key={c.key}>
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
