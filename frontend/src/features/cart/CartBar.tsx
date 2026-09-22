import { CartView } from '../../types/api';
import { formatSom } from '../../lib/format';

interface CartBarProps {
  cart: CartView;
  onOpen: () => void;
}

// Persistent bottom bar, only rendered when the cart has items (spec section 38). Black surface,
// one terracotta action. Reads the optimistic cart, so the count/total move on the tap itself.
export function CartBar({ cart, onOpen }: CartBarProps) {
  const itemCount = cart.items.reduce((sum, item) => sum + item.quantity, 0);
  if (itemCount === 0) {
    return null;
  }
  return (
    <button className="cart-bar" onClick={onOpen} type="button">
      <span className="cart-bar__info cart-bar__summary">
        <span className="cart-bar__count">{itemCount} ta mahsulot</span>
        <span className="cart-bar__total">{formatSom(cart.totalMinor)}</span>
      </span>
      <span className="cart-bar__cta">
        <span className="cart-bar__cta-long">Buyurtmani ko'rish</span>
        <span className="cart-bar__cta-short">Ko'rish</span>
      </span>
    </button>
  );
}
