import { ReactNode } from 'react';
import { EmptyState } from './States';

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
}

// One table for the whole Admin: sticky-feeling header row, hairline separators, hover fill, right-aligned figures, and it scrolls sideways
// inside its own wrapper instead of stretching the page.
export function DataTable<T>({ columns, rows, rowKey, onRowClick, empty, boxed, caption }: DataTableProps<T>) {
  if (rows.length === 0) {
    return <>{empty ?? <EmptyState title="Nothing here yet" variant="inline" />}</>;
  }
  const cls = (c: Column<T>) => [c.numeric ? 'table__num' : '', c.actions ? 'table__actions' : '', c.low ? 'table__col--low' : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`table-wrap${boxed ? ' table-wrap--boxed' : ''}`}>
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
                      if (e.key === 'Enter') onRowClick(row);
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
