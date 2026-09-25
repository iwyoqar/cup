import { SpotMappingReport } from '../lib/adminPosterImport';
import { Button, Column, DataTable, EmptyState, ErrorState, LoadingState, SectionCard, StatusBadge, cx } from '../ui';

const number = (n: number) => n.toLocaleString('ru-RU');
type Spot = SpotMappingReport['spots'][number];

interface SpotMappingCardProps {
  title: string;
  description?: string;
  mapping: SpotMappingReport | null;
  loading: boolean;
  error: string | null;
  onReload: () => void;
}

// Which Poster spot belongs to which CUP branch. Read-only: it reports; the mapping itself is created by the Poster spot sync. Used by BOTH POS Import (step 1
// of the staged import) and Branch Configuration, so the two can never disagree.
export function SpotMappingCard({ title, description, mapping, loading, error, onReload }: SpotMappingCardProps) {
  const columns: Column<Spot>[] = [
    { key: 'spot', header: 'Poster spot', cell: (s) => <span className="font-semibold text-black">#{s.posterSpotId}</span> },
    { key: 'name', header: 'Poster name', low: true, cell: (s) => s.posterName ?? '—' },
    {
      key: 'branch',
      header: 'CUP branch',
      cell: (s) => (
        <>
          {s.branch ? s.branch.name : '—'}
          {s.branch && !s.branch.isActive && <span className="mt-0.5 block text-xs font-normal text-muted">Branch is inactive</span>}
          {s.nameDiffers && <span className="mt-0.5 block text-xs font-normal text-muted">Name differs from Poster (the id mapping is what counts)</span>}
        </>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (s) =>
        s.status === 'MAPPED' ? (
          s.branch?.isActive ? (
            <StatusBadge tone="ok">Mapped</StatusBadge>
          ) : (
            <StatusBadge tone="warn">Mapped — branch inactive</StatusBadge>
          )
        ) : s.status === 'UNMAPPED_POSTER_SPOT' ? (
          <StatusBadge tone="warn">Unmapped Poster spot</StatusBadge>
        ) : (
          <StatusBadge tone="err">Duplicate mapping</StatusBadge>
        ),
    },
    { key: 'imported', header: 'Imported receipts', numeric: true, low: true, cell: (s) => number(s.importedTransactions) },
  ];

  return (
    <SectionCard
      actions={
        <Button disabled={loading} onClick={onReload} size="sm" variant="secondary">
          {loading ? 'Checking…' : 'Re-check'}
        </Button>
      }
      description={description}
      title={title}
    >
      {error && <ErrorState message={error} onRetry={onReload} title="The Poster spots could not be read" />}
      {!mapping && !error && <LoadingState variant="table" rows={3} />}
      {mapping && (
        <>
          <div className={cx('block space-y-1 rounded-md border-l-[3px] px-4 py-3 text-sm leading-relaxed [&_p]:m-0', mapping.importReady ? 'border-ok bg-ok-bg text-ok' : 'border-terracotta bg-cream-soft text-warn')}>
            {mapping.importReady ? 'Every Poster spot maps to exactly one active CUP branch.' : 'Some Poster spots are not ready: receipts from them will not be imported.'}
          </div>
          <DataTable boxed columns={columns} empty={<EmptyState text="Poster reported no spots." title="No spots" variant="inline" />} rowKey={(s) => String(s.posterSpotId)} rows={mapping.spots} />
          {mapping.unmappedBranches.length > 0 && (
            <div className="flex min-w-0 flex-col gap-2">
              <strong>CUP branches without a Poster spot</strong>
              {mapping.unmappedBranches.map((b) => (
                <div className="flex flex-wrap items-center gap-2 justify-between" key={b.id}>
                  <span>
                    {b.name} (spot #{b.posterSpotId}){b.isActive ? '' : ' — inactive'}
                  </span>
                  <span className="text-[13px] leading-snug text-muted">{number(b.orders)} orders</span>
                </div>
              ))}
            </div>
          )}
          {mapping.rules.length > 0 && (
            <ul className="text-[13px] leading-snug text-muted m-0 pl-4.5">
              {mapping.rules.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </SectionCard>
  );
}
