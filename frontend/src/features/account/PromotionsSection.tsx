import { useEffect, useState } from 'react';
import { CustomerPromotion } from '../../types/api';
import { fetchMyPromotions } from '../../lib/api/promotions';
import { toUserMessage } from '../../lib/api/errors';
import { formatSom, formatDateTime } from '../../lib/format';
import { EmptyState } from '../../app/EmptyState';
import { SectionSkeleton } from '../../app/SectionSkeleton';

// Phase 7's explicit "customer-facing visibility foundation, not a large UI" scope: read-only
// offers, no redemption action (checkout integration is deferred — see
// promotion-redemption.service.ts's module comment).
function describeBenefit(promotion: CustomerPromotion): string {
  switch (promotion.benefit.type) {
    case 'PERCENT_DISCOUNT':
      return `${promotion.benefit.value}% chegirma`;
    case 'FIXED_DISCOUNT':
      return `${formatSom(promotion.benefit.value ?? 0)} chegirma`;
    case 'FREE_PRODUCT':
      return `Bepul ${promotion.benefit.product?.name ?? 'mahsulot'} × ${promotion.benefit.quantity ?? 1}`;
    case 'LOYALTY_POINTS':
      return `+${promotion.benefit.value} ball`;
    default:
      return '';
  }
}

export function PromotionsSection() {
  const [promotions, setPromotions] = useState<CustomerPromotion[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchMyPromotions()
      .then((fetched) => {
        if (!cancelled) setPromotions(fetched);
      })
      .catch((err) => {
        if (!cancelled) setError(toUserMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-section leading-[1.2] font-medium">Aksiyalar</h2>

      {error ? (
        <p className="text-small leading-[1.45] text-muted">Ma'lumotni yuklab bo'lmadi</p>
      ) : !promotions ? (
        <SectionSkeleton height={120} />
      ) : promotions.length === 0 ? (
        <EmptyState variant="inline" title="Hozircha maxsus takliflar yo'q" />
      ) : (
        <div className="flex flex-col gap-3 rounded-lg bg-cream px-4 pt-3 pb-2">
          {promotions.map((promotion) => (
            <article className="flex flex-col gap-1 border-t border-line-strong pt-3 pb-4 first:border-t-0" key={promotion.id}>
              <div className="font-display text-section leading-[1.15] font-medium text-terracotta-deep">{describeBenefit(promotion)}</div>
              <div className="font-semibold">{promotion.name}</div>
              {promotion.description && <div className="text-small text-muted-cream">{promotion.description}</div>}
              {promotion.endsAt && <div className="text-small text-muted-cream">{formatDateTime(promotion.endsAt)} gacha</div>}
              {promotion.remainingUses !== null && (
                <div className="text-small text-muted-cream">Qolgan foydalanish: {promotion.remainingUses}</div>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
