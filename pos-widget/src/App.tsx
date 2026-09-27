import { useState } from 'react';
import {
  cancelPromotionRedeem,
  cancelRedeem,
  clearManual,
  closePromotionRedemption,
  closeRedemption,
  confirmPromotionRedeem,
  confirmRedeem,
  lookup,
  retry,
  scan,
  selectRewardProduct,
  startPromotionRedeem,
  startRedeem,
  useWidget,
  cancelSubscriptionRedeem,
  closeSubscriptionRedemption,
  confirmSubscriptionRedeem,
  selectSubscriptionProduct,
  startSubscriptionRedeem,
  subscriptionTarget,
  cancelCashSale,
  closeCashSale,
  confirmCashSale,
  startCashSale,
  cancelPosterPurchase,
  checkPosterPurchasePayment,
  closePosterPurchase,
  confirmPosterPurchase,
  startPosterPurchase,
} from './store';
import type { Phase } from './store';
import { cx } from './cx';
import type { EligibleRewardProduct, ErrorKind, Overview, PromotionRedemptionFailureReason, PromotionView, RedemptionFailureReason, RewardProgramView, SubscriptionSummary } from './types';

// Header status dot per widget phase — #4caf50 is the one "ready" green the widget uses (a colour Poster staff read at a glance).
const PHASE_DOT: Record<Phase, string> = {
  NO_POSTER: 'bg-terracotta',
  IDLE: 'bg-[#8b857c]',
  LOADING: 'bg-cream',
  READY: 'bg-ready',
  ERROR: 'bg-terracotta',
};

const formatSom = (n: number) => `${n.toLocaleString('ru-RU')} so'm`;

function lastVisitText(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return 'Bugun';
  if (days === 1) return 'Kecha';
  if (days < 7) return `${days} kun oldin`;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// The error a barista sees. Every one of them says the same important thing: Poster keeps working.
const ERROR_TEXT: Record<ErrorKind, { title: string; hint: string; retry: boolean }> = {
  TIMEOUT: { title: 'CUP javob bermadi', hint: 'Poster odatdagidek ishlashda davom etadi. Keyinroq qayta urinib ko‘ring.', retry: true },
  UNAVAILABLE: { title: 'CUP vaqtincha mavjud emas', hint: 'Poster odatdagidek ishlashda davom etadi. Sotuvni davom ettiring.', retry: true },
  UNAUTHORIZED: { title: 'CUP ruxsat bermadi', hint: 'Ulanish muddati tugagan yoki tasdiqlanmagan. Sotuvga ta’sir qilmaydi. Administratorga xabar bering.', retry: true },
  FORBIDDEN: { title: 'Bu kassa CUP ga ulanmagan', hint: 'Poster hisobi CUP sozlamasiga mos kelmadi. Sotuvga ta’sir qilmaydi.', retry: false },
  DISABLED: { title: 'CUP vidjeti o‘chirilgan', hint: 'Sotuvga ta’sir qilmaydi.', retry: true },
  NOT_CONFIGURED: { title: 'Vidjet sozlanmagan', hint: 'CUP manzili ko‘rsatilmagan. Sotuvga ta’sir qilmaydi.', retry: false },
  BAD_REQUEST: { title: 'So‘rov noto‘g‘ri', hint: 'Kodni yoki raqamni tekshirib, qayta kiriting.', retry: false },
  INVALID: { title: 'CUP javobi tushunarsiz', hint: 'Poster odatdagidek ishlashda davom etadi.', retry: true },
};

export function App() {
  const w = useWidget();
  return (
    <div className="flex h-[min(100vh,560px)] flex-col overflow-hidden bg-[#faf7f2]">
      <header className="flex items-center gap-2.5 bg-black px-3.5 py-2.5 text-white">
        <span className="font-extrabold tracking-[0.18em] text-cream">CUP</span>
        <span className="min-w-0 flex-1 overflow-hidden text-[15px] text-ellipsis whitespace-nowrap">{w.posterClient?.name ?? w.overview?.customer?.displayName ?? ''}</span>
        <span className={cx('size-2.5 rounded-full', PHASE_DOT[w.phase])} title={w.phase} />
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3.5 py-3 [-webkit-overflow-scrolling:touch]">
        {w.phase === 'NO_POSTER' && <Notice tone="warn" title="Poster konteksti topilmadi" hint="Vidjet Poster kassasi ichida ishga tushirilishi kerak. Poster ishiga ta’sir qilmaydi." />}
        {w.phase === 'IDLE' && <Idle />}
        {w.phase === 'LOADING' && <Loading />}
        {w.phase === 'ERROR' && w.error && <ErrorView kind={w.error} />}
        {w.phase === 'READY' && w.overview && w.subscriptionRedemption.phase !== 'idle' ? (
          <SubscriptionRedemptionFlow overview={w.overview} />
        ) : w.phase === 'READY' && w.overview && w.cashSale.phase !== 'idle' ? (
          <CashSaleFlow overview={w.overview} />
        ) : w.phase === 'READY' && w.overview && w.posterPurchase.phase !== 'idle' ? (
          <PosterPurchaseFlow overview={w.overview} />
        ) : w.phase === 'READY' && w.overview && w.redemption.phase !== 'idle' ? (
          <RedemptionFlow />
        ) : w.phase === 'READY' && w.overview && w.promotionRedemption.phase !== 'idle' ? (
          <PromotionRedemptionFlow />
        ) : (
          w.phase === 'READY' && w.overview && <Ready overview={w.overview} />
        )}
      </main>

      <footer className="flex justify-between gap-2 border-t border-line px-3.5 py-1.5 text-[11px] text-muted">
        <span>{w.employee ?? ''}</span>
        <span>{w.orderItems !== null ? `Buyurtma: ${w.orderItems} ta mahsulot` : ''}</span>
        <span className="overflow-hidden text-ellipsis whitespace-nowrap">{w.where}</span>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------- states

function Idle() {
  const w = useWidget();
  return (
    <div className="flex flex-col gap-2.5">
      <Notice tone="muted" title="Mijoz tanlanmagan" hint="Poster buyurtmasiga mijoz qo‘shilganda CUP ma’lumoti o‘zi chiqadi. Yoki quyida qidiring — bu buyurtmaga hech narsa qo‘shmaydi." />
      <Search />
      {w.inputError && <p className="m-0 text-[14px] font-semibold text-terracotta-deep">{w.inputError}</p>}
    </div>
  );
}

function Loading() {
  const w = useWidget();
  return (
    <div className="flex flex-col gap-2.5" aria-busy="true">
      <div className="rounded-xl border border-black bg-black px-3.5 py-3 text-white">
        <div className="text-[11px] font-bold tracking-[0.14em] text-cream uppercase">Mijoz</div>
        <div className="my-1 text-[24px] leading-[1.15] font-semibold [overflow-wrap:anywhere]">{w.posterClient?.name ?? 'Yuklanmoqda…'}</div>
        <div className="text-[14px] text-[#d9d3c8] [overflow-wrap:anywhere]">CUP ma’lumoti olinmoqda…</div>
      </div>
      <div className="h-[84px] animate-cw-pulse rounded-xl bg-[#ece6da]" />
      <div className="h-[52px] animate-cw-pulse rounded-xl bg-[#ece6da]" />
    </div>
  );
}

function ErrorView({ kind }: { kind: ErrorKind }) {
  const t = ERROR_TEXT[kind];
  return (
    <div className="flex flex-col gap-2.5">
      <Notice tone="warn" title={t.title} hint={t.hint} />
      <div className="flex flex-wrap gap-2">
        {t.retry && (
          <button className="min-h-12 cursor-pointer appearance-none rounded-[10px] px-5 font-[inherit] leading-[inherit] font-bold border-0 bg-terracotta text-black active:bg-terracotta-deep" onClick={retry} type="button">
            Qayta urinish
          </button>
        )}
        <button className="min-h-12 cursor-pointer appearance-none rounded-[10px] px-5 font-[inherit] leading-[inherit] font-bold border-[1.5px] border-black bg-transparent text-black active:bg-terracotta-deep" onClick={clearManual} type="button">
          Qidirish
        </button>
      </div>
    </div>
  );
}

function Ready({ overview }: { overview: Overview }) {
  const w = useWidget();
  if (overview.state === 'NOT_FOUND') {
    return (
      <div className="flex flex-col gap-2.5">
        <Notice tone="warn" title="Mijoz topilmadi" hint="Bu kod yoki raqam CUP da ro‘yxatdan o‘tmagan. Mijoz CUP ilovasida ro‘yxatdan o‘tishi kerak." />
        <Search />
      </div>
    );
  }
  if (overview.state === 'AMBIGUOUS') {
    return (
      <div className="flex flex-col gap-2.5">
        <Notice tone="warn" title="Bu raqamda bir nechta mijoz bor" hint="Adashmaslik uchun mijozning CUP kodini kiriting (CUP-XXXXXXXX)." />
        <Search />
      </div>
    );
  }
  if (overview.state === 'NOT_LINKED') {
    return (
      <div className="flex flex-col gap-2.5">
        <div className="rounded-xl border border-line bg-white px-3.5 py-3">
          <div className="text-[11px] font-bold tracking-[0.14em] text-muted uppercase">Poster mijozi</div>
          <div className="my-1 text-[24px] leading-[1.15] font-semibold [overflow-wrap:anywhere]">{w.posterClient?.name ?? '—'}</div>
          {w.posterClient?.phone && <div className="text-[14px] text-muted [overflow-wrap:anywhere]">{w.posterClient.phone}</div>}
        </div>
        <Notice tone="warn" title="CUP profili bog‘lanmagan" hint="Bu Poster mijozi CUP mijozi bilan bog‘lanmagan, shuning uchun bonus ko‘rsatilmaydi. Mijozdan CUP kodini so‘rab qidiring. Bog‘lash faqat Staff panelda qo‘lda amalga oshiriladi." />
        <Search />
      </div>
    );
  }
  return <Found overview={overview} />;
}

function Found({ overview }: { overview: Overview }) {
  const w = useWidget();
  const [details, setDetails] = useState(false);
  const c = overview.customer;
  const rewards = overview.rewards;
  const availableProgram = rewards?.programs.find((p) => p.available > 0) ?? null;
  const activity = overview.activity;
  return (
    <div className="flex flex-col gap-2.5">
      <div className="rounded-xl border border-black bg-black px-3.5 py-3 text-white">
        <div className="text-[11px] font-bold tracking-[0.14em] text-cream uppercase">CUP mijozi</div>
        <div className="my-1 text-[24px] leading-[1.15] font-semibold [overflow-wrap:anywhere]">{c?.displayName ?? 'Ismsiz mijoz'}</div>
        <div className="text-[14px] text-[#d9d3c8] [overflow-wrap:anywhere]">
          {c?.phoneMasked ?? '—'}
          {c?.code ? <span className="ml-2 inline-block rounded-full border border-white/30 bg-white/18 px-[9px] py-px text-[12px] font-semibold">{c.code}</span> : null}
          {!overview.linkedToPoster && <span className="ml-2 inline-block rounded-full border border-terracotta bg-terracotta px-[9px] py-px text-[12px] font-semibold text-white">Poster bilan bog‘lanmagan</span>}
        </div>
      </div>

      {overview.subscription !== undefined && <SubscriptionCard summary={overview.subscription ?? null} />}

      {availableProgram && rewards ? (
        <div className="rounded-xl border border-transparent bg-cream px-3.5 py-3" role="status">
          <div className="text-[11px] font-bold tracking-[0.14em] text-muted uppercase">Sovg‘a mavjud</div>
          <div className="mt-1 mb-2 text-[22px] font-bold">{rewards.availableTotal} ta bepul mahsulot mavjud</div>
          <Progress program={availableProgram} />
          <div className="flex flex-wrap gap-2">
            {/* Phase 22.2: ONE Poster order = max one redemption. w.redeemedOrderId === w.orderId means THIS order already used its one reward (either
                this click did, or the server already said so) — hide the button rather than let a cashier click into a guaranteed
                REWARD_ALREADY_REDEEMED_FOR_ORDER. This is UX only; the backend enforces the rule regardless of what the widget shows. */}
            {rewards.redemption.enabled && w.redeemedOrderId !== w.orderId && (
              <button
                className="min-h-12 cursor-pointer appearance-none rounded-[10px] px-5 font-[inherit] leading-[inherit] font-bold border-0 bg-terracotta text-black active:bg-terracotta-deep"
                onClick={() => startRedeem(availableProgram.programId, availableProgram.name, availableProgram.eligibleProducts)}
                type="button"
              >
                Sovg‘ani ishlatish
              </button>
            )}
            <button className="min-h-12 cursor-pointer appearance-none rounded-[10px] px-5 font-[inherit] leading-[inherit] font-bold border-[1.5px] border-black bg-transparent text-black active:bg-terracotta-deep" onClick={() => setDetails((v) => !v)} type="button" aria-expanded={details}>
              {details ? 'Yopish' : 'Batafsil'}
            </button>
          </div>
          {details && <RewardDetails programs={rewards.programs} />}
          {!rewards.redemption.enabled && <p className="mx-0 mt-2 mb-0 text-[12px] text-muted-cream">Bu yerda sovg‘a ishlatilmaydi. Hozircha faqat ko‘rsatiladi.</p>}
          {rewards.redemption.enabled && w.redeemedOrderId === w.orderId && <p className="mx-0 mt-2 mb-0 text-[12px] text-muted-cream">Bu buyurtma uchun sovg‘a allaqachon ishlatilgan.</p>}
        </div>
      ) : rewards && rewards.programs.length > 0 ? (
        <div className="rounded-xl border border-line bg-white px-3.5 py-3">
          <div className="text-[11px] font-bold tracking-[0.14em] text-muted uppercase">Sovg‘a</div>
          <div className="text-[14px] text-muted [overflow-wrap:anywhere]">Hozir mavjud sovg‘a yo‘q</div>
          {rewards.programs.map((p) => (
            <Progress key={p.name} program={p} />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-line bg-white px-3.5 py-3">
          <div className="text-[11px] font-bold tracking-[0.14em] text-muted uppercase">Sovg‘a</div>
          <div className="text-[14px] text-muted [overflow-wrap:anywhere]">Faol sovg‘a dasturi yo‘q</div>
        </div>
      )}

      <LoyaltyCard overview={overview} />
      <Promotions promotions={overview.promotions} redeemedOrderId={w.redeemedPromotionOrderId} orderId={w.orderId} />

      <div className="grid grid-cols-2 gap-x-3.5 gap-y-2.5 rounded-xl border border-line bg-white px-3.5 py-3">
        <div>
          <div className="text-[11px] font-bold tracking-[0.14em] text-muted uppercase">Tashriflar</div>
          <div className="mt-0.5 text-[19px] font-semibold [overflow-wrap:anywhere]">{activity ? activity.visits : 0}</div>
        </div>
        <div>
          <div className="text-[11px] font-bold tracking-[0.14em] text-muted uppercase">Oxirgi tashrif</div>
          <div className="mt-0.5 text-[19px] font-semibold [overflow-wrap:anywhere]">{activity && activity.visits > 0 ? lastVisitText(activity.lastVisitAt) : 'Tarix yo‘q'}</div>
        </div>
      </div>

      <button className="min-h-12 cursor-pointer appearance-none rounded-[10px] px-5 font-[inherit] leading-[inherit] font-bold border-[1.5px] border-black bg-transparent text-black active:bg-terracotta-deep" onClick={clearManual} type="button">
        Boshqa mijozni qidirish
      </button>
    </div>
  );
}

function Progress({ program }: { program: RewardProgramView }) {
  const pct = Math.min(100, Math.round((program.progress / Math.max(1, program.threshold)) * 100));
  return (
    <div className="my-1.5">
      <div className="flex justify-between gap-2 text-[14px]">
        <span>{program.name}</span>
        <strong>
          {program.progress} / {program.threshold}
        </strong>
      </div>
      <div className="mt-1 h-3 overflow-hidden rounded-[6px] bg-black/10 [&_span]:block [&_span]:h-full [&_span]:bg-terracotta">
        <span style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function RewardDetails({ programs }: { programs: RewardProgramView[] }) {
  return (
    <div className="mt-2 flex flex-col gap-2">
      {programs.map((p) => (
        <div key={p.name}>
          <strong>{p.name}</strong>
          <div className="text-[14px] text-muted [overflow-wrap:anywhere]">
            {p.available > 0 ? `${p.available} ta mavjud` : 'Mavjud emas'} · keyingisigacha {p.remaining} ta
          </div>
          {p.eligibleProducts.length > 0 && <div className="text-[14px] text-muted [overflow-wrap:anywhere]">Mahsulotlar: {p.eligibleProducts.map((x) => x.name).join(', ')}</div>}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------- reward redemption (Phase 22)

// A short, specific second line under the generic failed message — never exposes anything technical, matches the existing ERROR_TEXT tone.
const FAILURE_TEXT: Partial<Record<RedemptionFailureReason, string>> = {
  BLOCKED_NO_VERIFIED_POSTER_MUTATION: 'Bu funksiya hali yoqilmagan.',
  NO_REWARD_AVAILABLE: 'Sovg‘a endi mavjud emas.',
  PRODUCT_NOT_QUALIFYING: 'Bu mahsulot sovg‘a uchun mos emas.',
  PRODUCT_INACTIVE: 'Bu mahsulot endi faol emas.',
  PROGRAM_INACTIVE: 'Sovg‘a dasturi o‘chirilgan.',
  PROGRAM_EXPIRED: 'Sovg‘a dasturi muddati tugagan.',
  CONCURRENT_ATTEMPT_IN_PROGRESS: 'Boshqa urinish davom etmoqda.',
  CUSTOMER_NOT_FOUND: 'Mijoz topilmadi.',
  REWARD_ALREADY_REDEEMED_FOR_ORDER: 'Bu buyurtma uchun sovg‘a allaqachon ishlatilgan.',
};

function RedemptionFlow() {
  const w = useWidget();
  const r = w.redemption;
  return (
    <div className="flex flex-col gap-2.5">
      {r.phase === 'selecting' && <RewardProductPicker products={r.products} />}
      {r.phase === 'confirming' && r.selected && <RedeemConfirm product={r.selected} />}
      {r.phase === 'applying' && <RedeemApplying />}
      {r.phase === 'done' && <RedeemDone />}
    </div>
  );
}

function RewardProductPicker({ products }: { products: EligibleRewardProduct[] }) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="rounded-xl border border-line bg-white px-3.5 py-3">
        <div className="text-[11px] font-bold tracking-[0.14em] text-muted uppercase">Sovg‘a</div>
        <div className="my-1 text-[24px] leading-[1.15] font-semibold [overflow-wrap:anywhere]">Mahsulotni tanlang</div>
      </div>
      {products.map((p) => (
        <button className="min-h-12 cursor-pointer appearance-none rounded-[10px] px-5 font-[inherit] leading-[inherit] font-bold border-[1.5px] border-black bg-transparent text-black active:bg-terracotta-deep" key={p.posterProductId} onClick={() => selectRewardProduct(p)} type="button">
          {p.name}
        </button>
      ))}
      <button className="min-h-12 cursor-pointer appearance-none rounded-[10px] px-5 font-[inherit] leading-[inherit] font-bold border-[1.5px] border-black bg-transparent text-black active:bg-terracotta-deep" onClick={cancelRedeem} type="button">
        Bekor qilish
      </button>
    </div>
  );
}

function RedeemConfirm({ product }: { product: EligibleRewardProduct }) {
  return (
    <div className="rounded-xl border border-transparent bg-cream px-3.5 py-3">
      <div className="text-[11px] font-bold tracking-[0.14em] text-muted uppercase">Sovg‘ani ishlatish?</div>
      <div className="my-1 text-[24px] leading-[1.15] font-semibold [overflow-wrap:anywhere]">{product.name}</div>
      <div className="mt-1 mb-2 text-[22px] font-bold">Mijoz uchun: BEPUL</div>
      <div className="flex flex-wrap gap-2">
        <button className="min-h-12 cursor-pointer appearance-none rounded-[10px] px-5 font-[inherit] leading-[inherit] font-bold border-[1.5px] border-black bg-transparent text-black active:bg-terracotta-deep" onClick={cancelRedeem} type="button">
          Bekor qilish
        </button>
        <button className="min-h-12 cursor-pointer appearance-none rounded-[10px] px-5 font-[inherit] leading-[inherit] font-bold border-0 bg-terracotta text-black active:bg-terracotta-deep" onClick={confirmRedeem} type="button">
          Tasdiqlash
        </button>
      </div>
    </div>
  );
}

function RedeemApplying() {
  return (
    <div className="flex flex-col gap-2.5" aria-busy="true">
      <div className="rounded-xl border border-black bg-black px-3.5 py-3 text-white">
        <div className="text-[11px] font-bold tracking-[0.14em] text-cream uppercase">Sovg‘a</div>
        <div className="my-1 text-[24px] leading-[1.15] font-semibold [overflow-wrap:anywhere]">Sovg‘a qo‘llanmoqda…</div>
      </div>
      <div className="h-[52px] animate-cw-pulse rounded-xl bg-[#ece6da]" />
    </div>
  );
}

function RedeemDone() {
  const w = useWidget();
  const r = w.redemption;

  if (r.transportError) {
    return (
      <div className="flex flex-col gap-2.5">
        <Notice tone="warn" title="Sovg‘ani qo‘llab bo‘lmadi." hint="Buyurtma o‘zgartirilmadi." />
        <button className="min-h-12 cursor-pointer appearance-none rounded-[10px] px-5 font-[inherit] leading-[inherit] font-bold border-0 bg-terracotta text-black active:bg-terracotta-deep" onClick={closeRedemption} type="button">
          Yopish
        </button>
      </div>
    );
  }

  const status = r.result?.status;
  if (status === 'REDEEMED') {
    return (
      <div className="flex flex-col gap-2.5">
        <div className="rounded-xl border border-transparent bg-cream px-3.5 py-3" role="status">
          <div className="text-[11px] font-bold tracking-[0.14em] text-muted uppercase">✓ Sovg‘a qo‘llandi</div>
          <div className="my-1 text-[24px] leading-[1.15] font-semibold [overflow-wrap:anywhere]">{r.result?.productName ?? ''}</div>
        </div>
        <button className="min-h-12 cursor-pointer appearance-none rounded-[10px] px-5 font-[inherit] leading-[inherit] font-bold border-0 bg-terracotta text-black active:bg-terracotta-deep" onClick={closeRedemption} type="button">
          Yopish
        </button>
      </div>
    );
  }

  if (status === 'UNKNOWN') {
    return (
      <div className="flex flex-col gap-2.5">
        <Notice tone="warn" title="Buyurtma holatini aniqlab bo‘lmadi." hint="Sovg‘ani qayta bosmang." />
        <button className="min-h-12 cursor-pointer appearance-none rounded-[10px] px-5 font-[inherit] leading-[inherit] font-bold border-0 bg-terracotta text-black active:bg-terracotta-deep" onClick={closeRedemption} type="button">
          Yopish
        </button>
      </div>
    );
  }

  // FAILED, or any other non-success status — same generic message either way, plus a specific line when one is known.
  const reason = r.result?.failureReason ?? null;
  return (
    <div className="flex flex-col gap-2.5">
      <Notice tone="warn" title="Sovg‘ani qo‘llab bo‘lmadi." hint="Buyurtma o‘zgartirilmadi." />
      {reason && FAILURE_TEXT[reason] && <p className="mx-0 mt-2 mb-0 text-[12px] text-muted-cream">{FAILURE_TEXT[reason]}</p>}
      <button className="min-h-12 cursor-pointer appearance-none rounded-[10px] px-5 font-[inherit] leading-[inherit] font-bold border-0 bg-terracotta text-black active:bg-terracotta-deep" onClick={closeRedemption} type="button">
        Yopish
      </button>
    </div>
  );
}

function LoyaltyCard({ overview }: { overview: Overview }) {
  const l = overview.loyalty;
  if (!l) return null;
  const p2 = l.program2;
  return (
    <div className="grid grid-cols-2 gap-x-3.5 gap-y-2.5 rounded-xl border border-line bg-white px-3.5 py-3">
      {p2.enabled ? (
        <>
          <div>
            <div className="text-[11px] font-bold tracking-[0.14em] text-muted uppercase">Daraja</div>
            <div className="mt-0.5 text-[19px] font-semibold [overflow-wrap:anywhere]">{p2.level ? `${p2.level.icon} ${p2.level.name}` : '—'}</div>
          </div>
          <div>
            <div className="text-[11px] font-bold tracking-[0.14em] text-muted uppercase">Cashback</div>
            <div className="mt-0.5 text-[19px] font-semibold [overflow-wrap:anywhere]">{p2.cashbackMinor !== null ? formatSom(p2.cashbackMinor) : '—'}</div>
          </div>
          <div>
            <div className="text-[11px] font-bold tracking-[0.14em] text-muted uppercase">XP</div>
            <div className="mt-0.5 text-[19px] font-semibold [overflow-wrap:anywhere]">{p2.xp.total.toLocaleString('ru-RU')}</div>
          </div>
          <div>
            <div className="text-[11px] font-bold tracking-[0.14em] text-muted uppercase">Ketma-ket kunlar</div>
            <div className="mt-0.5 text-[19px] font-semibold [overflow-wrap:anywhere]">{p2.streak.enabled ? p2.streak.current : '—'}</div>
          </div>
        </>
      ) : null}
      {l.legacyProgramEnabled && (
        <div>
          <div className="text-[11px] font-bold tracking-[0.14em] text-muted uppercase">Ballar</div>
          <div className="mt-0.5 text-[19px] font-semibold [overflow-wrap:anywhere]">{l.points !== null ? l.points.toLocaleString('ru-RU') : 0}</div>
        </div>
      )}
      {!p2.enabled && !l.legacyProgramEnabled && <div className="text-[14px] text-muted [overflow-wrap:anywhere]">Sodiqlik dasturi yoqilmagan</div>}
    </div>
  );
}

function benefitText(p: PromotionView): string {
  const b = p.benefit;
  if (b.type === 'PERCENT_DISCOUNT' && b.value !== null) return `${b.value}% chegirma`;
  if (b.type === 'FIXED_DISCOUNT' && b.value !== null) return `${formatSom(b.value)} chegirma`;
  if (b.type === 'FREE_PRODUCT') return `Bepul: ${b.product?.name ?? 'mahsulot'}${b.quantity && b.quantity > 1 ? ` × ${b.quantity}` : ''}`;
  if (b.type === 'LOYALTY_POINTS' && b.value !== null) return `${b.value} ball`;
  return p.description ?? '';
}

// Phase 23 — Poster mutation is verified-safe only for FREE_PRODUCT and LOYALTY_POINTS (docs/PHASE-23-PROMOTIONS.md); PERCENT_DISCOUNT/FIXED_DISCOUNT
// have no known Poster mechanism and would always resolve BLOCKED_NO_VERIFIED_POSTER_MUTATION if clicked. The button is hidden for those two types
// specifically (not just gated by the flag) so the widget never invites a click that is guaranteed to fail — server-side enforcement is unchanged
// either way (this is UX only, same caution as the reward button).
const POSTER_MUTATABLE_BENEFIT_TYPES = new Set(['FREE_PRODUCT', 'LOYALTY_POINTS']);

function Promotions({ promotions, redeemedOrderId, orderId }: { promotions: Overview['promotions']; redeemedOrderId: number | null; orderId: number | null }) {
  const { items, redemption } = promotions;
  const alreadyUsedThisOrder = redemption.enabled && redeemedOrderId === orderId;
  return (
    <div className="rounded-xl border border-line bg-white px-3.5 py-3">
      <div className="text-[11px] font-bold tracking-[0.14em] text-muted uppercase">Promolar</div>
      {items.length === 0 ? (
        <div className="text-[14px] text-muted [overflow-wrap:anywhere]">Hozircha aksiya yo‘q</div>
      ) : (
        <ul className="mx-0 mt-1.5 mb-0 flex list-none flex-col gap-1.5 p-0 [&_li]:flex [&_li]:flex-col">
          {items.map((p) => (
            <li key={p.promotionId}>
              <strong>{p.name}</strong>
              <span className="text-[14px] text-muted [overflow-wrap:anywhere]">{benefitText(p)}</span>
              {redemption.enabled && !alreadyUsedThisOrder && POSTER_MUTATABLE_BENEFIT_TYPES.has(p.benefit.type) && (
                <button className="min-h-12 cursor-pointer appearance-none rounded-[10px] px-5 font-[inherit] leading-[inherit] font-bold border-[1.5px] border-black bg-transparent text-black active:bg-terracotta-deep" onClick={() => startPromotionRedeem(p.promotionId, p.name)} type="button">
                  Qo‘llash
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!redemption.enabled && items.length > 0 && <p className="mx-0 mt-2 mb-0 text-[12px] text-muted-cream">Bu yerda aksiya qo‘llanmaydi. Hozircha faqat ko‘rsatiladi.</p>}
      {alreadyUsedThisOrder && <p className="mx-0 mt-2 mb-0 text-[12px] text-muted-cream">Bu buyurtma uchun aksiya allaqachon qo‘llangan.</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------- promotion redemption (Phase 23)

const PROMOTION_FAILURE_TEXT: Partial<Record<PromotionRedemptionFailureReason, string>> = {
  BLOCKED_NO_VERIFIED_POSTER_MUTATION: 'Bu funksiya hali yoqilmagan.',
  PROMOTION_INACTIVE: 'Aksiya o‘chirilgan.',
  PROMOTION_NOT_STARTED: 'Aksiya hali boshlanmagan.',
  PROMOTION_EXPIRED: 'Aksiya muddati tugagan.',
  SEGMENT_MISMATCH: 'Bu mijoz uchun aksiya mavjud emas.',
  USAGE_LIMIT_REACHED: 'Aksiyadan foydalanish chegarasiga yetdi.',
  CONCURRENT_ATTEMPT_IN_PROGRESS: 'Boshqa urinish davom etmoqda.',
  CUSTOMER_NOT_FOUND: 'Mijoz topilmadi.',
  PROMOTION_ALREADY_REDEEMED_FOR_ORDER: 'Bu buyurtma uchun aksiya allaqachon qo‘llangan.',
};

function PromotionRedemptionFlow() {
  const w = useWidget();
  const r = w.promotionRedemption;
  return (
    <div className="flex flex-col gap-2.5">
      {r.phase === 'confirming' && r.promotionName && <PromotionRedeemConfirm name={r.promotionName} />}
      {r.phase === 'applying' && <PromotionRedeemApplying />}
      {r.phase === 'done' && <PromotionRedeemDone />}
    </div>
  );
}

function PromotionRedeemConfirm({ name }: { name: string }) {
  return (
    <div className="rounded-xl border border-transparent bg-cream px-3.5 py-3">
      <div className="text-[11px] font-bold tracking-[0.14em] text-muted uppercase">Bu aksiyani ushbu buyurtmaga qo‘llaysizmi?</div>
      <div className="my-1 text-[24px] leading-[1.15] font-semibold [overflow-wrap:anywhere]">{name}</div>
      <div className="flex flex-wrap gap-2">
        <button className="min-h-12 cursor-pointer appearance-none rounded-[10px] px-5 font-[inherit] leading-[inherit] font-bold border-[1.5px] border-black bg-transparent text-black active:bg-terracotta-deep" onClick={cancelPromotionRedeem} type="button">
          Bekor qilish
        </button>
        <button className="min-h-12 cursor-pointer appearance-none rounded-[10px] px-5 font-[inherit] leading-[inherit] font-bold border-0 bg-terracotta text-black active:bg-terracotta-deep" onClick={confirmPromotionRedeem} type="button">
          Tasdiqlash
        </button>
      </div>
    </div>
  );
}

function PromotionRedeemApplying() {
  return (
    <div className="flex flex-col gap-2.5" aria-busy="true">
      <div className="rounded-xl border border-black bg-black px-3.5 py-3 text-white">
        <div className="text-[11px] font-bold tracking-[0.14em] text-cream uppercase">Aksiya</div>
        <div className="my-1 text-[24px] leading-[1.15] font-semibold [overflow-wrap:anywhere]">Qo‘llanmoqda…</div>
      </div>
      <div className="h-[52px] animate-cw-pulse rounded-xl bg-[#ece6da]" />
    </div>
  );
}

function PromotionRedeemDone() {
  const w = useWidget();
  const r = w.promotionRedemption;

  if (r.transportError) {
    return (
      <div className="flex flex-col gap-2.5">
        <Notice tone="warn" title="Aksiyani qo‘llab bo‘lmadi." hint="Buyurtma o‘zgartirilmadi." />
        <button className="min-h-12 cursor-pointer appearance-none rounded-[10px] px-5 font-[inherit] leading-[inherit] font-bold border-0 bg-terracotta text-black active:bg-terracotta-deep" onClick={closePromotionRedemption} type="button">
          Yopish
        </button>
      </div>
    );
  }

  const status = r.result?.status;
  if (status === 'REDEEMED') {
    return (
      <div className="flex flex-col gap-2.5">
        <div className="rounded-xl border border-transparent bg-cream px-3.5 py-3" role="status">
          <div className="text-[11px] font-bold tracking-[0.14em] text-muted uppercase">✓ Aksiya qo‘llandi</div>
          <div className="my-1 text-[24px] leading-[1.15] font-semibold [overflow-wrap:anywhere]">{r.result?.promotionName ?? ''}</div>
        </div>
        <button className="min-h-12 cursor-pointer appearance-none rounded-[10px] px-5 font-[inherit] leading-[inherit] font-bold border-0 bg-terracotta text-black active:bg-terracotta-deep" onClick={closePromotionRedemption} type="button">
          Yopish
        </button>
      </div>
    );
  }

  if (status === 'UNKNOWN') {
    return (
      <div className="flex flex-col gap-2.5">
        <Notice tone="warn" title="Natija aniqlanmadi." hint="Qayta bosmang." />
        <button className="min-h-12 cursor-pointer appearance-none rounded-[10px] px-5 font-[inherit] leading-[inherit] font-bold border-0 bg-terracotta text-black active:bg-terracotta-deep" onClick={closePromotionRedemption} type="button">
          Yopish
        </button>
      </div>
    );
  }

  const reason = r.result?.failureReason ?? null;
  return (
    <div className="flex flex-col gap-2.5">
      <Notice tone="warn" title="Aksiyani qo‘llab bo‘lmadi." hint="Buyurtma o‘zgartirilmadi." />
      {reason && PROMOTION_FAILURE_TEXT[reason] && <p className="mx-0 mt-2 mb-0 text-[12px] text-muted-cream">{PROMOTION_FAILURE_TEXT[reason]}</p>}
      <button className="min-h-12 cursor-pointer appearance-none rounded-[10px] px-5 font-[inherit] leading-[inherit] font-bold border-0 bg-terracotta text-black active:bg-terracotta-deep" onClick={closePromotionRedemption} type="button">
        Yopish
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------- pieces

function Search() {
  const w = useWidget();
  const [text, setText] = useState('');
  return (
    <form
      className="flex flex-wrap gap-2 [&_input]:min-h-12 [&_input]:min-w-0 [&_input]:flex-[1_1_200px] [&_input]:rounded-[10px] [&_input]:border-[1.5px] [&_input]:border-black [&_input]:bg-white [&_input]:px-3.5 [&_input]:[font:inherit]"
      onSubmit={(e) => {
        e.preventDefault();
        lookup(text);
      }}
    >
      <input aria-label="CUP kodi yoki telefon" autoComplete="off" inputMode="text" maxLength={64} onChange={(e) => setText(e.target.value)} placeholder="CUP-XXXXXXXX yoki +998…" value={text} />
      <button className="min-h-12 cursor-pointer appearance-none rounded-[10px] px-5 font-[inherit] leading-[inherit] font-bold border-0 bg-terracotta text-black active:bg-terracotta-deep" type="submit">
        Qidirish
      </button>
      {w.mobile && (
        <button className="min-h-12 cursor-pointer appearance-none rounded-[10px] px-5 font-[inherit] leading-[inherit] font-bold border-[1.5px] border-black bg-transparent text-black active:bg-terracotta-deep" onClick={scan} type="button">
          QR skaner
        </button>
      )}
    </form>
  );
}

function Notice({ tone, title, hint }: { tone: 'warn' | 'muted'; title: string; hint: string }) {
  return (
    <div className={cx('rounded-xl px-3.5 py-3', tone === 'warn' ? 'border border-l-4 border-transparent border-l-terracotta bg-cream' : 'border border-line bg-white')} role={tone === 'warn' ? 'alert' : 'status'}>
      <div className="mb-0.5 font-bold">{title}</div>
      <div className="text-[14px] text-muted [overflow-wrap:anywhere]">{hint}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------- Coffee Subscription

const BTN = 'min-h-12 cursor-pointer appearance-none rounded-[10px] px-5 font-[inherit] leading-[inherit] font-bold';
const BTN_PRIMARY = `${BTN} border-0 bg-terracotta text-black active:bg-terracotta-deep disabled:cursor-not-allowed disabled:opacity-45`;
const BTN_GHOST = `${BTN} border-[1.5px] border-black bg-transparent text-black active:bg-terracotta-deep`;
const LABEL = 'text-[11px] font-bold tracking-[0.14em] text-muted uppercase';

function minutesUntil(iso: string | null): number {
  if (!iso) return 0;
  return Math.max(1, Math.ceil((new Date(iso).getTime() - Date.now()) / 60_000));
}

function timeText(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function dateText(ymd: string | null): string {
  if (!ymd) return '—';
  const [y, m, d] = ymd.split('-');
  return `${d}.${m}.${y}`;
}

// Why the button is disabled, in the barista's words. The reason codes come from the backend; this only phrases them.
function subscriptionReasonText(reason: string | null, s: SubscriptionSummary): string | null {
  const c = s.current;
  switch (reason) {
    case null:
      return null;
    case 'NO_ACTIVE_SUBSCRIPTION':
      return 'Faol abonement yo‘q';
    case 'SUBSCRIPTION_PENDING_PAYMENT':
      return 'Abonement to‘lovi hali tasdiqlanmagan';
    case 'SUBSCRIPTION_NOT_STARTED':
      return s.upcoming[0] ? `Abonement ${dateText(s.upcoming[0].startBusinessDate)} dan boshlanadi` : 'Abonement hali boshlanmagan';
    case 'SUBSCRIPTION_EXPIRED':
      return 'Abonement muddati tugagan';
    case 'SUBSCRIPTION_PAUSED':
      return 'Abonement to‘xtatilgan';
    case 'SUBSCRIPTION_CANCELLED':
      return 'Abonement bekor qilingan';
    case 'NO_REMAINING_PORTIONS':
      return 'Abonementda porsiya qolmagan';
    case 'DAILY_LIMIT_REACHED':
      return `Bugungi ${c?.dailyPortionLimit ?? ''} porsiya limiti tugagan`;
    case 'COOLDOWN_ACTIVE':
      return `Keyingi kofeni ${minutesUntil(c?.nextAvailableAt ?? null)} daqiqadan keyin olishingiz mumkin`;
    case 'PRODUCT_NOT_ALLOWED':
      return 'Bu ichimlik abonementga kirmaydi';
    case 'PRODUCT_INACTIVE':
      return 'Bu ichimlik hozir sotuvda emas';
    case 'CUSTOMER_MISMATCH':
      return 'Ochiq buyurtma boshqa mijozga tegishli';
    case 'REDEMPTION_CONFLICT':
      return 'Boshqa so‘rov hali tugallanmagan — birozdan so‘ng qayta urinib ko‘ring';
    case 'ALREADY_REDEEMED_FOR_ORDER':
      return 'Bu buyurtmada abonement kofesi allaqachon berilgan';
    case 'POSTER_TRANSACTION_UNAVAILABLE':
      return 'Ochiq buyurtmani tasdiqlab bo‘lmadi — buyurtma o‘zgartirilmadi';
    case 'POSTER_MUTATION_FAILED':
      return 'Poster ichimlikni qo‘shmadi — buyurtma o‘zgartirilmadi';
    default:
      return 'Hozir abonementdan foydalanib bo‘lmaydi';
  }
}

// Coffee Subscription cash sale — the plan list shown when the customer has nothing usable to redeem, or (below the active card) to pre-sell a
// renewal. Never shown at all when the feature is off or no plan is configured — the same guard the redemption button already applies to itself.
function SubscriptionCashSalePanel({ summary }: { summary: SubscriptionSummary }) {
  if (!summary.cashSale.enabled || summary.plans.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <div className={LABEL}>{summary.current ? 'Yangi obuna sotish (naqd)' : 'Coffee abonement sotish'}</div>
      {summary.plans.map((p) => (
        <button className={cx(BTN_GHOST, 'flex items-center justify-between gap-2 text-left')} key={p.id} onClick={() => startCashSale(p)} type="button">
          <span className="flex flex-col">
            <span className="text-[15px] font-semibold">{p.name}</span>
            <span className="text-[12px] text-muted">
              {p.durationDays} kun · {p.totalPortions} porsiya
            </span>
          </span>
          <span className="flex flex-col items-end shrink-0">
            <span className="text-[15px] font-bold whitespace-nowrap">{formatSom(p.priceMinor)}</span>
            <span className="text-[11px] font-bold whitespace-nowrap text-terracotta-deep">Naqdga sotish</span>
          </span>
        </button>
      ))}
    </div>
  );
}

// Coffee Subscription real Poster order purchase — the plan list, shown next to the cash-sale panel. A plan with no (or no longer active)
// Poster product mapping is still listed, per its own required message, rather than silently hidden (an admin can fix the mapping without
// the cashier wondering why a plan disappeared). Needs a real open order (subscriptionTarget()) — this feature adds a line to an order.
function SubscriptionPosterPurchasePanel({ summary }: { summary: SubscriptionSummary }) {
  if (!summary.posterPurchase.enabled || summary.plans.length === 0) return null;
  const target = subscriptionTarget();
  return (
    <div className="flex flex-col gap-1.5">
      <div className={LABEL}>Poster orqali sotish</div>
      {!target && <p className="m-0 text-[12px] text-muted">Avval Poster buyurtmasini oching.</p>}
      {summary.plans.map((p) => {
        const mapped = !!p.posterProduct && p.posterProduct.isActive;
        return (
          <button className={cx(BTN_GHOST, 'flex items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:opacity-45')} disabled={!mapped || !target} key={p.id} onClick={() => startPosterPurchase(p)} type="button">
            <span className="flex flex-col">
              <span className="text-[15px] font-semibold">{p.name}</span>
              <span className="text-[12px] text-muted">{mapped ? `${p.durationDays} kun · ${p.totalPortions} porsiya` : 'Bu abonement mahsuloti Poster‘da mavjud emas yoki faol emas.'}</span>
            </span>
            <span className="flex shrink-0 flex-col items-end">
              <span className="text-[15px] font-bold whitespace-nowrap">{formatSom(p.priceMinor)}</span>
              {mapped && <span className="text-[11px] font-bold whitespace-nowrap text-terracotta-deep">Poster orqali sotish</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function SubscriptionCard({ summary }: { summary: SubscriptionSummary | null }) {
  const w = useWidget();
  if (!summary) return null;
  const c = summary.current;
  if (!c) {
    const reason = subscriptionReasonText(summary.blockedReason, summary);
    return (
      <div className="flex flex-col gap-2.5">
        <div className="rounded-xl border border-line bg-white px-3.5 py-3">
          <div className={LABEL}>Coffee abonement</div>
          <div className="text-[14px] text-muted [overflow-wrap:anywhere]">{reason}</div>
        </div>
        <SubscriptionCashSalePanel summary={summary} />
        <SubscriptionPosterPurchasePanel summary={summary} />
      </div>
    );
  }
  const target = subscriptionTarget();
  const orderUsed = w.redeemedSubscriptionOrderId !== null && w.redeemedSubscriptionOrderId === w.orderId;
  const disabledReason = !summary.redemption.enabled
    ? 'Bu yerda abonement kofesi hali berilmaydi (o‘chirilgan).'
    : orderUsed
      ? subscriptionReasonText('ALREADY_REDEEMED_FOR_ORDER', summary)
      : !target
        ? 'Avval Poster buyurtmasini oching'
        : summary.blockedReason
          ? subscriptionReasonText(summary.blockedReason, summary)
          : summary.products.every((p) => !p.eligible)
            ? summary.products.length === 0
              ? 'Abonement uchun ichimliklar sozlanmagan'
              : subscriptionReasonText(summary.products[0]?.reason ?? null, summary)
            : null;
  return (
    <div className="flex flex-col gap-2.5">
      <div className="rounded-xl border border-transparent bg-cream px-3.5 py-3" role="status">
        <div className="flex items-baseline justify-between gap-2">
          <div className={LABEL}>Coffee abonement</div>
          <span className="rounded-full bg-black px-2 py-px text-[11px] font-bold text-cream">{c.status === 'ACTIVE' ? 'FAOL' : c.status}</span>
        </div>
        <div className="mt-1 text-[22px] font-bold">{c.planName}</div>
        <div className="mt-2 grid grid-cols-2 gap-x-3.5 gap-y-2">
          <Fact label="Qolgan porsiya" value={`${c.remainingPortions} / ${c.totalPortions}`} />
          <Fact label="Bugun" value={`${c.todayUsedPortions} / ${c.dailyPortionLimit}`} />
          <Fact label="Oxirgi kofe" value={timeText(c.lastRedemptionAt)} />
          <Fact label="Keyingisi" value={c.nextAvailableAt ? timeText(c.nextAvailableAt) : 'Hozir'} />
          <Fact label="Muddati" value={dateText(c.endBusinessDate)} />
          <Fact label="Kunlik qoldiq" value={`${c.todayRemainingPortions} porsiya`} />
        </div>
        <div className="mt-2.5 flex flex-col gap-1.5">
          <button className={BTN_PRIMARY} disabled={disabledReason !== null} onClick={startSubscriptionRedeem} type="button">
            Obuna kofe olish
          </button>
          {disabledReason && <p className="m-0 text-[13px] font-semibold text-terracotta-deep">{disabledReason}</p>}
        </div>
      </div>
      <SubscriptionCashSalePanel summary={summary} />
      <SubscriptionPosterPurchasePanel summary={summary} />
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-bold tracking-[0.12em] text-muted-cream uppercase">{label}</div>
      <div className="text-[17px] font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function SubscriptionRedemptionFlow({ overview }: { overview: Overview }) {
  const w = useWidget();
  const r = w.subscriptionRedemption;
  const summary = overview.subscription ?? null;
  if (r.phase === 'applying') {
    return (
      <div className="flex flex-col gap-2.5" aria-busy="true">
        <div className="rounded-xl border border-black bg-black px-3.5 py-3 text-white">
          <div className="text-[11px] font-bold tracking-[0.14em] text-cream uppercase">Coffee abonement</div>
          <div className="my-1 text-[24px] leading-[1.15] font-semibold">Qo‘shilmoqda…</div>
        </div>
        <div className="h-[52px] animate-cw-pulse rounded-xl bg-[#ece6da]" />
      </div>
    );
  }
  if (r.phase === 'done') return <SubscriptionDone overview={overview} />;
  if (!summary || !summary.current) {
    return (
      <div className="flex flex-col gap-2.5">
        <Notice tone="warn" title="Faol abonement yo‘q" hint="Buyurtma o‘zgartirilmadi." />
        <button className={BTN_GHOST} onClick={cancelSubscriptionRedeem} type="button">Orqaga</button>
      </div>
    );
  }
  if (r.phase === 'confirming' && r.selected) {
    const p = r.selected;
    const after = summary.current.remainingPortions - p.portionCost;
    return (
      <div className="rounded-xl border border-transparent bg-cream px-3.5 py-3">
        <div className={LABEL}>Tasdiqlang</div>
        <div className="my-1 text-[24px] leading-[1.15] font-semibold [overflow-wrap:anywhere]">{p.name}</div>
        <div className="grid grid-cols-2 gap-x-3.5 gap-y-2">
          <Fact label="Mijoz" value={overview.customer?.displayName ?? '—'} />
          <Fact label="Porsiya" value={`−${p.portionCost}`} />
          <Fact label="Keyin qoladi" value={`${after} / ${summary.current.totalPortions}`} />
          <Fact label="Filial" value={w.where || '—'} />
        </div>
        <p className="mx-0 mt-2 mb-0 text-[12px] text-muted-cream">Ichimlik buyurtmaga 0 so‘m narxda qo‘shiladi.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button className={BTN_GHOST} onClick={cancelSubscriptionRedeem} type="button">Bekor qilish</button>
          <button className={BTN_PRIMARY} onClick={confirmSubscriptionRedeem} type="button">Tasdiqlash</button>
        </div>
      </div>
    );
  }
  const groups = [
    { title: 'Standart', items: summary.products.filter((p) => p.portionCost === 1) },
    { title: 'Double', items: summary.products.filter((p) => p.portionCost > 1) },
  ].filter((g) => g.items.length > 0);
  return (
    <div className="flex flex-col gap-2.5">
      <div className="rounded-xl border border-line bg-white px-3.5 py-3">
        <div className={LABEL}>Coffee abonement</div>
        <div className="my-1 text-[22px] leading-[1.15] font-semibold">Ichimlikni tanlang</div>
        <div className="text-[14px] text-muted">
          Qolgan: {summary.current.remainingPortions} · Bugun: {summary.current.todayRemainingPortions} porsiya
        </div>
      </div>
      {groups.map((g) => (
        <div className="flex flex-col gap-1.5" key={g.title}>
          <div className={LABEL}>{g.title}</div>
          {g.items.map((p) => (
            <button className={cx(BTN_GHOST, 'flex items-center justify-between text-left disabled:cursor-not-allowed disabled:opacity-45')} disabled={!p.eligible} key={p.posterProductId} onClick={() => selectSubscriptionProduct(p)} type="button">
              <span>{p.name}</span>
              <span className="text-[13px] font-semibold text-muted">{p.eligible ? `${p.portionCost} porsiya` : subscriptionReasonText(p.reason, summary)}</span>
            </button>
          ))}
        </div>
      ))}
      <button className={BTN_GHOST} onClick={cancelSubscriptionRedeem} type="button">Bekor qilish</button>
    </div>
  );
}

function SubscriptionDone({ overview }: { overview: Overview }) {
  const w = useWidget();
  const r = w.subscriptionRedemption;
  const summary = overview.subscription ?? null;
  const close = (
    <button className={BTN_PRIMARY} onClick={closeSubscriptionRedemption} type="button">
      Yopish
    </button>
  );
  if (r.transportError) {
    return (
      <div className="flex flex-col gap-2.5">
        <Notice tone="warn" title="So‘rovni yuborib bo‘lmadi." hint="Buyurtma holatini Poster ekranida tekshiring. Qayta bosishdan oldin mijoz kartasini yangilang." />
        {close}
      </div>
    );
  }
  const res = r.result;
  if (res?.status === 'CONFIRMED') {
    return (
      <div className="flex flex-col gap-2.5">
        <div className="rounded-xl border border-transparent bg-cream px-3.5 py-3" role="status">
          <div className={LABEL}>✓ Coffee berildi</div>
          <div className="my-1 text-[24px] leading-[1.15] font-semibold [overflow-wrap:anywhere]">{res.productName ?? ''}</div>
          <div className="grid grid-cols-2 gap-x-3.5 gap-y-2">
            <Fact label="Porsiya" value={`−${res.portionCost ?? ''}`} />
            <Fact label="Qolgan" value={res.after ? `${res.after.remainingPortions} / ${res.after.totalPortions}` : '—'} />
            <Fact label="Keyingisi" value={res.after?.nextAvailableAt ? timeText(res.after.nextAvailableAt) : 'Hozir'} />
            <Fact label="Bugun qoldi" value={res.after ? `${res.after.todayRemainingPortions} porsiya` : '—'} />
          </div>
        </div>
        {close}
      </div>
    );
  }
  if (res?.status === 'UNKNOWN') {
    return (
      <div className="flex flex-col gap-2.5">
        <Notice tone="warn" title="Natijani aniqlab bo‘lmadi." hint="Qayta bosmang. Poster ekranida ichimlik qo‘shilganini tekshiring — CUP chek yopilganda o‘zi tekshiradi." />
        {close}
      </div>
    );
  }
  const text = summary ? subscriptionReasonText(res?.failureReason ?? null, summary) : null;
  return (
    <div className="flex flex-col gap-2.5">
      <Notice tone="warn" title="Abonement kofesi berilmadi." hint={text ?? 'Buyurtma o‘zgartirilmadi.'} />
      {close}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------- Coffee Subscription cash sale

// Plain-words reasons for a REJECTED cash sale — a normal (not failure-of-the-request) outcome, same treatment as subscriptionReasonText above.
const CASH_SALE_REJECTION_TEXT: Record<string, string> = {
  PLAN_NOT_FOUND: 'Bu reja endi mavjud emas. Ro‘yxatni yangilash uchun mijoz kartasini qayta oching.',
  PENDING_PURCHASE_EXISTS: 'Mijozning to‘lovi kutilayotgan boshqa obunasi bor. Avval uni admin panelda bekor qiling.',
  CONFLICT: 'Holat o‘zgardi. Mijoz kartasini yangilab, qayta urinib ko‘ring.',
};

function CashSaleFlow({ overview }: { overview: Overview }) {
  const w = useWidget();
  const r = w.cashSale;
  const summary = overview.subscription ?? null;
  if (r.phase === 'applying') {
    return (
      <div className="flex flex-col gap-2.5" aria-busy="true">
        <div className="rounded-xl border border-black bg-black px-3.5 py-3 text-white">
          <div className="text-[11px] font-bold tracking-[0.14em] text-cream uppercase">Coffee abonement</div>
          <div className="my-1 text-[24px] leading-[1.15] font-semibold">Naqd to‘lov tasdiqlanmoqda…</div>
        </div>
        <div className="h-[52px] animate-cw-pulse rounded-xl bg-[#ece6da]" />
      </div>
    );
  }
  if (r.phase === 'done') return <CashSaleDone />;
  if (r.phase === 'confirming' && r.selected) {
    const p = r.selected;
    const current = summary?.current ?? null;
    return (
      <div className="rounded-xl border border-transparent bg-cream px-3.5 py-3">
        <div className={LABEL}>Tasdiqlang</div>
        <div className="my-1 text-[24px] leading-[1.15] font-semibold [overflow-wrap:anywhere]">{p.name}</div>
        <div className="grid grid-cols-2 gap-x-3.5 gap-y-2">
          <Fact label="Mijoz" value={overview.customer?.displayName ?? '—'} />
          <Fact label="Narx" value={formatSom(p.priceMinor)} />
          <Fact label="Muddat" value={`${p.durationDays} kun`} />
          <Fact label="Porsiya" value={`${p.totalPortions}`} />
          <Fact label="Kunlik limit" value={`${p.dailyPortionLimit}`} />
          <Fact label="To‘lov" value="Naqd" />
        </div>
        {current && <p className="mx-0 mt-2 mb-0 text-[12px] text-muted-cream">Joriy abonement {dateText(current.endBusinessDate)} da tugaydi — yangisi shundan keyin boshlanadi.</p>}
        <p className="mx-0 mt-2 mb-0 text-[12px] text-muted-cream">Naqd pul olinganini tasdiqlagandan so‘ng obunani bekor qilib bo‘lmaydi (pul qaytarilmaydi).</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button className={BTN_GHOST} onClick={cancelCashSale} type="button">
            Bekor qilish
          </button>
          <button className={BTN_PRIMARY} onClick={confirmCashSale} type="button">
            Naqd to‘lovni tasdiqlash
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2.5">
      <Notice hint="Qaytadan tanlang." title="Reja tanlanmagan" tone="warn" />
      <button className={BTN_GHOST} onClick={cancelCashSale} type="button">
        Orqaga
      </button>
    </div>
  );
}

function CashSaleDone() {
  const r = useWidget().cashSale;
  const close = (
    <button className={BTN_PRIMARY} onClick={closeCashSale} type="button">
      Yopish
    </button>
  );
  if (r.transportError) {
    return (
      <div className="flex flex-col gap-2.5">
        <Notice tone="warn" title="So‘rovni yuborib bo‘lmadi." hint="Naqd pul olingan bo‘lsa, mijoz kartasini yangilab tekshiring — qayta bosishdan oldin." />
        {close}
      </div>
    );
  }
  const res = r.result;
  if (res?.status === 'ACTIVATED') {
    const s = res.subscription;
    return (
      <div className="flex flex-col gap-2.5">
        <div className="rounded-xl border border-transparent bg-cream px-3.5 py-3" role="status">
          <div className={LABEL}>✓ Abonement faollashtirildi</div>
          <div className="my-1 text-[24px] leading-[1.15] font-semibold [overflow-wrap:anywhere]">{s.planName}</div>
          <div className="grid grid-cols-2 gap-x-3.5 gap-y-2">
            <Fact label="Porsiya" value={`${s.usage.remainingPortions} / ${s.usage.totalPortions}`} />
            <Fact label="Amal qiladi" value={dateText(s.endBusinessDate)} />
            <Fact label="Holat" value={s.effectiveStatus === 'SCHEDULED' ? 'Navbatda' : 'Faol'} />
            <Fact label="To‘lov" value="Naqd" />
          </div>
          {s.effectiveStatus === 'SCHEDULED' && <p className="mx-0 mt-2 mb-0 text-[12px] text-muted-cream">Boshlanadi: {dateText(s.startBusinessDate)}</p>}
        </div>
        {close}
      </div>
    );
  }
  const text = res?.status === 'REJECTED' ? (CASH_SALE_REJECTION_TEXT[res.reason] ?? res.reason) : null;
  return (
    <div className="flex flex-col gap-2.5">
      <Notice tone="warn" title="Abonement sotilmadi." hint={text ?? 'Naqd pul olingan bo‘lsa, admin bilan bog‘laning.'} />
      {close}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------- Coffee Subscription real Poster order purchase

const POSTER_PURCHASE_REJECTION_TEXT: Record<string, string> = {
  PLAN_NOT_FOUND: 'Bu reja endi mavjud emas. Ro‘yxatni yangilash uchun mijoz kartasini qayta oching.',
  PLAN_NOT_MAPPED: 'Bu abonement mahsuloti Poster‘da mavjud emas yoki faol emas.',
  PENDING_PURCHASE_EXISTS: 'Mijozning to‘lovi kutilayotgan boshqa obunasi bor. Avval uni admin panelda bekor qiling.',
  CONFLICT: 'Holat o‘zgardi. Mijoz kartasini yangilab, qayta urinib ko‘ring.',
  ORDER_NOT_CONFIRMED: 'Ochiq buyurtmani tasdiqlab bo‘lmadi — buyurtma o‘zgartirilmadi.',
  CLIENT_MISMATCH: 'Ochiq buyurtma boshqa mijozga tegishli.',
  INVALID_CONTEXT: 'Kassa ma’lumoti aniqlanmadi.',
  POSTER_MUTATION_FAILED: 'Poster mahsulotni qo‘shmadi — buyurtma o‘zgartirilmadi.',
  POSTER_TRANSACTION_UNAVAILABLE: 'Ochiq buyurtmani tasdiqlab bo‘lmadi — buyurtma o‘zgartirilmadi.',
  PURCHASE_NOT_FOUND: 'Xarid topilmadi.',
  WRONG_ACCOUNT: 'Bu xarid boshqa kassaga tegishli.',
};

function PosterPurchaseFlow({ overview }: { overview: Overview }) {
  const w = useWidget();
  const r = w.posterPurchase;
  if (r.phase === 'applying') {
    return (
      <div className="flex flex-col gap-2.5" aria-busy="true">
        <div className="rounded-xl border border-black bg-black px-3.5 py-3 text-white">
          <div className="text-[11px] font-bold tracking-[0.14em] text-cream uppercase">Coffee abonement</div>
          <div className="my-1 text-[24px] leading-[1.15] font-semibold">Buyurtmaga qo‘shilmoqda…</div>
        </div>
        <div className="h-[52px] animate-cw-pulse rounded-xl bg-[#ece6da]" />
      </div>
    );
  }
  if (r.phase === 'awaiting_payment' || r.phase === 'checking') {
    return (
      <div className="flex flex-col gap-2.5">
        <div className="rounded-xl border border-transparent bg-cream px-3.5 py-3" role="status">
          <div className={LABEL}>{r.selected?.name ?? 'Coffee abonement'}</div>
          <div className="my-1 text-[22px] leading-[1.15] font-semibold">To‘lovni Poster orqali yakunlang</div>
          <p className="m-0 text-[13px] text-muted-cream">
            {r.selected ? formatSom(r.selected.priceMinor) : ''} — mijoz Poster kassasida to‘lasin. To‘lovni tasdiqlagandan so‘ng obuna faollashadi. Pul qaytarilmaydi.
          </p>
        </div>
        <button className={BTN_PRIMARY} disabled={r.phase === 'checking'} onClick={checkPosterPurchasePayment} type="button">
          {r.phase === 'checking' ? 'Tekshirilmoqda…' : 'To‘lovni tekshirish'}
        </button>
        <button className={BTN_GHOST} onClick={closePosterPurchase} type="button">
          Yopish (kuzatishda qoladi)
        </button>
      </div>
    );
  }
  if (r.phase === 'done') return <PosterPurchaseDone />;
  if (r.phase === 'confirming' && r.selected) {
    const p = r.selected;
    const target = subscriptionTarget();
    return (
      <div className="rounded-xl border border-transparent bg-cream px-3.5 py-3">
        <div className={LABEL}>Tasdiqlang</div>
        <div className="my-1 text-[24px] leading-[1.15] font-semibold [overflow-wrap:anywhere]">{p.name}</div>
        <div className="grid grid-cols-2 gap-x-3.5 gap-y-2">
          <Fact label="Mijoz" value={overview.customer?.displayName ?? '—'} />
          <Fact label="Narx" value={formatSom(p.priceMinor)} />
          <Fact label="Muddat" value={`${p.durationDays} kun`} />
          <Fact label="Porsiya" value={`${p.totalPortions}`} />
          <Fact label="To‘lov" value="Poster orqali" />
        </div>
        <p className="mx-0 mt-2 mb-0 text-[12px] text-muted-cream">Mahsulot joriy Poster buyurtmasiga real narxda qo‘shiladi — mijoz uni Poster orqali to‘laydi.</p>
        {!target && <p className="mx-0 mt-1 mb-0 text-[13px] font-semibold text-terracotta-deep">Avval Poster buyurtmasini oching.</p>}
        <div className="mt-2 flex flex-wrap gap-2">
          <button className={BTN_GHOST} onClick={cancelPosterPurchase} type="button">
            Bekor qilish
          </button>
          <button className={BTN_PRIMARY} disabled={!target} onClick={confirmPosterPurchase} type="button">
            Buyurtmaga qo‘shish
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2.5">
      <Notice hint="Qaytadan tanlang." title="Reja tanlanmagan" tone="warn" />
      <button className={BTN_GHOST} onClick={cancelPosterPurchase} type="button">
        Orqaga
      </button>
    </div>
  );
}

function PosterPurchaseDone() {
  const r = useWidget().posterPurchase;
  const close = (
    <button className={BTN_PRIMARY} onClick={closePosterPurchase} type="button">
      Yopish
    </button>
  );
  if (r.transportError) {
    return (
      <div className="flex flex-col gap-2.5">
        <Notice tone="warn" title="So‘rovni yuborib bo‘lmadi." hint="Mijoz kartasini yangilab, holatni tekshiring — qayta bosishdan oldin." />
        {close}
      </div>
    );
  }
  const res = r.result;
  if (res?.status === 'ACTIVATED') {
    const s = res.subscription;
    return (
      <div className="flex flex-col gap-2.5">
        <div className="rounded-xl border border-transparent bg-cream px-3.5 py-3" role="status">
          <div className={LABEL}>✓ Abonement faollashtirildi</div>
          <div className="my-1 text-[24px] leading-[1.15] font-semibold [overflow-wrap:anywhere]">{s.planName}</div>
          <div className="grid grid-cols-2 gap-x-3.5 gap-y-2">
            <Fact label="Porsiya" value={`${s.usage.remainingPortions} / ${s.usage.totalPortions}`} />
            <Fact label="Amal qiladi" value={dateText(s.endBusinessDate)} />
            <Fact label="Holat" value={s.effectiveStatus === 'SCHEDULED' ? 'Navbatda' : 'Faol'} />
            <Fact label="To‘lov" value="Poster orqali" />
          </div>
          {s.effectiveStatus === 'SCHEDULED' && <p className="mx-0 mt-2 mb-0 text-[12px] text-muted-cream">Boshlanadi: {dateText(s.startBusinessDate)}</p>}
        </div>
        {close}
      </div>
    );
  }
  const text = res?.status === 'REJECTED' ? (POSTER_PURCHASE_REJECTION_TEXT[res.reason] ?? res.reason) : null;
  return (
    <div className="flex flex-col gap-2.5">
      <Notice tone="warn" title="Abonement sotilmadi." hint={text ?? 'Poster‘da tekshirib ko‘ring.'} />
      {close}
    </div>
  );
}
