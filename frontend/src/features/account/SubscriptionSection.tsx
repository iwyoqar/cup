import { useCallback, useEffect, useState } from 'react';
import { SubscriptionPlan, SubscriptionSummary, SubscriptionView } from '../../types/api';
import { cancelSubscriptionPurchase, fetchMySubscription, startSubscriptionPurchase } from '../../lib/api/subscriptions';
import { toUserMessage } from '../../lib/api/errors';
import { formatSom } from '../../lib/format';
import { SectionSkeleton } from '../../app/SectionSkeleton';
import { ErrorBanner } from '../../app/ErrorBanner';
import { buttonPrimary, buttonSecondary } from '../../app/buttonStyles';
import { cx } from '../../lib/cx';

const MONTHS = ['Yan', 'Fev', 'Mar', 'Apr', 'May', 'Iyun', 'Iyul', 'Avg', 'Sen', 'Okt', 'Noy', 'Dek'];

// A business date ("2026-10-26") as "26 Okt 2026". The date itself is the backend's (UTC+5 business day) — never recomputed here.
function businessDate(ymd: string | null): string {
  if (!ymd) return '—';
  const [y, m, d] = ymd.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

function clock(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function newKey(): string {
  try {
    if (crypto.randomUUID) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `sub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-black/10 py-2 first:border-t-0">
      <span className="text-small text-muted-cream">{label}</span>
      <span className="text-body font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function CurrentSubscription({ sub }: { sub: SubscriptionView }) {
  const u = sub.usage;
  const pct = u.totalPortions > 0 ? Math.round((u.remainingPortions / u.totalPortions) * 100) : 0;
  return (
    <div className="flex flex-col gap-3 rounded-lg bg-cream px-4 py-6">
      <div className="flex items-center justify-between gap-2">
        <span className="text-micro font-bold tracking-[0.14em] text-muted-cream uppercase">{sub.planName}</span>
        <span className="rounded-[4px] bg-black px-2 py-[3px] text-micro font-bold tracking-[0.14em] text-cream uppercase">{sub.effectiveStatus === 'ACTIVE' ? 'Faol' : sub.effectiveStatus}</span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="font-display text-[clamp(44px,14vw,60px)] leading-none font-medium tabular-nums">{u.remainingPortions}</span>
        <span className="text-body font-semibold">/ {u.totalPortions} porsiya qoldi</span>
      </div>
      <div className="h-2 overflow-hidden rounded-[2px] bg-track" role="img" aria-label={`${u.remainingPortions} / ${u.totalPortions}`}>
        <div className="h-full bg-terracotta transition-[width] duration-220 ease-cup" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex flex-col">
        <Row label="Bugun" value={`${u.todayUsedPortions} / ${u.dailyPortionLimit} porsiya`} />
        <Row label="Oxirgi kofe" value={clock(u.lastRedemptionAt)} />
        <Row label="Keyingi kofe" value={u.nextAvailableAt ? clock(u.nextAvailableAt) : u.todayRemainingPortions > 0 && u.remainingPortions > 0 ? 'Hozir mumkin' : '—'} />
        <Row label="Amal qiladi" value={`${businessDate(sub.endBusinessDate)} gacha`} />
      </div>
      <p className="text-small leading-[1.45] text-muted-cream">Kassada QR kodingizni ko‘rsating — barista abonementdan kofe beradi.</p>
    </div>
  );
}

function PlanList({ plans, busy, onChoose, renew }: { plans: SubscriptionPlan[]; busy: boolean; onChoose: (p: SubscriptionPlan) => void; renew: boolean }) {
  if (plans.length === 0) return <p className="text-small leading-[1.45] text-muted">Hozircha abonement rejalari yo‘q.</p>;
  return (
    <div className="flex flex-col gap-3">
      {plans.map((p) => (
        <div className="flex items-center justify-between gap-3 rounded-md border border-line bg-white p-4" key={p.id}>
          <div className="min-w-0">
            <div className="text-lead font-semibold">{p.name}</div>
            <div className="text-small text-muted">
              {p.durationDays} kun · {p.totalPortions} porsiya · kuniga {p.dailyPortionLimit}
            </div>
            <div className="mt-1 text-body font-semibold">{formatSom(p.priceMinor)}</div>
          </div>
          <button className={cx(buttonSecondary, 'shrink-0')} disabled={busy} onClick={() => onChoose(p)} type="button">
            {renew ? 'Uzaytirish' : 'Tanlash'}
          </button>
        </div>
      ))}
    </div>
  );
}

// Coffee Subscription on the account screen. Primary: status, plan, remaining, today, next available, expiry. Secondary: renew / plans.
// Buying only creates a purchase WAITING for payment — no payment provider is connected yet, so nothing is charged and nothing activates here.
export function SubscriptionSection() {
  const [data, setData] = useState<SubscriptionSummary | null>(null);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [choosing, setChoosing] = useState(false);

  const load = useCallback(() => {
    fetchMySubscription()
      .then((d) => {
        setData(d);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (failed) return null; // an optional section: never block the rest of the account screen
  if (!data) return <SectionSkeleton height={180} />;

  const renew = data.canRenew;
  const choose = async (plan: SubscriptionPlan) => {
    setBusy(true);
    setError(null);
    try {
      await startSubscriptionPurchase(plan.id, newKey(), renew);
      setChoosing(false);
      load();
    } catch (err) {
      setError(toUserMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const cancelPending = async () => {
    if (!data.pendingPurchase) return;
    setBusy(true);
    setError(null);
    try {
      await cancelSubscriptionPurchase(data.pendingPurchase.id);
      load();
    } catch (err) {
      setError(toUserMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-section leading-[1.2] font-medium">Coffee abonement</h2>
      <ErrorBanner message={error} onDismiss={() => setError(null)} />

      {data.current ? (
        <CurrentSubscription sub={data.current} />
      ) : (
        <p className="text-small leading-[1.45] text-muted">Faol abonement yo‘q.</p>
      )}

      {data.upcoming.map((u) => (
        <p className="text-small leading-[1.45] text-muted" key={u.id}>
          Keyingi abonement: <strong className="text-black">{u.planName}</strong> — {businessDate(u.startBusinessDate)} dan {businessDate(u.endBusinessDate)} gacha.
        </p>
      ))}

      {data.pendingPurchase ? (
        <div className="flex flex-col gap-2 rounded-sm border-l-[3px] border-terracotta bg-cream-soft px-3.5 py-3 text-small leading-[1.4]">
          <strong>
            To‘lov kutilmoqda: {data.pendingPurchase.planName} — {formatSom(data.pendingPurchase.amountMinor)}
          </strong>
          <span className="text-muted-cream">Onlayn to‘lov tez orada ishga tushadi. To‘lov tasdiqlangach abonement faollashadi{renew ? ' (joriy abonement tugagach boshlanadi)' : ''}.</span>
          <button className={cx(buttonSecondary, 'self-start')} disabled={busy} onClick={cancelPending} type="button">
            Bekor qilish
          </button>
        </div>
      ) : data.current || data.upcoming.length > 0 ? (
        choosing ? (
          <PlanList busy={busy} onChoose={choose} plans={data.plans} renew />
        ) : (
          <button className={cx(buttonPrimary, 'w-full')} onClick={() => setChoosing(true)} type="button">
            Uzaytirish
          </button>
        )
      ) : (
        <>
          <div className="text-micro font-bold tracking-[0.14em] text-muted uppercase">Mavjud rejalar</div>
          <PlanList busy={busy} onChoose={choose} plans={data.plans} renew={false} />
        </>
      )}

      <p className="text-micro leading-[1.45] text-muted">Avtomatik yangilanmaydi · To‘lov qaytarilmaydi · Ishlatilmagan porsiyalar muddat tugashi bilan yo‘qoladi.</p>
    </section>
  );
}
