import { useEffect, useState } from 'react';
import { CartView, CustomerRewardProgram, Product } from '../../types/api';
import { fetchProducts } from '../../lib/api/catalog';
import { fetchMyRewards } from '../../lib/api/rewards';
import { toUserMessage } from '../../lib/api/errors';
import { formatSom } from '../../lib/format';
import { ErrorBanner } from '../../app/ErrorBanner';
import { EmptyState } from '../../app/EmptyState';
import { SectionSkeleton } from '../../app/SectionSkeleton';
import { CupLine } from '../../app/icons';

interface RewardPickerProps {
  onClose: () => void;
  // Phase 9: the request itself is supplied by the caller so it runs through the cart sync queue
  // (strictly after any not-yet-confirmed quantity taps) and its response becomes the server cart.
  selectReward: (rewardProgramId: string, productId: string) => Promise<CartView>;
  onSelected: (cart: CartView) => void;
}

// Phase 8: the customer must EXPLICITLY choose which qualifying product receives the reward —
// never auto-selected (spec: "Do NOT automatically select the cheapest/most expensive
// product"). Only shows programs that currently have at least one available reward; the
// product list is filtered from the SAME catalog API the menu already uses, by the program's
// qualifyingCategoryId — never a duplicated/hardcoded product list. Internal ids are used only
// as keys/arguments, never rendered.
export function RewardPicker({ onClose, selectReward, onSelected }: RewardPickerProps) {
  const [programs, setPrograms] = useState<CustomerRewardProgram[] | null>(null);
  const [products, setProducts] = useState<Product[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectingProductId, setSelectingProductId] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchMyRewards(), fetchProducts()])
      .then(([fetchedPrograms, fetchedProducts]) => {
        setPrograms(fetchedPrograms.filter((p) => p.availableRewards > 0 && p.redeemable));
        setProducts(fetchedProducts);
      })
      .catch((err) => setError(toUserMessage(err)));
  }, []);

  const handleSelect = async (rewardProgramId: string, productId: string) => {
    setSelectingProductId(productId);
    setError(null);
    try {
      const cart = await selectReward(rewardProgramId, productId);
      onSelected(cart);
    } catch (err) {
      setError(toUserMessage(err));
      setSelectingProductId(null);
    }
  };

  // Only shown once GET /loyalty/rewards confirms an available reward — but qualifyingCategoryId
  // alone doesn't say WHICH program a product belongs to when several programs exist, so this
  // simple foundation UI shows one program at a time (the common case: one active "5+1" style
  // program). A future phase can generalize this to multiple concurrent programs if needed.
  const activeProgram = programs?.[0] ?? null;
  const qualifyingProducts = activeProgram ? (products ?? []).filter((p) => p.categoryId === activeProgram.qualifyingCategoryId && p.isActive) : [];

  return (
    <div className="screen reward-picker">
      <div className="top-bar">
        <button className="top-bar__back" onClick={onClose} type="button">
          ← Savat
        </button>
      </div>

      <div>
        <div className="eyebrow">Bonus</div>
        <h1 className="display" style={{ marginTop: 'var(--space-2)' }}>
          Bepul coffee tanlash
        </h1>
      </div>

      <ErrorBanner message={error} onDismiss={() => setError(null)} />

      {!programs || !products ? (
        error ? null : <SectionSkeleton height={160} />
      ) : !activeProgram ? (
        <EmptyState variant="inline" title="Bonus coffee hali mavjud emas" />
      ) : qualifyingProducts.length === 0 ? (
        <EmptyState variant="inline" title="Mos mahsulot topilmadi" />
      ) : (
        <div className="branch-list">
          {qualifyingProducts.map((product) => {
            const isSelected = selectingProductId === product.id;
            return (
              <button
                className={`reward-option${isSelected ? ' reward-option--selected' : ''}`}
                disabled={selectingProductId !== null}
                key={product.id}
                onClick={() => handleSelect(activeProgram.programId, product.id)}
                type="button"
              >
                <span className="reward-option__visual">
                  <CupLine />
                </span>
                <span className="reward-option__body">
                  <span className="reward-option__name">{product.name}</span>
                  <span className="reward-option__price" style={{ display: 'block' }}>
                    {formatSom(product.priceMinor)}
                  </span>
                </span>
                <span className="reward-option__state">{isSelected ? 'Tanlanmoqda' : 'Tanlash'}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
