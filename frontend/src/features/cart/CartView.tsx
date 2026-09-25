import { useState } from 'react';
import { CartView as CartViewModel } from '../../types/api';
import { formatSom } from '../../lib/format';
import { clearCart as clearCartRequest, clearCartReward, selectCartReward } from '../../lib/api/cart';
import { toUserMessage } from '../../lib/api/errors';
import { ErrorBanner } from '../../app/ErrorBanner';
import { EmptyState } from '../../app/EmptyState';
import { RewardPicker } from './RewardPicker';
import { CartSync, CartProductRef } from './cartSync';
import { buttonPrimary, buttonSecondary, buttonText } from '../../app/buttonStyles';
import { cx } from '../../lib/cx';

interface CartViewProps {
  cart: CartViewModel;
  sync: CartSync;
  /** True while any cart change is still on its way to / being confirmed by the backend. */
  isSyncing: boolean;
  syncError: string | null;
  onBack: () => void;
  onCheckout: () => void;
}

// Full cart screen: quantity controls, removal, clear, empty state (spec sections 22-27).
// Phase 9: quantity changes are optimistic (see cartSync.ts) — the row, line total and cart total
// update on the tap and the backend catches up in the background, so the steppers are never disabled.
// The displayed amounts are still only ever the backend's numbers (or, for the instant before the
// response lands, the same price x quantity the backend itself would compute); checkout is held back
// until nothing is pending so it always runs against the backend's cart.
export function CartView({ cart, sync, isSyncing, syncError, onBack, onCheckout }: CartViewProps) {
  const [error, setError] = useState<string | null>(null);
  const [isClearing, setIsClearing] = useState(false);
  const [showRewardPicker, setShowRewardPicker] = useState(false);
  const [isRemovingReward, setIsRemovingReward] = useState(false);

  // Reads the latest displayed quantity from the sync layer (not a render-time closure) so rapid
  // taps compound correctly.
  const changeQuantity = (product: CartProductRef, delta: number) => {
    const current = sync.getSnapshot().cart?.items.find((item) => item.product.id === product.id)?.quantity ?? 0;
    sync.setQuantity(product, current + delta);
  };

  const handleClear = async () => {
    setIsClearing(true);
    setError(null);
    sync.discardPending();
    try {
      await sync.exclusive(() => clearCartRequest());
    } catch (err) {
      setError(toUserMessage(err));
    } finally {
      setIsClearing(false);
    }
  };

  const handleRemoveReward = async () => {
    setIsRemovingReward(true);
    setError(null);
    try {
      await sync.exclusive(() => clearCartReward());
    } catch (err) {
      setError(toUserMessage(err));
    } finally {
      setIsRemovingReward(false);
    }
  };

  if (showRewardPicker) {
    return (
      <RewardPicker
        onClose={() => setShowRewardPicker(false)}
        selectReward={(rewardProgramId, productId) => sync.exclusive(() => selectCartReward(rewardProgramId, productId))}
        onSelected={() => setShowRewardPicker(false)}
      />
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-6 px-4 pt-3 pb-8">
      <div className="-mx-4 flex min-h-11 items-center gap-2 px-4">
        <button className="min-h-11 cursor-pointer py-2.5 text-small font-semibold tracking-[0.02em] text-black" onClick={onBack} type="button">
          ← Menyu
        </button>
      </div>

      <h1 className="font-display text-display leading-[1.08] font-medium tracking-[-0.01em]">Savat</h1>

      <ErrorBanner
        message={error ?? syncError}
        onDismiss={() => {
          setError(null);
          sync.dismissError();
        }}
      />

      {/* Phase 8.1: reward-only orders are rejected server-side (Poster zero-total is unverified),
          so a cart with no paid items is simply empty here even if a reward is still selected. */}
      {cart.items.length === 0 ? (
        <EmptyState
          title="Savat bo'sh"
          message="Sevimli coffeeingizni tanlang."
          actionLabel="Coffee tanlash"
          onAction={onBack}
        />
      ) : (
        <>
          <ul className="m-0 list-none p-0">
            {cart.items.map((item) => (
              <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 border-b border-line py-4 first:pt-0" key={item.product.id}>
                <div>
                  <div className="text-lead leading-[1.25] font-semibold">{item.product.name}</div>
                  <div className="mt-0.5 text-small text-muted">{formatSom(item.product.priceMinor)}</div>
                </div>
                <div className="text-right text-lead font-semibold whitespace-nowrap tabular-nums">{formatSom(item.lineTotalMinor)}</div>
                <div className="col-span-full flex items-center justify-between gap-3">
                  <div className="flex min-h-[47px] items-center justify-between overflow-hidden rounded-sm border-[1.5px] border-terracotta [&_button]:h-11 [&_button]:flex-[0_0_44px] [&_button]:cursor-pointer [&_button]:text-[22px] [&_button]:leading-none [&_button]:font-medium [&_button]:text-terracotta-deep [&_button]:transition-colors [&_button]:duration-120 [&_button]:ease-cup [&_button:active]:bg-cream w-[132px]">
                    <button aria-label="Kamaytirish" onClick={() => changeQuantity(item.product, -1)} type="button">
                      −
                    </button>
                    <span className="min-w-0 flex-1 text-center text-lead font-semibold tabular-nums">{item.quantity}</span>
                    <button aria-label="Ko'paytirish" onClick={() => changeQuantity(item.product, 1)} type="button">
                      +
                    </button>
                  </div>
                  <button className={cx(buttonText, 'text-muted')} onClick={() => sync.setQuantity(item.product, 0)} type="button">
                    O'chirish
                  </button>
                </div>
              </li>
            ))}
          </ul>

          {cart.reward ? (
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 rounded-md bg-cream p-4">
              <div>
                <span className="inline-block rounded-[4px] bg-black px-2 py-[3px] text-micro font-bold tracking-[0.14em] text-cream uppercase">Bonus</span>
                <div className="mt-2 text-body font-semibold">{cart.reward.productName}</div>
                <div className="text-small text-muted-cream">{cart.reward.programName}</div>
              </div>
              <div className="text-right text-lead font-bold whitespace-nowrap text-terracotta-deep">
                {formatSom(0)}
                <span className="block text-small font-medium text-muted-cream line-through">{formatSom(cart.reward.discountMinor)}</span>
              </div>
              <button className={cx(buttonText, 'col-span-full justify-self-start text-muted-cream')} disabled={isRemovingReward} onClick={handleRemoveReward} type="button">
                Bonusni olib tashlash
              </button>
            </div>
          ) : (
            <button className={buttonSecondary} onClick={() => setShowRewardPicker(true)} type="button">
              Bepul coffee tanlash
            </button>
          )}

          <button className={cx(buttonText, 'self-start text-muted')} disabled={isClearing} onClick={handleClear} type="button">
            Savatni tozalash
          </button>

          <div className="sticky bottom-0 -mx-4 mt-auto flex flex-col gap-3 border-t border-line bg-white px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-small font-bold tracking-[0.14em] text-muted uppercase">Jami</span>
              <span className="font-display text-title font-medium whitespace-nowrap tabular-nums">{formatSom(cart.totalMinor)}</span>
            </div>
            <button className={cx(buttonPrimary, 'w-full')} disabled={isClearing || isSyncing} onClick={onCheckout} type="button">
              {isSyncing ? 'Saqlanmoqda...' : 'Buyurtma berish'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
