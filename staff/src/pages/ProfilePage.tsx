import { useCallback, useEffect, useState } from 'react';
import { ActivityCard, GrowthCard, HeaderCard, LoyaltyCard, PromotionsCard, ReferralCard, RewardsCard } from '../components/ProfileCards';
import { PosterSection } from '../components/PosterSection';
import { ApiError, toUserMessage } from '../lib/api';
import { goScan } from '../lib/route';
import { CustomerProfile, fetchProfile, Scope, StaffProfile } from '../lib/staffApi';

type State = { kind: 'loading' } | { kind: 'error'; status: number; message: string } | { kind: 'ready'; profile: CustomerProfile };

// The customer service console: ONE request (GET /staff/customers/by-code/:code/profile) fills every card. Read-only — nothing on this screen adds a
// point, a reward, a purchase or a referral; the only write anywhere near it is the existing, explicit Poster mapping.
export function ProfilePage({ code, staff, onSessionExpired }: { code: string; staff: StaffProfile; onSessionExpired: () => void }) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [scope, setScope] = useState<Scope | undefined>(undefined); // undefined = the server default (own branch when assigned)
  const [busy, setBusy] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [version, setVersion] = useState(0); // remounts the activity list after a refresh / scope change

  const load = useCallback(
    async (background: boolean) => {
      if (background) setBusy(true);
      else setState({ kind: 'loading' });
      setRefreshError(null);
      try {
        const profile = await fetchProfile(code, scope);
        setState({ kind: 'ready', profile });
        setVersion((v) => v + 1);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return onSessionExpired();
        // A failed background refresh keeps the profile that is already on screen and reports the problem next to a retry button.
        if (background) setRefreshError(toUserMessage(err));
        else setState({ kind: 'error', status: err instanceof ApiError ? err.status : 0, message: toUserMessage(err) });
      } finally {
        setBusy(false);
      }
    },
    [code, scope, onSessionExpired],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  if (state.kind === 'loading') {
    return (
      <div className="profile" aria-busy="true">
        <div className="skeleton skeleton--head" />
        <div className="skeleton" />
        <div className="skeleton" />
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div className="profile">
        <section className="block">
          <div className="eyebrow">Xatolik</div>
          <p className="error-text">{state.message}</p>
          <div className="actions">
            {state.status !== 404 && (
              <button className="button button--primary" onClick={() => void load(false)} type="button">
                Qayta urinish
              </button>
            )}
            <button className="button button--secondary" onClick={goScan} type="button">
              Skanerlashga qaytish
            </button>
          </div>
        </section>
      </div>
    );
  }

  const { profile } = state;
  const hasBranch = !!staff.branch;
  const viewingAll = profile.scope.kind === 'ALL';

  return (
    <div className="profile">
      <HeaderCard busy={busy} onRefresh={() => void load(true)} profile={profile} />

      {refreshError && (
        <div className="banner" role="alert">
          <span>{refreshError}</span>
          <button className="button button--secondary button--compact" onClick={() => void load(true)} type="button">
            Qayta urinish
          </button>
        </div>
      )}

      {hasBranch && (
        <div className="scopebar" role="group" aria-label="Filial ko‘rinishi">
          <button aria-pressed={!viewingAll} className={`scopebar__btn${!viewingAll ? ' scopebar__btn--on' : ''}`} onClick={() => setScope('branch')} type="button">
            Mening filialim
          </button>
          <button aria-pressed={viewingAll} className={`scopebar__btn${viewingAll ? ' scopebar__btn--on' : ''}`} onClick={() => setScope('all')} type="button">
            Barcha filiallar
          </button>
        </div>
      )}

      <div className="profile__grid">
        <RewardsCard rewards={profile.rewards} />
        <LoyaltyCard loyalty={profile.loyalty} />
        <PromotionsCard promotions={profile.promotions} />
        <GrowthCard growth={profile.growth} scope={profile.scope} />
        <ActivityCard code={profile.identity.publicCode} initial={profile.activity} key={version} scope={profile.scope} scopeChoice={scope} />
        <ReferralCard referral={profile.referral} />
      </div>

      <PosterSection onLinked={() => void load(true)} phoneLast4={profile.identity.phoneMasked ? profile.identity.phoneMasked.slice(-4) : null} publicCode={profile.identity.publicCode} state={profile.identity.poster.state} />

      <p className="footnote">
        Bu ekran faqat ma‘lumot beradi — ball, bonus, xarid yoki taklif qo‘shmaydi. Xaridlar Poster kassasida amalga oshiriladi; CUP buyurtmalari va Poster’dan import qilingan xaridlar hisobga olinadi.
      </p>

      <button className="button button--primary" onClick={goScan} type="button">
        Keyingi mijoz
      </button>
    </div>
  );
}
