import { useState } from 'react';
import { CartView as CartViewModel } from '../../types/api';
import { formatSom } from '../../lib/format';
import { clearCart as clearCartRequest, clearCartReward, selectCartReward } from '../../lib/api/cart';
import { toUserMessage } from '../../lib/api/errors';
import { ErrorBanner } from '../../app/ErrorBanner';
import { EmptyState } from '../../app/EmptyState';
import { RewardPicker } from './RewardPicker';
import { CartSync, CartProductRef } from './cartSync';

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
    <div className="screen">
      <div className="top-bar">
        <button className="top-bar__back" onClick={onBack} type="button">
          ← Menyu
        </button>
      </div>

      <h1 className="display">Savat</h1>

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
          <ul className="cart-lines">
            {cart.items.map((item) => (
              <li className="cart-line" key={item.product.id}>
                <div>
                  <div className="cart-line__name">{item.product.name}</div>
                  <div className="cart-line__unit">{formatSom(item.product.priceMinor)}</div>
                </div>
                <div className="cart-line__total">{formatSom(item.lineTotalMinor)}</div>
                <div className="cart-line__controls">
                  <div className="qty-stepper">
                    <button aria-label="Kamaytirish" onClick={() => changeQuantity(item.product, -1)} type="button">
                      −
                    </button>
                    <span className="qty-stepper__value">{item.quantity}</span>
                    <button aria-label="Ko'paytirish" onClick={() => changeQuantity(item.product, 1)} type="button">
                      +
                    </button>
                  </div>
                  <button className="button-text" onClick={() => sync.setQuantity(item.product, 0)} type="button">
                    O'chirish
                  </button>
                </div>
              </li>
            ))}
          </ul>

          {cart.reward ? (
            <div className="reward-line">
              <div>
                <span className="reward-line__tag">Bonus</span>
                <div className="reward-line__name">{cart.reward.productName}</div>
                <div className="reward-line__program">{cart.reward.programName}</div>
              </div>
              <div className="reward-line__price">
                {formatSom(0)}
                <span className="reward-line__was">{formatSom(cart.reward.discountMinor)}</span>
              </div>
              <button className="button-text" disabled={isRemovingReward} onClick={handleRemoveReward} type="button">
                Bonusni olib tashlash
              </button>
            </div>
          ) : (
            <button className="button-secondary" onClick={() => setShowRewardPicker(true)} type="button">
              Bepul coffee tanlash
            </button>
          )}

          <button className="button-text" style={{ alignSelf: 'flex-start' }} disabled={isClearing} onClick={handleClear} type="button">
            Savatni tozalash
          </button>

          <div className="order-footer">
            <div className="summary__row">
              <span className="summary__label">Jami</span>
              <span className="summary__total">{formatSom(cart.totalMinor)}</span>
            </div>
            <button className="button-primary" disabled={isClearing || isSyncing} onClick={onCheckout} type="button">
              {isSyncing ? 'Saqlanmoqda...' : 'Buyurtma berish'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
