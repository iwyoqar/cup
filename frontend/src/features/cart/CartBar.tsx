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
    <button className="sticky bottom-0 mx-4 mb-[calc(12px+env(safe-area-inset-bottom))] flex min-h-15 w-[calc(100%-32px)] animate-cart-bar-in cursor-pointer items-center justify-between gap-3 rounded-md bg-black py-2 pr-2 pl-4 text-left text-white active:opacity-92" onClick={onOpen} type="button">
      <span className="flex min-w-0 flex-col">
        <span className="text-micro font-bold tracking-[0.1em] text-cream uppercase">{itemCount} ta mahsulot</span>
        <span className="text-lead font-semibold whitespace-nowrap tabular-nums">{formatSom(cart.totalMinor)}</span>
      </span>
      <span className="inline-flex min-h-11 shrink-0 items-center rounded-sm bg-terracotta px-4 text-[12px] font-bold tracking-[0.06em] text-black uppercase">
        <span className="max-[359px]:hidden">Buyurtmani ko'rish</span>
        <span className="hidden max-[359px]:inline">Ko'rish</span>
      </span>
    </button>
  );
}
