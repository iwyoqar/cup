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
import type { EligibleRewardProduct, ErrorKind, Overview, PromotionRedemptionFailureReason, PromotionView, RedemptionFailureReason, RewardProgramView } from './types';

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
    <div className="cw">
      <header className="cw__head">
        <span className="cw__brand">CUP</span>
        <span className="cw__who">{w.posterClient?.name ?? w.overview?.customer?.displayName ?? ''}</span>
        <span className={`cw__dot cw__dot--${w.phase.toLowerCase()}`} title={w.phase} />
      </header>

      <main className="cw__body">
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

      <footer className="cw__foot">
        <span>{w.employee ?? ''}</span>
        <span>{w.orderItems !== null ? `Buyurtma: ${w.orderItems} ta mahsulot` : ''}</span>
        <span className="cw__where">{w.where}</span>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------- states

function Idle() {
  const w = useWidget();
  return (
    <div className="cw__stack">
      <Notice tone="muted" title="Mijoz tanlanmagan" hint="Poster buyurtmasiga mijoz qo‘shilganda CUP ma’lumoti o‘zi chiqadi. Yoki quyida qidiring — bu buyurtmaga hech narsa qo‘shmaydi." />
      <Search />
      {w.inputError && <p className="cw__error">{w.inputError}</p>}
    </div>
  );
}

function Loading() {
  const w = useWidget();
  return (
    <div className="cw__stack" aria-busy="true">
      <div className="cw__card cw__card--strong">
        <div className="cw__label">Mijoz</div>
        <div className="cw__name">{w.posterClient?.name ?? 'Yuklanmoqda…'}</div>
        <div className="cw__muted">CUP ma’lumoti olinmoqda…</div>
      </div>
      <div className="cw__skel" />
      <div className="cw__skel cw__skel--short" />
    </div>
  );
}

function ErrorView({ kind }: { kind: ErrorKind }) {
  const t = ERROR_TEXT[kind];
  return (
    <div className="cw__stack">
      <Notice tone="warn" title={t.title} hint={t.hint} />
      <div className="cw__row">
        {t.retry && (
          <button className="cw__btn" onClick={retry} type="button">
            Qayta urinish
          </button>
        )}
        <button className="cw__btn cw__btn--ghost" onClick={clearManual} type="button">
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
      <div className="cw__stack">
        <Notice tone="warn" title="Mijoz topilmadi" hint="Bu kod yoki raqam CUP da ro‘yxatdan o‘tmagan. Mijoz CUP ilovasida ro‘yxatdan o‘tishi kerak." />
        <Search />
      </div>
    );
  }
  if (overview.state === 'AMBIGUOUS') {
    return (
      <div className="cw__stack">
        <Notice tone="warn" title="Bu raqamda bir nechta mijoz bor" hint="Adashmaslik uchun mijozning CUP kodini kiriting (CUP-XXXXXXXX)." />
        <Search />
      </div>
    );
  }
  if (overview.state === 'NOT_LINKED') {
    return (
      <div className="cw__stack">
        <div className="cw__card">
          <div className="cw__label">Poster mijozi</div>
          <div className="cw__name">{w.posterClient?.name ?? '—'}</div>
          {w.posterClient?.phone && <div className="cw__muted">{w.posterClient.phone}</div>}
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
    <div className="cw__stack">
      <div className="cw__card cw__card--strong">
        <div className="cw__label">CUP mijozi</div>
        <div className="cw__name">{c?.displayName ?? 'Ismsiz mijoz'}</div>
        <div className="cw__muted">
          {c?.phoneMasked ?? '—'}
          {c?.code ? <span className="cw__chip">{c.code}</span> : null}
          {!overview.linkedToPoster && <span className="cw__chip cw__chip--warn">Poster bilan bog‘lanmagan</span>}
        </div>
      </div>

      {availableProgram && rewards ? (
        <div className="cw__card cw__card--reward" role="status">
          <div className="cw__label">Sovg‘a mavjud</div>
          <div className="cw__big">{rewards.availableTotal} ta bepul mahsulot mavjud</div>
          <Progress program={availableProgram} />
          <div className="cw__row">
            {/* Phase 22.2: ONE Poster order = max one redemption. w.redeemedOrderId === w.orderId means THIS order already used its one reward (either
                this click did, or the server already said so) — hide the button rather than let a cashier click into a guaranteed
                REWARD_ALREADY_REDEEMED_FOR_ORDER. This is UX only; the backend enforces the rule regardless of what the widget shows. */}
            {rewards.redemption.enabled && w.redeemedOrderId !== w.orderId && (
              <button
                className="cw__btn"
                onClick={() => startRedeem(availableProgram.programId, availableProgram.name, availableProgram.eligibleProducts)}
                type="button"
              >
                Sovg‘ani ishlatish
              </button>
            )}
            <button className="cw__btn cw__btn--ghost" onClick={() => setDetails((v) => !v)} type="button" aria-expanded={details}>
              {details ? 'Yopish' : 'Batafsil'}
            </button>
          </div>
          {details && <RewardDetails programs={rewards.programs} />}
          {!rewards.redemption.enabled && <p className="cw__note">Bu yerda sovg‘a ishlatilmaydi. Hozircha faqat ko‘rsatiladi.</p>}
          {rewards.redemption.enabled && w.redeemedOrderId === w.orderId && <p className="cw__note">Bu buyurtma uchun sovg‘a allaqachon ishlatilgan.</p>}
        </div>
      ) : rewards && rewards.programs.length > 0 ? (
        <div className="cw__card">
          <div className="cw__label">Sovg‘a</div>
          <div className="cw__muted">Hozir mavjud sovg‘a yo‘q</div>
          {rewards.programs.map((p) => (
            <Progress key={p.name} program={p} />
          ))}
        </div>
      ) : (
        <div className="cw__card">
          <div className="cw__label">Sovg‘a</div>
          <div className="cw__muted">Faol sovg‘a dasturi yo‘q</div>
        </div>
      )}

      <LoyaltyCard overview={overview} />
      <Promotions promotions={overview.promotions} redeemedOrderId={w.redeemedPromotionOrderId} orderId={w.orderId} />

      <div className="cw__card cw__grid2">
        <div>
          <div className="cw__label">Tashriflar</div>
          <div className="cw__value">{activity ? activity.visits : 0}</div>
        </div>
        <div>
          <div className="cw__label">Oxirgi tashrif</div>
          <div className="cw__value">{activity && activity.visits > 0 ? lastVisitText(activity.lastVisitAt) : 'Tarix yo‘q'}</div>
        </div>
      </div>

      <button className="cw__btn cw__btn--ghost" onClick={clearManual} type="button">
        Boshqa mijozni qidirish
      </button>
    </div>
  );
}

function Progress({ program }: { program: RewardProgramView }) {
  const pct = Math.min(100, Math.round((program.progress / Math.max(1, program.threshold)) * 100));
  return (
    <div className="cw__progress">
      <div className="cw__progress-top">
        <span>{program.name}</span>
        <strong>
          {program.progress} / {program.threshold}
        </strong>
      </div>
      <div className="cw__bar">
        <span style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function RewardDetails({ programs }: { programs: RewardProgramView[] }) {
  return (
    <div className="cw__details">
      {programs.map((p) => (
        <div key={p.name}>
          <strong>{p.name}</strong>
          <div className="cw__muted">
            {p.available > 0 ? `${p.available} ta mavjud` : 'Mavjud emas'} · keyingisigacha {p.remaining} ta
          </div>
          {p.eligibleProducts.length > 0 && <div className="cw__muted">Mahsulotlar: {p.eligibleProducts.map((x) => x.name).join(', ')}</div>}
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
    <div className="cw__stack">
      {r.phase === 'selecting' && <RewardProductPicker products={r.products} />}
      {r.phase === 'confirming' && r.selected && <RedeemConfirm product={r.selected} />}
      {r.phase === 'applying' && <RedeemApplying />}
      {r.phase === 'done' && <RedeemDone />}
    </div>
  );
}

function RewardProductPicker({ products }: { products: EligibleRewardProduct[] }) {
  return (
    <div className="cw__stack">
      <div className="cw__card">
        <div className="cw__label">Sovg‘a</div>
        <div className="cw__name">Mahsulotni tanlang</div>
      </div>
      {products.map((p) => (
        <button className="cw__btn cw__btn--ghost" key={p.posterProductId} onClick={() => selectRewardProduct(p)} type="button">
          {p.name}
        </button>
      ))}
      <button className="cw__btn cw__btn--ghost" onClick={cancelRedeem} type="button">
        Bekor qilish
      </button>
    </div>
  );
}

function RedeemConfirm({ product }: { product: EligibleRewardProduct }) {
  return (
    <div className="cw__card cw__card--reward">
      <div className="cw__label">Sovg‘ani ishlatish?</div>
      <div className="cw__name">{product.name}</div>
      <div className="cw__big">Mijoz uchun: BEPUL</div>
      <div className="cw__row">
        <button className="cw__btn cw__btn--ghost" onClick={cancelRedeem} type="button">
          Bekor qilish
        </button>
        <button className="cw__btn" onClick={confirmRedeem} type="button">
          Tasdiqlash
        </button>
      </div>
    </div>
  );
}

function RedeemApplying() {
  return (
    <div className="cw__stack" aria-busy="true">
      <div className="cw__card cw__card--strong">
        <div className="cw__label">Sovg‘a</div>
        <div className="cw__name">Sovg‘a qo‘llanmoqda…</div>
      </div>
      <div className="cw__skel cw__skel--short" />
    </div>
  );
}

function RedeemDone() {
  const w = useWidget();
  const r = w.redemption;

  if (r.transportError) {
    return (
      <div className="cw__stack">
        <Notice tone="warn" title="Sovg‘ani qo‘llab bo‘lmadi." hint="Buyurtma o‘zgartirilmadi." />
        <button className="cw__btn" onClick={closeRedemption} type="button">
          Yopish
        </button>
      </div>
    );
  }

  const status = r.result?.status;
  if (status === 'REDEEMED') {
    return (
      <div className="cw__stack">
        <div className="cw__card cw__card--reward" role="status">
          <div className="cw__label">✓ Sovg‘a qo‘llandi</div>
          <div className="cw__name">{r.result?.productName ?? ''}</div>
        </div>
        <button className="cw__btn" onClick={closeRedemption} type="button">
          Yopish
        </button>
      </div>
    );
  }

  if (status === 'UNKNOWN') {
    return (
      <div className="cw__stack">
        <Notice tone="warn" title="Buyurtma holatini aniqlab bo‘lmadi." hint="Sovg‘ani qayta bosmang." />
        <button className="cw__btn" onClick={closeRedemption} type="button">
          Yopish
        </button>
      </div>
    );
  }

  // FAILED, or any other non-success status — same generic message either way, plus a specific line when one is known.
  const reason = r.result?.failureReason ?? null;
  return (
    <div className="cw__stack">
      <Notice tone="warn" title="Sovg‘ani qo‘llab bo‘lmadi." hint="Buyurtma o‘zgartirilmadi." />
      {reason && FAILURE_TEXT[reason] && <p className="cw__note">{FAILURE_TEXT[reason]}</p>}
      <button className="cw__btn" onClick={closeRedemption} type="button">
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
    <div className="cw__card cw__grid2">
      {p2.enabled ? (
        <>
          <div>
            <div className="cw__label">Daraja</div>
            <div className="cw__value">{p2.level ? `${p2.level.icon} ${p2.level.name}` : '—'}</div>
          </div>
          <div>
            <div className="cw__label">Cashback</div>
            <div className="cw__value">{p2.cashbackMinor !== null ? formatSom(p2.cashbackMinor) : '—'}</div>
          </div>
          <div>
            <div className="cw__label">XP</div>
            <div className="cw__value">{p2.xp.total.toLocaleString('ru-RU')}</div>
          </div>
          <div>
            <div className="cw__label">Ketma-ket kunlar</div>
            <div className="cw__value">{p2.streak.enabled ? p2.streak.current : '—'}</div>
          </div>
        </>
      ) : null}
      {l.legacyProgramEnabled && (
        <div>
          <div className="cw__label">Ballar</div>
          <div className="cw__value">{l.points !== null ? l.points.toLocaleString('ru-RU') : 0}</div>
        </div>
      )}
      {!p2.enabled && !l.legacyProgramEnabled && <div className="cw__muted">Sodiqlik dasturi yoqilmagan</div>}
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
    <div className="cw__card">
      <div className="cw__label">Promolar</div>
      {items.length === 0 ? (
        <div className="cw__muted">Hozircha aksiya yo‘q</div>
      ) : (
        <ul className="cw__list">
          {items.map((p) => (
            <li key={p.promotionId}>
              <strong>{p.name}</strong>
              <span className="cw__muted">{benefitText(p)}</span>
              {redemption.enabled && !alreadyUsedThisOrder && POSTER_MUTATABLE_BENEFIT_TYPES.has(p.benefit.type) && (
                <button className="cw__btn cw__btn--ghost" onClick={() => startPromotionRedeem(p.promotionId, p.name)} type="button">
                  Qo‘llash
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!redemption.enabled && items.length > 0 && <p className="cw__note">Bu yerda aksiya qo‘llanmaydi. Hozircha faqat ko‘rsatiladi.</p>}
      {alreadyUsedThisOrder && <p className="cw__note">Bu buyurtma uchun aksiya allaqachon qo‘llangan.</p>}
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
    <div className="cw__stack">
      {r.phase === 'confirming' && r.promotionName && <PromotionRedeemConfirm name={r.promotionName} />}
      {r.phase === 'applying' && <PromotionRedeemApplying />}
      {r.phase === 'done' && <PromotionRedeemDone />}
    </div>
  );
}

function PromotionRedeemConfirm({ name }: { name: string }) {
  return (
    <div className="cw__card cw__card--reward">
      <div className="cw__label">Bu aksiyani ushbu buyurtmaga qo‘llaysizmi?</div>
      <div className="cw__name">{name}</div>
      <div className="cw__row">
        <button className="cw__btn cw__btn--ghost" onClick={cancelPromotionRedeem} type="button">
          Bekor qilish
        </button>
        <button className="cw__btn" onClick={confirmPromotionRedeem} type="button">
          Tasdiqlash
        </button>
      </div>
    </div>
  );
}

function PromotionRedeemApplying() {
  return (
    <div className="cw__stack" aria-busy="true">
      <div className="cw__card cw__card--strong">
        <div className="cw__label">Aksiya</div>
        <div className="cw__name">Qo‘llanmoqda…</div>
      </div>
      <div className="cw__skel cw__skel--short" />
    </div>
  );
}

function PromotionRedeemDone() {
  const w = useWidget();
  const r = w.promotionRedemption;

  if (r.transportError) {
    return (
      <div className="cw__stack">
        <Notice tone="warn" title="Aksiyani qo‘llab bo‘lmadi." hint="Buyurtma o‘zgartirilmadi." />
        <button className="cw__btn" onClick={closePromotionRedemption} type="button">
          Yopish
        </button>
      </div>
    );
  }

  const status = r.result?.status;
  if (status === 'REDEEMED') {
    return (
      <div className="cw__stack">
        <div className="cw__card cw__card--reward" role="status">
          <div className="cw__label">✓ Aksiya qo‘llandi</div>
          <div className="cw__name">{r.result?.promotionName ?? ''}</div>
        </div>
        <button className="cw__btn" onClick={closePromotionRedemption} type="button">
          Yopish
        </button>
      </div>
    );
  }

  if (status === 'UNKNOWN') {
    return (
      <div className="cw__stack">
        <Notice tone="warn" title="Natija aniqlanmadi." hint="Qayta bosmang." />
        <button className="cw__btn" onClick={closePromotionRedemption} type="button">
          Yopish
        </button>
      </div>
    );
  }

  const reason = r.result?.failureReason ?? null;
  return (
    <div className="cw__stack">
      <Notice tone="warn" title="Aksiyani qo‘llab bo‘lmadi." hint="Buyurtma o‘zgartirilmadi." />
      {reason && PROMOTION_FAILURE_TEXT[reason] && <p className="cw__note">{PROMOTION_FAILURE_TEXT[reason]}</p>}
      <button className="cw__btn" onClick={closePromotionRedemption} type="button">
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
      className="cw__search"
      onSubmit={(e) => {
        e.preventDefault();
        lookup(text);
      }}
    >
      <input aria-label="CUP kodi yoki telefon" autoComplete="off" inputMode="text" maxLength={64} onChange={(e) => setText(e.target.value)} placeholder="CUP-XXXXXXXX yoki +998…" value={text} />
      <button className="cw__btn" type="submit">
        Qidirish
      </button>
      {w.mobile && (
        <button className="cw__btn cw__btn--ghost" onClick={scan} type="button">
          QR skaner
        </button>
      )}
    </form>
  );
}

function Notice({ tone, title, hint }: { tone: 'warn' | 'muted'; title: string; hint: string }) {
  return (
    <div className={`cw__notice cw__notice--${tone}`} role={tone === 'warn' ? 'alert' : 'status'}>
      <div className="cw__notice-title">{title}</div>
      <div className="cw__muted">{hint}</div>
    </div>
  );
}
