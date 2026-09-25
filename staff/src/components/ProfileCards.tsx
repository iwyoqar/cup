import { useState } from 'react';
import { ApiError, toUserMessage } from '../lib/api';
import {
  benefitText,
  daysAgo,
  formatBirthday,
  formatDate,
  formatDateTime,
  formatNumber,
  formatSom,
  LIFECYCLE_LABELS,
  OPPORTUNITY_LABELS,
  PRIORITY_LABELS,
  REFERRAL_STATUS_LABELS,
  SIGNAL_LABELS,
  statusLabel,
} from '../lib/format';
import { ActivityItem, CustomerProfile, fetchActivity, Scope } from '../lib/staffApi';
import { Badge, Button, BadgeTone } from './ui';
import { cx } from '../lib/cx';

// Every card is a read-only picture of what the server composed — nothing here adds a point, a reward, a purchase or a referral.

export function LifecycleBadge({ state }: { state: keyof typeof LIFECYCLE_LABELS | null }) {
  if (!state) return null;
  return <Badge tone={state.toLowerCase() as BadgeTone}>{LIFECYCLE_LABELS[state]}</Badge>;
}

export function HeaderCard({ profile, onRefresh, busy }: { profile: CustomerProfile; onRefresh: () => void; busy: boolean }) {
  const { identity, loyalty, growth } = profile;
  const [copied, setCopied] = useState(false);
  const level = loyalty.program2.enabled ? loyalty.program2.level : null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(identity.publicCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard can be blocked in some webviews — the code stays visible on screen.
    }
  };

  return (
    <section className="flex flex-col gap-2 rounded-md border border-transparent bg-cream p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-bold tracking-[0.14em] text-muted-cream uppercase">Mijoz</div>
        <button className="font-[inherit] leading-[inherit] min-h-11 cursor-pointer border-0 bg-transparent px-1 py-0 text-left text-[14px] font-bold text-terracotta-deep disabled:opacity-50" disabled={busy} onClick={onRefresh} type="button">
          {busy ? 'Yangilanmoqda…' : '↻ Yangilash'}
        </button>
      </div>
      <h1 className="font-display text-[32px] leading-[1.1] font-medium">{identity.displayName ?? 'Ismsiz mijoz'}</h1>
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-[18px] font-bold tracking-[0.14em]">{identity.publicCode}</span>
        <Button onClick={copy} size="compact" variant="secondary">
          {copied ? 'Nusxa olindi' : 'Kodni nusxalash'}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {level && <Badge tone="level">{level.icon} {level.name}</Badge>}
        <LifecycleBadge state={growth.all.lifecycleState} />
        <Badge tone={identity.poster.state === 'LINKED' ? 'ok' : 'neutral'}>Poster: {identity.poster.state === 'LINKED' ? 'bog‘langan' : 'bog‘lanmagan'}</Badge>
      </div>
      <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-2 [&_dt]:text-[11px] [&_dt]:font-bold [&_dt]:tracking-[0.1em] [&_dt]:text-muted-cream [&_dt]:uppercase [&_dd]:mx-0 [&_dd]:mt-0.5 [&_dd]:mb-0 [&_dd]:font-semibold">
        <div>
          <dt>Telefon</dt>
          <dd>{identity.phoneMasked ?? '—'}</dd>
        </div>
        <div>
          <dt>Telegram</dt>
          <dd>{identity.telegramUsername ? `@${identity.telegramUsername}` : '—'}</dd>
        </div>
        <div>
          <dt>Mijoz bo‘lgan</dt>
          <dd>{formatDate(identity.customerSince)}</dd>
        </div>
        <div>
          <dt>Birinchi xarid</dt>
          <dd>{identity.firstPurchaseAt ? formatDate(identity.firstPurchaseAt) : '—'}</dd>
        </div>
        {identity.birthday && (
          <div>
            <dt>Tug‘ilgan kun</dt>
            <dd>{formatBirthday(identity.birthday)}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}

export function RewardsCard({ rewards }: { rewards: CustomerProfile['rewards'] }) {
  return (
    <section className="flex flex-col gap-2 rounded-md border border-line p-4">
      <div className="text-[11px] font-bold tracking-[0.14em] text-muted uppercase">Bonus coffee</div>
      {rewards.programs.length === 0 ? (
        <p className="text-[13px] text-muted">Faol bonus dasturi yo‘q.</p>
      ) : (
        <>
          {rewards.availableTotal > 0 ? <p className="self-start rounded-sm bg-black px-3 py-1.5 text-[14px] font-bold text-cream">Mavjud bonuslar: {rewards.availableTotal}</p> : <p className="text-[13px] text-muted">Hozircha mavjud bonus yo‘q.</p>}
          {rewards.programs.map((p) => (
            <div className="flex flex-col gap-2" key={p.programName}>
              <div className="font-bold">{p.programName}</div>
              <div className="flex gap-1" role="img" aria-label={`${p.qualifyingCount} / ${p.threshold}`}>
                {p.threshold <= 12 ? (
                  Array.from({ length: p.threshold }, (_, i) => <span key={i} className={cx('h-2.5 flex-1 rounded-[2px]', i < p.qualifyingCount ? 'bg-terracotta' : 'bg-track')} />)
                ) : (
                  <span className="h-2.5 flex-1 overflow-hidden rounded-[2px] bg-track">
                    <span className="block h-full bg-terracotta" style={{ width: `${(p.qualifyingCount / p.threshold) * 100}%` }} />
                  </span>
                )}
              </div>
              <p>
                <strong>
                  {p.qualifyingCount} / {p.threshold}
                </strong>{' '}
                · {p.availableRewards > 0 ? <strong>{p.availableRewards} ta bonus mavjud</strong> : <>keyingi bonusga yana <strong>{p.remainingToNext}</strong> ta</>}
              </p>
            </div>
          ))}
        </>
      )}
      {rewards.redemptions.total > 0 && (
        <p className="text-[13px] text-muted">
          Ishlatilgan bonuslar: {rewards.redemptions.total}. Oxirgisi: {rewards.redemptions.recent[0]?.productName ?? rewards.redemptions.recent[0]?.programName} ·{' '}
          {rewards.redemptions.recent[0] ? formatDate(rewards.redemptions.recent[0].redeemedAt) : ''}
        </p>
      )}
    </section>
  );
}

export function LoyaltyCard({ loyalty }: { loyalty: CustomerProfile['loyalty'] }) {
  const p2 = loyalty.program2;
  return (
    <section className="flex flex-col gap-2 rounded-md border border-line p-4">
      <div className="text-[11px] font-bold tracking-[0.14em] text-muted uppercase">Ballar va daraja</div>
      {loyalty.account ? (
        <p className="font-display text-[44px] leading-none font-medium">
          {formatNumber(loyalty.account.balance)} <span className="font-sans text-[16px] font-semibold">ball</span>
        </p>
      ) : (
        <p className="text-[13px] text-muted">Ball hisobi hali ochilmagan.</p>
      )}
      {loyalty.account && (
        <p className="text-[13px] text-muted">
          Jami yig‘ilgan: {formatNumber(loyalty.account.lifetimeEarned)} · ishlatilgan: {formatNumber(loyalty.account.lifetimeSpent)}
        </p>
      )}
      {p2.enabled ? (
        <div className="mt-1 flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[14px] text-muted">Daraja</span>
            <strong>{p2.level ? `${p2.level.icon} ${p2.level.name}` : '—'}</strong>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[14px] text-muted">XP</span>
            <strong>{formatNumber(p2.xp.lifetimeXP)}</strong>
          </div>
          {p2.xp.nextLevelXP !== null && (
            <div className="h-2.5 overflow-hidden rounded-[6px] bg-black/10" title={`${p2.xp.levelXP} XP`}>
              <span className="block h-full bg-terracotta" style={{ width: `${Math.min(100, (p2.xp.levelXP / Math.max(1, p2.xp.nextLevelXP - p2.xp.levelStartXP)) * 100)}%` }} />
            </div>
          )}
          {p2.nextLevel && <p className="text-[13px] text-muted">{p2.nextLevel.name} darajasigacha {formatSom(p2.nextLevel.spendToNext)} qoldi.</p>}
          {p2.streak.enabled && (
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[14px] text-muted">Ketma-ket kunlar</span>
              <strong>
                {p2.streak.current} <span className="text-[13px] text-muted">(eng yaxshisi {p2.streak.best})</span>
              </strong>
            </div>
          )}
          {p2.cashback.enabled && (
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[14px] text-muted">Keshbek</span>
              <strong>{formatSom(p2.cashback.balance)}</strong>
            </div>
          )}
          {p2.birthday.eligible && <p className="text-[13px] font-bold text-black">Tug‘ilgan kun bonusi mavjud.</p>}
        </div>
      ) : (
        <p className="text-[13px] text-muted">Sodiqlik darajalari (Loyalty 2.0) hozir o‘chirilgan.</p>
      )}
    </section>
  );
}

export function PromotionsCard({ promotions }: { promotions: CustomerProfile['promotions'] }) {
  return (
    <section className="flex flex-col gap-2 rounded-md border border-line p-4">
      <div className="text-[11px] font-bold tracking-[0.14em] text-muted uppercase">Aksiyalar</div>
      {promotions.length === 0 ? (
        <p className="text-[13px] text-muted">Faol aksiya yo‘q.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
          {promotions.map((p) => (
            <li key={p.name + p.startsAt}>
              <div className="font-display text-[20px] text-terracotta-deep">{benefitText(p.benefit)}</div>
              <div className="font-semibold">{p.name}</div>
              {p.description && <div className="text-[13px] text-muted">{p.description}</div>}
              <div className="text-[13px] text-muted">
                {p.endsAt ? `${formatDate(p.endsAt)} gacha` : 'Muddatsiz'}
                {p.remainingUses !== null ? ` · qolgan foydalanish: ${p.remainingUses}` : ''}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function GrowthCard({ growth, scope }: { growth: CustomerProfile['growth']; scope: CustomerProfile['scope'] }) {
  const g = growth.all;
  return (
    <section className="flex flex-col gap-2 rounded-md border border-line p-4">
      <div className="text-[11px] font-bold tracking-[0.14em] text-muted uppercase">Mijoz holati</div>
      {g.lifecycleState ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <LifecycleBadge state={g.lifecycleState} />
          {g.rfm && <Badge>RFM {g.rfm.score}</Badge>}
        </div>
      ) : (
        <p className="text-[13px] text-muted">Hali xarid yo‘q — mijoz holati aniqlanmagan.</p>
      )}
      {g.rfm && (
        <p className="text-[13px] text-muted">
          Yaqinlik {g.rfm.recency} · Chastota {g.rfm.frequency} · Summa {g.rfm.monetary} (1–5)
        </p>
      )}
      <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-2 [&_dt]:text-[11px] [&_dt]:font-bold [&_dt]:tracking-[0.1em] [&_dt]:text-muted [&_dt]:uppercase [&_dd]:mx-0 [&_dd]:mt-0.5 [&_dd]:mb-0 [&_dd]:font-semibold">
        <div>
          <dt>Oxirgi xarid</dt>
          <dd>{daysAgo(g.recencyDays)}</dd>
        </div>
        <div>
          <dt>Xaridlar (jami)</dt>
          <dd>{formatNumber(g.lifetimePurchases)}</dd>
        </div>
        <div>
          <dt>Tushum (jami)</dt>
          <dd>{formatSom(g.lifetimeRevenue)}</dd>
        </div>
        <div>
          <dt>So‘nggi {g.lookbackDays} kun</dt>
          <dd>
            {g.frequency} ta · {formatSom(g.monetary)}
          </dd>
        </div>
      </dl>
      {growth.branch && scope.branch && (
        <div className="rounded-sm border border-dashed border-black px-3 py-2">
          <div className="text-[12px] font-bold tracking-[0.06em] uppercase">Faqat “{growth.branch.branchName}” filiali bo‘yicha</div>
          <p className="text-[13px] text-muted">
            {growth.branch.lifetimePurchases} xarid · {formatSom(growth.branch.lifetimeRevenue)} · oxirgisi: {daysAgo(growth.branch.recencyDays)}
            {growth.branch.lifecycleState ? ` · ${LIFECYCLE_LABELS[growth.branch.lifecycleState]}` : ''}
          </p>
        </div>
      )}
      {g.signals.length > 0 && (
        <>
          <div className="mt-1.5 text-[12px] font-bold tracking-[0.1em] text-muted uppercase">Signallar</div>
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
            {g.signals.map((s) => (
              <li className="flex flex-col gap-0.5" key={s.type + s.reason}>
                <span className={cx('self-start rounded-[6px] px-2 py-0.5 text-[13px] font-bold', s.severity.toLowerCase() === 'attention' ? 'bg-black text-cream' : s.severity.toLowerCase() === 'opportunity' ? 'bg-cream' : 'bg-black/7')}>{SIGNAL_LABELS[s.type] ?? s.type}</span>
                <span className="text-[13px] text-muted">{s.reason}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {g.opportunities.length > 0 && (
        <>
          <div className="mt-1.5 text-[12px] font-bold tracking-[0.1em] text-muted uppercase">Imkoniyatlar</div>
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
            {g.opportunities.map((o) => (
              <li className="flex flex-col gap-0.5" key={o.type}>
                <span className="font-bold [&_em]:font-medium [&_em]:text-muted [&_em]:not-italic">
                  {OPPORTUNITY_LABELS[o.type] ?? o.type} <em>· {PRIORITY_LABELS[o.priority] ?? o.priority}</em>
                </span>
                <span className="text-[13px] text-muted">{o.reason}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function lineSummary(lines: ActivityItem['lines']): string {
  if (lines.length === 0) return '';
  const shown = lines.slice(0, 3).map((l) => `${l.productName ?? 'Mahsulot'}${l.quantity > 1 ? ` × ${l.quantity}` : ''}${l.isReward ? ' (bonus)' : ''}`);
  return shown.join(', ') + (lines.length > 3 ? ` +${lines.length - 3}` : '');
}

export function ActivityCard({ code, scopeChoice, initial, scope }: { code: string; scopeChoice: Scope | undefined; initial: CustomerProfile['activity']; scope: CustomerProfile['scope'] }) {
  const [items, setItems] = useState<ActivityItem[]>(initial.items);
  const [next, setNext] = useState<string | null>(initial.nextCursor);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const more = async () => {
    if (!next) return;
    setBusy(true);
    setError(null);
    try {
      const page = await fetchActivity(code, next, scopeChoice);
      setItems((c) => [...c, ...page.items]);
      setNext(page.nextCursor);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? 'Kirish muddati tugagan. Qayta kiring.' : toUserMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-2 rounded-md border border-line p-4">
      <div className="text-[11px] font-bold tracking-[0.14em] text-muted uppercase">So‘nggi xaridlar{scope.kind === 'BRANCH' && scope.branch ? ` · ${scope.branch.name}` : ' · barcha filiallar'}</div>
      {items.length === 0 ? (
        <p className="text-[13px] text-muted">{scope.kind === 'BRANCH' ? 'Bu filialda xaridlar yo‘q.' : 'Xaridlar yo‘q.'}</p>
      ) : (
        <ul className="m-0 list-none p-0">
          {items.map((item, i) => (
            <li className="flex justify-between gap-3 border-t border-line py-2.5 first:border-t-0" key={`${item.at}-${i}`}>
              <div>
                <div className="font-semibold">
                  <span className={cx('inline-block min-w-[34px] rounded-[5px] px-1.5 text-center text-[11px] font-extrabold tracking-[0.06em] text-white', (item.source ?? 'cup').toLowerCase() === 'pos' ? 'bg-terracotta' : 'bg-black')}>{item.source}</span> {formatDateTime(item.at)}
                </div>
                <div className="text-[13px] text-muted">
                  {item.branchName ?? 'Filial aniqlanmagan'}
                  {item.status ? ` · ${statusLabel(item.status)}` : ''}
                </div>
                {item.lines.length > 0 && <div className="text-[13px] text-muted">{lineSummary(item.lines)}</div>}
              </div>
              <div className="font-semibold whitespace-nowrap">{item.amountMinor === null ? '' : formatSom(item.amountMinor)}</div>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-[14px] font-semibold text-terracotta-deep">{error}</p>}
      {next && (
        <Button disabled={busy} onClick={more} variant="secondary">
          {busy ? 'Yuklanmoqda…' : 'Ko‘proq ko‘rsatish'}
        </Button>
      )}
    </section>
  );
}

export function ReferralCard({ referral }: { referral: CustomerProfile['referral'] }) {
  const empty = !referral.referralCode && !referral.referredBy && referral.invited.successful + referral.invited.pending === 0;
  return (
    <section className="flex flex-col gap-2 rounded-md border border-line p-4">
      <div className="text-[11px] font-bold tracking-[0.14em] text-muted uppercase">Do‘st taklif qilish</div>
      {empty ? (
        <p className="text-[13px] text-muted">Taklif ma‘lumotlari yo‘q.</p>
      ) : (
        <>
          {referral.referralCode && <p className="font-display text-[22px] tracking-[0.08em]">{referral.referralCode}</p>}
          <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-2 [&_dt]:text-[11px] [&_dt]:font-bold [&_dt]:tracking-[0.1em] [&_dt]:text-muted [&_dt]:uppercase [&_dd]:mx-0 [&_dd]:mt-0.5 [&_dd]:mb-0 [&_dd]:font-semibold">
            <div>
              <dt>Muvaffaqiyatli</dt>
              <dd>{referral.invited.successful}</dd>
            </div>
            <div>
              <dt>Kutilmoqda</dt>
              <dd>{referral.invited.pending}</dd>
            </div>
            <div>
              <dt>Xarid qilgan</dt>
              <dd>{referral.invited.qualified}</dd>
            </div>
            <div>
              <dt>Bonus berilgan</dt>
              <dd>{referral.invited.rewarded}</dd>
            </div>
          </dl>
          {referral.referredBy && (
            <p className="text-[13px] text-muted">
              Bu mijoz taklif orqali kelgan: {REFERRAL_STATUS_LABELS[referral.referredBy.status] ?? referral.referredBy.status}
              {referral.referredBy.at ? ` (${formatDate(referral.referredBy.at)})` : ''}.
            </p>
          )}
        </>
      )}
    </section>
  );
}
