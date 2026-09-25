import { memo } from 'react';
import { Product } from '../../types/api';
import { formatSom } from '../../lib/format';
import { CupLine } from '../../app/icons';

interface ProductCardProps {
  product: Product;
  quantityInCart: number;
  /** delta is +1 (add / increment) or -1 (decrement). Must be referentially stable across renders. */
  onChangeQuantity: (product: Product, delta: number) => void;
}

// No product image field exists in the current Product model/API (see catalog.repository.ts) —
// a deliberate cream tile with a line-drawn cup is used instead of inventing an image URL
// (spec section 20) or using emoji as fake product imagery (Phase 10).
//
// Phase 9: buttons are never disabled while the cart syncs — a tap updates the cart optimistically
// (see features/cart/cartSync.ts), so there is nothing to wait for. memo() keeps a tap on one card
// from re-rendering every other card: with stable props (the product object from the catalog
// snapshot, a primitive quantity, a stable callback) only the card whose quantity changed renders.
export const ProductCard = memo(function ProductCard({ product, quantityInCart, onChangeQuantity }: ProductCardProps) {
  return (
    <article className="flex min-w-0 flex-col overflow-hidden rounded-md border border-line bg-white">
      <div className="flex aspect-[4/3] items-center justify-center bg-cream [&_svg]:w-[44%] [&_svg]:fill-none [&_svg]:stroke-black [&_svg]:stroke-[1.6] [&_svg]:[stroke-linecap:round] [&_svg]:[stroke-linejoin:round] [&_svg]:max-w-[76px]">
        <CupLine />
      </div>
      <div className="flex flex-1 flex-col gap-1 px-3 pt-3">
        <h3 className="line-clamp-3 text-body leading-[1.25] font-semibold">{product.name}</h3>
        <div className="mt-auto pt-1 text-body font-medium text-black">{formatSom(product.priceMinor)}</div>
      </div>
      <div className="p-3">
        {quantityInCart > 0 ? (
          <div className="flex min-h-[47px] items-center justify-between overflow-hidden rounded-sm border-[1.5px] border-terracotta [&_button]:h-11 [&_button]:flex-[0_0_44px] [&_button]:cursor-pointer [&_button]:text-[22px] [&_button]:leading-none [&_button]:font-medium [&_button]:text-terracotta-deep [&_button]:transition-colors [&_button]:duration-120 [&_button]:ease-cup [&_button:active]:bg-cream">
            <button aria-label="Kamaytirish" onClick={() => onChangeQuantity(product, -1)} type="button">
              −
            </button>
            <span className="min-w-0 flex-1 text-center text-lead font-semibold tabular-nums">{quantityInCart}</span>
            <button aria-label="Ko'paytirish" onClick={() => onChangeQuantity(product, 1)} type="button">
              +
            </button>
          </div>
        ) : (
          <button className="min-h-11 w-full cursor-pointer rounded-sm bg-terracotta text-[13px] font-bold tracking-[0.06em] text-black uppercase transition-[transform,opacity] duration-120 ease-cup active:scale-[0.97] active:opacity-90" onClick={() => onChangeQuantity(product, 1)} type="button">
            Qo'shish
          </button>
        )}
      </div>
    </article>
  );
});
