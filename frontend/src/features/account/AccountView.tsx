import { useEffect, useState } from 'react';
import { CustomerProfile } from '../../types/api';
import { fetchMyProfile } from '../../lib/api/customers';
import { toUserMessage } from '../../lib/api/errors';
import { SectionSkeleton } from '../../app/SectionSkeleton';
import { OrderHistoryList } from './OrderHistoryList';
import { IdentitySection } from './IdentitySection';
import { LoyaltyHub } from './LoyaltyHub';
import { LoyaltyTransactionsList } from './LoyaltyTransactionsList';
import { PromotionsSection } from './PromotionsSection';
import { ReferralSection } from './ReferralSection';
import { RewardProgressSection } from './RewardProgressSection';

interface AccountViewProps {
  onOpenOrder: (orderId: string) => void;
  onBack: () => void;
}

// Phase 10: an editorial account page — profile, loyalty, rewards, promotions, orders — each with
// its own whitespace and a serif heading, instead of a dashboard of equal boxes.
export function AccountView({ onOpenOrder, onBack }: AccountViewProps) {
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  // Sub-navigation stays local to this screen (no new AppShell view/route) — the same
  // "internal sub-view state" pattern already used for this screen's order history, just for
  // loyalty transactions now.
  const [showLoyaltyTransactions, setShowLoyaltyTransactions] = useState(false);

  // Every hook call must happen unconditionally, before any early return (Rules of Hooks) —
  // this effect runs regardless of which sub-view is showing.
  useEffect(() => {
    let cancelled = false;
    fetchMyProfile()
      .then((fetched) => {
        if (!cancelled) setProfile(fetched);
      })
      .catch((err) => {
        if (!cancelled) setProfileError(toUserMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (showLoyaltyTransactions) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-[560px] flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
        <LoyaltyTransactionsList onBack={() => setShowLoyaltyTransactions(false)} />
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-[560px] flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <div className="flex flex-1 flex-col gap-6 px-4 pt-3 pb-8">
        <div className="-mx-4 flex min-h-11 items-center gap-2 px-4">
          <button className="min-h-11 cursor-pointer py-2.5 text-small font-semibold tracking-[0.02em] text-black" onClick={onBack} type="button">
            ← Menyu
          </button>
        </div>

        <section className="flex flex-col gap-3">
          <div className="text-micro font-bold tracking-[0.14em] text-muted uppercase">Hisobim</div>
          {profile ? (
            <div>
              <h1 className="font-display text-title leading-[1.1] font-medium">{profile.displayName ?? 'CUP Coffee'}</h1>
              {profile.phone && <p className="mt-1 text-small text-muted">{profile.phone}</p>}
              {profile.username && <p className="mt-1 text-small text-muted">@{profile.username}</p>}
            </div>
          ) : profileError ? (
            <p className="text-small leading-[1.45] text-muted">{profileError}</p>
          ) : (
            <SectionSkeleton height={64} />
          )}
        </section>

        <IdentitySection />

        <LoyaltyHub onOpenTransactions={() => setShowLoyaltyTransactions(true)} />

        <ReferralSection />

        <RewardProgressSection />

        <PromotionsSection />

        <section className="flex flex-col gap-3">
          <h2 className="font-display text-section leading-[1.2] font-medium">Mening buyurtmalarim</h2>
          <OrderHistoryList onOpenOrder={onOpenOrder} onGoToCatalog={onBack} />
        </section>
      </div>
    </div>
  );
}
