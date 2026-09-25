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
} from './store';
import type { Phase } from './store';
import { cx } from './cx';
import type { EligibleRewardProduct, ErrorKind, Overview, PromotionRedemptionFailureReason, PromotionView, RedemptionFailureReason, RewardProgramView } from './types';

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
        {w.phase === 'READY' && w.overview && w.redemption.phase !== 'idle' ? (
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
