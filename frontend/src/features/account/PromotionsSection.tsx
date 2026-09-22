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
    <section className="account-section">
      <h2 className="section-title">Aksiyalar</h2>

      {error ? (
        <p className="hint-text">Ma'lumotni yuklab bo'lmadi</p>
      ) : !promotions ? (
        <SectionSkeleton height={120} />
      ) : promotions.length === 0 ? (
        <EmptyState variant="inline" title="Hozircha maxsus takliflar yo'q" />
      ) : (
        <div className="cream-block" style={{ paddingTop: 'var(--space-3)', paddingBottom: 'var(--space-2)' }}>
          {promotions.map((promotion) => (
            <article className="offer" key={promotion.id}>
              <div className="offer__benefit">{describeBenefit(promotion)}</div>
              <div className="offer__name">{promotion.name}</div>
              {promotion.description && <div className="offer__fine">{promotion.description}</div>}
              {promotion.endsAt && <div className="offer__fine">{formatDateTime(promotion.endsAt)} gacha</div>}
              {promotion.remainingUses !== null && (
                <div className="offer__fine">Qolgan foydalanish: {promotion.remainingUses}</div>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
