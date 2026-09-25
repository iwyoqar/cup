import { useCallback, useEffect, useState } from 'react';
import { ActivityCard, GrowthCard, HeaderCard, LoyaltyCard, PromotionsCard, ReferralCard, RewardsCard } from '../components/ProfileCards';
import { PosterSection } from '../components/PosterSection';
import { ApiError, toUserMessage } from '../lib/api';
import { goScan } from '../lib/route';
import { CustomerProfile, fetchProfile, Scope, StaffProfile } from '../lib/staffApi';
import { Button } from '../components/ui';
import { cx } from '../lib/cx';

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
      <div className="mx-auto flex w-full max-w-[1000px] flex-col gap-3 px-4 pt-4 pb-8" aria-busy="true">
        <div className="h-[190px] animate-staff-pulse rounded-md bg-cream" />
        <div className="h-[140px] animate-staff-pulse rounded-md bg-skeleton" />
        <div className="h-[140px] animate-staff-pulse rounded-md bg-skeleton" />
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div className="mx-auto flex w-full max-w-[1000px] flex-col gap-3 px-4 pt-4 pb-8">
        <section className="flex flex-col gap-2 rounded-md border border-line p-4">
          <div className="text-[11px] font-bold tracking-[0.14em] text-muted uppercase">Xatolik</div>
          <p className="text-[14px] font-semibold text-terracotta-deep">{state.message}</p>
          <div className="flex flex-wrap gap-2.5">
            {state.status !== 404 && (
              <Button onClick={() => void load(false)} variant="primary">
                Qayta urinish
              </Button>
            )}
            <Button onClick={goScan} variant="secondary">
              Skanerlashga qaytish
            </Button>
          </div>
        </section>
      </div>
    );
  }

  const { profile } = state;
  const hasBranch = !!staff.branch;
  const viewingAll = profile.scope.kind === 'ALL';

  return (
    <div className="mx-auto flex w-full max-w-[1000px] flex-col gap-3 px-4 pt-4 pb-8">
      <HeaderCard busy={busy} onRefresh={() => void load(true)} profile={profile} />

      {refreshError && (
        <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-sm border-[1.5px] border-terracotta-deep px-3 py-2.5 font-semibold text-terracotta-deep" role="alert">
          <span>{refreshError}</span>
          <Button onClick={() => void load(true)} size="compact" variant="secondary">
            Qayta urinish
          </Button>
        </div>
      )}

      {hasBranch && (
        <div className="flex overflow-hidden rounded-sm border-[1.5px] border-black" role="group" aria-label="Filial ko‘rinishi">
          <button aria-pressed={!viewingAll} className={cx('font-[inherit] leading-[inherit] min-h-12 flex-1 cursor-pointer text-[14px] font-bold border-0', !viewingAll ? 'bg-black text-cream' : 'bg-white')} onClick={() => setScope('branch')} type="button">
            Mening filialim
          </button>
          <button aria-pressed={viewingAll} className={cx('font-[inherit] leading-[inherit] min-h-12 flex-1 cursor-pointer text-[14px] font-bold border-y-0 border-r-0 border-l-[1.5px] border-black', viewingAll ? 'bg-black text-cream' : 'bg-white')} onClick={() => setScope('all')} type="button">
            Barcha filiallar
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-3 min-[700px]:grid-cols-2">
        <RewardsCard rewards={profile.rewards} />
        <LoyaltyCard loyalty={profile.loyalty} />
        <PromotionsCard promotions={profile.promotions} />
        <GrowthCard growth={profile.growth} scope={profile.scope} />
        <ActivityCard code={profile.identity.publicCode} initial={profile.activity} key={version} scope={profile.scope} scopeChoice={scope} />
        <ReferralCard referral={profile.referral} />
      </div>

      <PosterSection onLinked={() => void load(true)} phoneLast4={profile.identity.phoneMasked ? profile.identity.phoneMasked.slice(-4) : null} publicCode={profile.identity.publicCode} state={profile.identity.poster.state} />

      <p className="text-[12px] leading-[1.5] text-muted">
        Bu ekran faqat ma‘lumot beradi — ball, bonus, xarid yoki taklif qo‘shmaydi. Xaridlar Poster kassasida amalga oshiriladi; CUP buyurtmalari va Poster’dan import qilingan xaridlar hisobga olinadi.
      </p>

      <Button onClick={goScan} variant="primary">
        Keyingi mijoz
      </Button>
    </div>
  );
}
