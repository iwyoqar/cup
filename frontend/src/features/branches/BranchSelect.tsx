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
    <div className="screen">
      <div className="top-bar">
        {onCancel && (
          <button className="top-bar__back" onClick={onCancel} type="button">
            ← Orqaga
          </button>
        )}
      </div>
      <div>
        <div className="eyebrow">CUP Coffee</div>
        <h1 className="display" style={{ marginTop: 'var(--space-2)' }}>
          {title ?? 'Filialni tanlang'}
        </h1>
      </div>
      {branches.length === 0 ? (
        <EmptyState variant="inline" title="Hozircha faol filiallar mavjud emas" />
      ) : (
        <div className="branch-list">
          {branches.map((branch) => (
            <button
              key={branch.id}
              className="branch-card"
              disabled={isSubmitting}
              onClick={() => onSelect(branch)}
              type="button"
            >
              <div className="branch-card__name">{branch.name}</div>
              {branch.address && <div className="branch-card__address">{branch.address}</div>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
