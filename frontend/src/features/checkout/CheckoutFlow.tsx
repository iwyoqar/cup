import { useRef, useState } from 'react';
import { CartView as CartViewModel } from '../../types/api';
import { formatSom } from '../../lib/format';
import { checkout } from '../../lib/api/orders';
import { fetchCart } from '../../lib/api/cart';
import { generateIdempotencyKey } from '../../lib/idempotency';
import { classifyCheckoutOutcome } from '../../lib/checkoutErrors';

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
      <div className="screen">
        <div className="top-bar">
          <button className="top-bar__back" onClick={onCancel} type="button">
            ← Savat
          </button>
        </div>
        <div className="empty empty--block">
          <p className="empty__title">Buyurtma holati</p>
          <p className="hint-text">{state.message}</p>
          <button className="button-primary" onClick={onCancel} type="button">
            Savatga qaytish
          </button>
        </div>
      </div>
    );
  }

  const isSubmitting = state.phase === 'submitting';

  return (
    <div className="screen">
      <div className="top-bar">
        <button className="top-bar__back" disabled={isSubmitting} onClick={onCancel} type="button">
          ← Savat
        </button>
      </div>

      <h1 className="display">Buyurtma</h1>

      <div className="checkout-block">
        <div className="eyebrow">Filial</div>
        <div className="checkout-block__value">{cart.branch?.name ?? ''}</div>
        {cart.branch?.address && <div className="hint-text">{cart.branch.address}</div>}
      </div>

      <div className="checkout-block">
        <div className="eyebrow">Buyurtma tarkibi</div>
        <ul className="receipt">
          {cart.items.map((item) => (
            <li className="receipt__line" key={item.product.id}>
              <span className="receipt__name">
                {item.product.name} <span className="receipt__qty">× {item.quantity}</span>
              </span>
              <span className="receipt__amount">{formatSom(item.lineTotalMinor)}</span>
            </li>
          ))}
          {cart.reward && (
            <li className="receipt__line receipt__line--bonus">
              <span className="receipt__name">
                {cart.reward.productName} <span className="receipt__qty">· Bonus</span>
              </span>
              <span className="receipt__amount">{formatSom(0)}</span>
            </li>
          )}
        </ul>
      </div>

      <div className="order-footer">
        <div className="summary__row">
          <span className="summary__label">Jami</span>
          <span className="summary__total">{formatSom(cart.totalMinor)}</span>
        </div>
        <button className="button-primary" disabled={isSubmitting} onClick={handleConfirm} type="button">
          {isSubmitting ? 'Buyurtma yuborilmoqda...' : 'Buyurtmani tasdiqlash'}
        </button>
      </div>
    </div>
  );
}
