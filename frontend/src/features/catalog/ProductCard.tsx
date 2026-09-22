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
    <article className="product-card">
      <div className="product-visual">
        <CupLine />
      </div>
      <div className="product-card__body">
        <h3 className="product-card__name">{product.name}</h3>
        <div className="product-card__price">{formatSom(product.priceMinor)}</div>
      </div>
      <div className="product-card__action">
        {quantityInCart > 0 ? (
          <div className="qty-stepper">
            <button aria-label="Kamaytirish" onClick={() => onChangeQuantity(product, -1)} type="button">
              −
            </button>
            <span className="qty-stepper__value">{quantityInCart}</span>
            <button aria-label="Ko'paytirish" onClick={() => onChangeQuantity(product, 1)} type="button">
              +
            </button>
          </div>
        ) : (
          <button className="add-button" onClick={() => onChangeQuantity(product, 1)} type="button">
            Qo'shish
          </button>
        )}
      </div>
    </article>
  );
});
