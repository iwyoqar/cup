import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Product, CartView as CartViewModel } from '../../types/api';
import { getCatalogSnapshot, refreshCatalogIfStale, subscribeToCatalog } from '../../lib/catalog/catalogCache';
import { toUserMessage } from '../../lib/api/errors';
import { CartSync } from '../cart/cartSync';
import { CategoryTabs } from './CategoryTabs';
import { ProductCard } from './ProductCard';
import { CatalogSkeleton } from './CatalogSkeleton';
import { CartBar } from '../cart/CartBar';
import { ErrorBanner } from '../../app/ErrorBanner';
import { StatusScreen } from '../../app/StatusScreen';
import { EmptyState } from '../../app/EmptyState';
import { IconUser } from '../../app/icons';

interface CatalogViewProps {
  branchName: string;
  cart: CartViewModel;
  sync: CartSync;
  syncError: string | null;
  onOpenCart: () => void;
  onChangeBranch: () => void;
  onOpenAccount: () => void;
}

export function CatalogView({ branchName, cart, sync, syncError, onOpenCart, onChangeBranch, onOpenAccount }: CatalogViewProps) {
  // Phase 9: the menu comes from a stale-while-revalidate cache (lib/catalog/catalogCache.ts), so
  // (re-)entering this view paints immediately from memory/localStorage instead of a spinner + two
  // requests every time; a stale copy is refreshed in the background and swapped in when it lands.
  const catalog = useSyncExternalStore(subscribeToCatalog, getCatalogSnapshot);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    refreshCatalogIfStale()?.catch((err) => {
      // A failed background refresh is silent when there is already a menu to show.
      if (!cancelled && !getCatalogSnapshot()) setLoadError(toUserMessage(err));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const quantityByProductId = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of cart.items) {
      map.set(item.product.id, item.quantity);
    }
    return map;
  }, [cart.items]);

  const visibleProducts = useMemo(() => {
    if (!catalog) return [];
    return selectedCategoryId ? catalog.products.filter((p) => p.categoryId === selectedCategoryId) : catalog.products;
  }, [catalog, selectedCategoryId]);

  // Stable identity (depends only on the long-lived CartSync) so memoized ProductCards are not
  // re-rendered by unrelated cart/state changes. Reads the LATEST displayed quantity from the sync
  // layer rather than a render-time closure, so back-to-back taps always compound correctly.
  const handleChangeQuantity = useCallback(
    (product: Product, delta: number) => {
      const current = sync.getSnapshot().cart?.items.find((item) => item.product.id === product.id)?.quantity ?? 0;
      sync.setQuantity({ id: product.id, name: product.name, priceMinor: product.priceMinor }, current + delta);
    },
    [sync],
  );

  if (!catalog && loadError) {
    return <StatusScreen title="Menyuni yuklab bo'lmadi" message={loadError} />;
  }

  if (!catalog) {
    return (
      <div className="app-shell">
        <CatalogSkeleton branchName={branchName} />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="masthead">
        <div className="masthead__bar">
          <span className="brand-mark">CUP</span>
          <button className="icon-button" aria-label="Hisobim" onClick={onOpenAccount} type="button">
            <IconUser />
          </button>
        </div>
        <button className="branch-line" onClick={onChangeBranch} type="button">
          <span className="branch-line__name">{branchName}</span>
          <span className="branch-line__change">O'zgartirish</span>
        </button>
        <h1 className="display masthead__title">Bugun qanday coffee?</h1>
      </header>

      <CategoryTabs categories={catalog.categories} selectedCategoryId={selectedCategoryId} onSelect={setSelectedCategoryId} />

      {syncError && (
        <div style={{ padding: 'var(--space-4) var(--gutter) 0' }}>
          <ErrorBanner message={syncError} onDismiss={sync.dismissError} />
        </div>
      )}

      {visibleProducts.length === 0 ? (
        <div className="screen">
          <EmptyState title="Menyu hozircha mavjud emas" message="Birozdan so'ng qayta urinib ko'ring." />
        </div>
      ) : (
        <div className="product-list">
          {visibleProducts.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              quantityInCart={quantityByProductId.get(product.id) ?? 0}
              onChangeQuantity={handleChangeQuantity}
            />
          ))}
        </div>
      )}

      <CartBar cart={cart} onOpen={onOpenCart} />
    </div>
  );
}
