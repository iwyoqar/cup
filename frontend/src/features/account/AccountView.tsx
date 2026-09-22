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
      <div className="app-shell">
        <LoyaltyTransactionsList onBack={() => setShowLoyaltyTransactions(false)} />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="screen">
        <div className="top-bar">
          <button className="top-bar__back" onClick={onBack} type="button">
            ← Menyu
          </button>
        </div>

        <section className="account-section">
          <div className="eyebrow">Hisobim</div>
          {profile ? (
            <div>
              <h1 className="profile__name">{profile.displayName ?? 'CUP Coffee'}</h1>
              {profile.phone && <p className="profile__meta">{profile.phone}</p>}
              {profile.username && <p className="profile__meta">@{profile.username}</p>}
            </div>
          ) : profileError ? (
            <p className="hint-text">{profileError}</p>
          ) : (
            <SectionSkeleton height={64} />
          )}
        </section>

        <IdentitySection />

        <LoyaltyHub onOpenTransactions={() => setShowLoyaltyTransactions(true)} />

        <ReferralSection />

        <RewardProgressSection />

        <PromotionsSection />

        <section className="account-section">
          <h2 className="section-title">Mening buyurtmalarim</h2>
          <OrderHistoryList onOpenOrder={onOpenOrder} onGoToCatalog={onBack} />
        </section>
      </div>
    </div>
  );
}
