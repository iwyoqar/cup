import { Branch } from '../../types/api';
import { EmptyState } from '../../app/EmptyState';

interface BranchSelectProps {
  branches: Branch[];
  onSelect: (branch: Branch) => void;
  isSubmitting: boolean;
  title?: string;
  onCancel?: () => void;
}

// Only active branches are ever passed in (spec section 13 — inactive branches are filtered
// before this component ever sees them).
export function BranchSelect({ branches, onSelect, isSubmitting, title, onCancel }: BranchSelectProps) {
  return (
    <div className="flex flex-1 flex-col gap-6 px-4 pt-3 pb-8">
      <div className="-mx-4 flex min-h-11 items-center gap-2 px-4">
        {onCancel && (
          <button className="min-h-11 cursor-pointer py-2.5 text-small font-semibold tracking-[0.02em] text-black" onClick={onCancel} type="button">
            ← Orqaga
          </button>
        )}
      </div>
      <div>
        <div className="text-micro font-bold tracking-[0.14em] text-muted uppercase">CUP Coffee</div>
        <h1 className="mt-2 font-display text-display leading-[1.08] font-medium tracking-[-0.01em]">
          {title ?? 'Filialni tanlang'}
        </h1>
      </div>
      {branches.length === 0 ? (
        <EmptyState variant="inline" title="Hozircha faol filiallar mavjud emas" />
      ) : (
        <div className="flex flex-col gap-3">
          {branches.map((branch) => (
            <button
              key={branch.id}
              className="block min-h-11 w-full cursor-pointer rounded-md border border-line bg-white p-4 text-left transition-[border-color] duration-120 ease-cup active:border-black disabled:opacity-50"
              disabled={isSubmitting}
              onClick={() => onSelect(branch)}
              type="button"
            >
              <div className="text-lead font-semibold">{branch.name}</div>
              {branch.address && <div className="mt-0.5 text-small text-muted">{branch.address}</div>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
