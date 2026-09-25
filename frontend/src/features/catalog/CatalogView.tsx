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
      <div className="mx-auto flex min-h-dvh max-w-[560px] flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
        <CatalogSkeleton branchName={branchName} />
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-[560px] flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <header className="px-4 pt-2">
        <div className="flex min-h-11 items-center justify-between">
          <span className="font-display text-[20px] font-semibold tracking-[0.32em] after:ml-1 after:inline-block after:size-1.5 after:rounded-full after:bg-terracotta after:content-['']">CUP</span>
          <button className="-mr-2.5 inline-flex size-11 cursor-pointer items-center justify-center rounded-full [&_svg]:size-6 [&_svg]:fill-none [&_svg]:stroke-black [&_svg]:stroke-[1.6] [&_svg]:[stroke-linecap:round] [&_svg]:[stroke-linejoin:round]" aria-label="Hisobim" onClick={onOpenAccount} type="button">
            <IconUser />
          </button>
        </div>
        <button className="flex min-h-11 max-w-full cursor-pointer items-baseline gap-2 text-left" onClick={onChangeBranch} type="button">
          <span className="min-w-0 overflow-hidden text-small font-semibold text-ellipsis whitespace-nowrap text-muted">{branchName}</span>
          <span className="shrink-0 text-small font-semibold text-terracotta-deep underline underline-offset-3">O'zgartirish</span>
        </button>
        <h1 className="font-display text-display leading-[1.08] font-medium tracking-[-0.01em] mt-3">Bugun qanday coffee?</h1>
      </header>

      <CategoryTabs categories={catalog.categories} selectedCategoryId={selectedCategoryId} onSelect={setSelectedCategoryId} />

      {syncError && (
        <div className="px-4 pt-4">
          <ErrorBanner message={syncError} onDismiss={sync.dismissError} />
        </div>
      )}

      {visibleProducts.length === 0 ? (
        <div className="flex flex-1 flex-col gap-6 px-4 pt-3 pb-8">
          <EmptyState title="Menyu hozircha mavjud emas" message="Birozdan so'ng qayta urinib ko'ring." />
        </div>
      ) : (
        <div className="grid flex-1 grid-cols-2 content-start gap-x-3 gap-y-4 px-4 py-6">
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
