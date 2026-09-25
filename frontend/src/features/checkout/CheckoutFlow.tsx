import { useRef, useState } from 'react';
import { CartView as CartViewModel } from '../../types/api';
import { formatSom } from '../../lib/format';
import { checkout } from '../../lib/api/orders';
import { fetchCart } from '../../lib/api/cart';
import { generateIdempotencyKey } from '../../lib/idempotency';
import { classifyCheckoutOutcome } from '../../lib/checkoutErrors';
import { buttonPrimary } from '../../app/buttonStyles';
import { cx } from '../../lib/cx';

interface CheckoutFlowProps {
  cart: CartViewModel;
  onCartUpdated: (cart: CartViewModel) => void;
  onOrderCreated: (orderId: string) => void;
  onCancel: () => void;
}

type CheckoutPhase = 'confirming' | 'submitting' | 'failed' | 'uncertain' | 'in_progress';

interface CheckoutState {
  phase: CheckoutPhase;
  message?: string;
}

// Owns the confirmation -> submit -> outcome state machine for exactly ONE checkout attempt
// (spec sections 5/6). The Idempotency-Key is generated once, lazily, on mount, and stays
// fixed for the lifetime of this component instance — it is never regenerated on failure,
// timeout, or uncertain outcome. A genuinely new attempt only happens if the customer cancels
// out and re-enters checkout from the cart screen, which mounts a fresh instance.
export function CheckoutFlow({ cart, onCartUpdated, onOrderCreated, onCancel }: CheckoutFlowProps) {
  const [idempotencyKey] = useState(generateIdempotencyKey);
  const [state, setState] = useState<CheckoutState>({ phase: 'confirming' });
  const isSubmittingRef = useRef(false);

  const handleConfirm = async () => {
    if (isSubmittingRef.current) {
      return;
    }
    isSubmittingRef.current = true;
    setState({ phase: 'submitting' });

    try {
      const result = await checkout(idempotencyKey);
      onOrderCreated(result.order.id);
      return;
    } catch (err) {
      const outcome = classifyCheckoutOutcome(err);
      if (outcome.kind === 'expired') {
        // Spec section 19: refresh the cart (backend is authoritative) rather than inventing a
        // separate frontend expiry mechanism, then show the message on this same screen.
        try {
          onCartUpdated(await fetchCart());
        } catch {
          // The cart screen will simply show whatever it already has — not worth compounding
          // errors here with a second failure message.
        }
        setState({ phase: 'failed', message: outcome.message });
        return;
      }
      setState({ phase: outcome.kind, message: outcome.message });
    } finally {
      isSubmittingRef.current = false;
    }
  };

  if (state.phase !== 'confirming' && state.phase !== 'submitting') {
    // 'failed' -> a fresh checkout attempt (new key) is safe. 'uncertain'/'in_progress' -> no
    // retry action is offered here on purpose (spec sections 6/7/17): the customer can only go
    // back; resolving an uncertain outcome is a manual-reconciliation concern, not something a
    // retry button should paper over.
    return (
      <div className="flex flex-1 flex-col gap-6 px-4 pt-3 pb-8">
        <div className="-mx-4 flex min-h-11 items-center gap-2 px-4">
          <button className="min-h-11 cursor-pointer py-2.5 text-small font-semibold tracking-[0.02em] text-black" onClick={onCancel} type="button">
            ← Savat
          </button>
        </div>
        <div className="flex flex-col items-start gap-3 rounded-lg bg-cream px-6 py-8">
          <p className="font-display text-title leading-[1.1] font-medium">Buyurtma holati</p>
          <p className="text-small leading-[1.45] text-muted-cream">{state.message}</p>
          <button className={cx(buttonPrimary, 'mt-2 w-auto')} onClick={onCancel} type="button">
            Savatga qaytish
          </button>
        </div>
      </div>
    );
  }

  const isSubmitting = state.phase === 'submitting';

  return (
    <div className="flex flex-1 flex-col gap-6 px-4 pt-3 pb-8">
      <div className="-mx-4 flex min-h-11 items-center gap-2 px-4">
        <button className="min-h-11 cursor-pointer py-2.5 text-small font-semibold tracking-[0.02em] text-black" disabled={isSubmitting} onClick={onCancel} type="button">
          ← Savat
        </button>
      </div>

      <h1 className="font-display text-display leading-[1.08] font-medium tracking-[-0.01em]">Buyurtma</h1>

      <div className="flex flex-col gap-2">
        <div className="text-micro font-bold tracking-[0.14em] text-muted uppercase">Filial</div>
        <div className="text-lead font-semibold">{cart.branch?.name ?? ''}</div>
        {cart.branch?.address && <div className="text-small leading-[1.45] text-muted">{cart.branch.address}</div>}
      </div>

      <div className="flex flex-col gap-2">
        <div className="text-micro font-bold tracking-[0.14em] text-muted uppercase">Buyurtma tarkibi</div>
        <ul className="m-0 list-none p-0">
          {cart.items.map((item) => (
            <li className="flex items-baseline justify-between gap-3 border-b border-line py-3" key={item.product.id}>
              <span className="min-w-0 font-medium">
                {item.product.name} <span className="font-medium text-muted">× {item.quantity}</span>
              </span>
              <span className="shrink-0 font-semibold tabular-nums">{formatSom(item.lineTotalMinor)}</span>
            </li>
          ))}
          {cart.reward && (
            <li className="flex items-baseline justify-between gap-3 border-b border-line py-3">
              <span className="min-w-0 font-medium">
                {cart.reward.productName} <span className="font-medium text-muted">· Bonus</span>
              </span>
              <span className="shrink-0 font-semibold text-terracotta-deep tabular-nums">{formatSom(0)}</span>
            </li>
          )}
        </ul>
      </div>

      <div className="sticky bottom-0 -mx-4 mt-auto flex flex-col gap-3 border-t border-line bg-white px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-small font-bold tracking-[0.14em] text-muted uppercase">Jami</span>
          <span className="font-display text-title font-medium whitespace-nowrap tabular-nums">{formatSom(cart.totalMinor)}</span>
        </div>
        <button className={cx(buttonPrimary, 'w-full')} disabled={isSubmitting} onClick={handleConfirm} type="button">
          {isSubmitting ? 'Buyurtma yuborilmoqda...' : 'Buyurtmani tasdiqlash'}
        </button>
      </div>
    </div>
  );
}
