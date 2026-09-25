import { useEffect, useState } from 'react';
import { LoyaltyAccount } from '../../types/api';
import { fetchMyLoyalty } from '../../lib/api/loyalty';
import { toUserMessage } from '../../lib/api/errors';
import { getLoyaltyEarningCopy } from '../../lib/loyaltyCopy';
import { SectionSkeleton } from '../../app/SectionSkeleton';
import { buttonSecondary } from '../../app/buttonStyles';
import { cx } from '../../lib/cx';

interface LoyaltySectionProps {
  onOpenTransactions: () => void;
}

// Balance always comes from GET /loyalty — never a hardcoded/derived number (spec section 3).
// Prefers hiding the section entirely when loyalty is disabled (spec section 3's explicit
// preference) rather than showing a technical "disabled" state — there is no account balance
// to speak of, so showing a confusing "0 ball" would be misleading too.
export function LoyaltySection({ onOpenTransactions }: LoyaltySectionProps) {
  const [loyalty, setLoyalty] = useState<LoyaltyAccount | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchMyLoyalty()
      .then((fetched) => {
        if (!cancelled) setLoyalty(fetched);
      })
      .catch((err) => {
        if (!cancelled) setError(toUserMessage(err));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (isLoading) {
    return <SectionSkeleton height={148} />;
  }

  if (error) {
    return <p className="text-small leading-[1.45] text-muted">Ballar ma'lumotini yuklab bo'lmadi</p>;
  }

  if (!loyalty || !loyalty.enabled) {
    return null;
  }

  const earningCopy = getLoyaltyEarningCopy(loyalty);

  return (
    <section className="flex flex-col gap-3 rounded-lg bg-cream px-4 py-6">
      <div className="text-micro font-bold tracking-[0.14em] text-muted-cream uppercase">Ballaringiz</div>
      <div className="flex items-baseline gap-2">
        <span className="font-display text-[clamp(44px,14vw,60px)] leading-none font-medium tabular-nums">{loyalty.balance.toLocaleString('ru-RU')}</span>
        <span className="text-body font-semibold">ball</span>
      </div>
      {earningCopy && <p className="text-small leading-[1.45] text-muted-cream">{earningCopy}</p>}
      <button className={cx(buttonSecondary, 'self-start')} onClick={onOpenTransactions} type="button">
        Ballar tarixi
      </button>
    </section>
  );
}
