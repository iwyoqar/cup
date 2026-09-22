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

// Every card is a read-only picture of what the server composed — nothing here adds a point, a reward, a purchase or a referral.

export function LifecycleBadge({ state }: { state: keyof typeof LIFECYCLE_LABELS | null }) {
  if (!state) return null;
  return <span className={`badge badge--${state.toLowerCase()}`}>{LIFECYCLE_LABELS[state]}</span>;
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
    <section className="block block--cream profile-head">
      <div className="profile-head__top">
        <div className="eyebrow">Mijoz</div>
        <button className="link-button" disabled={busy} onClick={onRefresh} type="button">
          {busy ? 'Yangilanmoqda…' : '↻ Yangilash'}
        </button>
      </div>
      <h1 className="customer-name">{identity.displayName ?? 'Ismsiz mijoz'}</h1>
      <div className="profile-head__code">
        <span className="customer-code">{identity.publicCode}</span>
        <button className="button button--secondary button--compact" onClick={copy} type="button">
          {copied ? 'Nusxa olindi' : 'Kodni nusxalash'}
        </button>
      </div>
      <div className="chips">
        {level && <span className="badge badge--level">{level.icon} {level.name}</span>}
        <LifecycleBadge state={growth.all.lifecycleState} />
        <span className={`badge ${identity.poster.state === 'LINKED' ? 'badge--ok' : ''}`}>Poster: {identity.poster.state === 'LINKED' ? 'bog‘langan' : 'bog‘lanmagan'}</span>
      </div>
      <dl className="facts">
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
    <section className="block">
      <div className="eyebrow">Bonus coffee</div>
      {rewards.programs.length === 0 ? (
        <p className="hint">Faol bonus dasturi yo‘q.</p>
      ) : (
        <>
          {rewards.availableTotal > 0 ? <p className="reward__available">Mavjud bonuslar: {rewards.availableTotal}</p> : <p className="hint">Hozircha mavjud bonus yo‘q.</p>}
          {rewards.programs.map((p) => (
            <div className="reward" key={p.programName}>
              <div className="reward__name">{p.programName}</div>
              <div className="progress" role="img" aria-label={`${p.qualifyingCount} / ${p.threshold}`}>
                {p.threshold <= 12 ? (
                  Array.from({ length: p.threshold }, (_, i) => <span key={i} className={`progress__seg${i < p.qualifyingCount ? ' progress__seg--on' : ''}`} />)
                ) : (
                  <span className="progress__bar">
                    <span className="progress__fill" style={{ width: `${(p.qualifyingCount / p.threshold) * 100}%` }} />
                  </span>
                )}
              </div>
              <p className="reward__line">
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
        <p className="hint">
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
    <section className="block">
      <div className="eyebrow">Ballar va daraja</div>
      {loyalty.account ? (
        <p className="big-number">
          {formatNumber(loyalty.account.balance)} <span className="unit">ball</span>
        </p>
      ) : (
        <p className="hint">Ball hisobi hali ochilmagan.</p>
      )}
      {loyalty.account && (
        <p className="hint">
          Jami yig‘ilgan: {formatNumber(loyalty.account.lifetimeEarned)} · ishlatilgan: {formatNumber(loyalty.account.lifetimeSpent)}
        </p>
      )}
      {p2.enabled ? (
        <div className="l2">
          <div className="l2__row">
            <span className="l2__k">Daraja</span>
            <strong>{p2.level ? `${p2.level.icon} ${p2.level.name}` : '—'}</strong>
          </div>
          <div className="l2__row">
            <span className="l2__k">XP</span>
            <strong>{formatNumber(p2.xp.lifetimeXP)}</strong>
          </div>
          {p2.xp.nextLevelXP !== null && (
            <div className="xp" title={`${p2.xp.levelXP} XP`}>
              <span className="xp__fill" style={{ width: `${Math.min(100, (p2.xp.levelXP / Math.max(1, p2.xp.nextLevelXP - p2.xp.levelStartXP)) * 100)}%` }} />
            </div>
          )}
          {p2.nextLevel && <p className="hint">{p2.nextLevel.name} darajasigacha {formatSom(p2.nextLevel.spendToNext)} qoldi.</p>}
          {p2.streak.enabled && (
            <div className="l2__row">
              <span className="l2__k">Ketma-ket kunlar</span>
              <strong>
                {p2.streak.current} <span className="hint">(eng yaxshisi {p2.streak.best})</span>
              </strong>
            </div>
          )}
          {p2.cashback.enabled && (
            <div className="l2__row">
              <span className="l2__k">Keshbek</span>
              <strong>{formatSom(p2.cashback.balance)}</strong>
            </div>
          )}
          {p2.birthday.eligible && <p className="hint hint--strong">Tug‘ilgan kun bonusi mavjud.</p>}
        </div>
      ) : (
        <p className="hint">Sodiqlik darajalari (Loyalty 2.0) hozir o‘chirilgan.</p>
      )}
    </section>
  );
}

export function PromotionsCard({ promotions }: { promotions: CustomerProfile['promotions'] }) {
  return (
    <section className="block">
      <div className="eyebrow">Aksiyalar</div>
      {promotions.length === 0 ? (
        <p className="hint">Faol aksiya yo‘q.</p>
      ) : (
        <ul className="plain-list">
          {promotions.map((p) => (
            <li className="promo" key={p.name + p.startsAt}>
              <div className="promo__benefit">{benefitText(p.benefit)}</div>
              <div className="promo__name">{p.name}</div>
              {p.description && <div className="hint">{p.description}</div>}
              <div className="hint">
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
    <section className="block">
      <div className="eyebrow">Mijoz holati</div>
      {g.lifecycleState ? (
        <div className="chips">
          <LifecycleBadge state={g.lifecycleState} />
          {g.rfm && <span className="badge">RFM {g.rfm.score}</span>}
        </div>
      ) : (
        <p className="hint">Hali xarid yo‘q — mijoz holati aniqlanmagan.</p>
      )}
      {g.rfm && (
        <p className="hint">
          Yaqinlik {g.rfm.recency} · Chastota {g.rfm.frequency} · Summa {g.rfm.monetary} (1–5)
        </p>
      )}
      <dl className="facts">
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
        <div className="branchbox">
          <div className="branchbox__title">Faqat “{growth.branch.branchName}” filiali bo‘yicha</div>
          <p className="hint">
            {growth.branch.lifetimePurchases} xarid · {formatSom(growth.branch.lifetimeRevenue)} · oxirgisi: {daysAgo(growth.branch.recencyDays)}
            {growth.branch.lifecycleState ? ` · ${LIFECYCLE_LABELS[growth.branch.lifecycleState]}` : ''}
          </p>
        </div>
      )}
      {g.signals.length > 0 && (
        <>
          <div className="subhead">Signallar</div>
          <ul className="plain-list">
            {g.signals.map((s) => (
              <li className="signal" key={s.type + s.reason}>
                <span className={`sev sev--${s.severity.toLowerCase()}`}>{SIGNAL_LABELS[s.type] ?? s.type}</span>
                <span className="hint">{s.reason}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {g.opportunities.length > 0 && (
        <>
          <div className="subhead">Imkoniyatlar</div>
          <ul className="plain-list">
            {g.opportunities.map((o) => (
              <li className="signal" key={o.type}>
                <span className="opp">
                  {OPPORTUNITY_LABELS[o.type] ?? o.type} <em>· {PRIORITY_LABELS[o.priority] ?? o.priority}</em>
                </span>
                <span className="hint">{o.reason}</span>
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
    <section className="block">
      <div className="eyebrow">So‘nggi xaridlar{scope.kind === 'BRANCH' && scope.branch ? ` · ${scope.branch.name}` : ' · barcha filiallar'}</div>
      {items.length === 0 ? (
        <p className="hint">{scope.kind === 'BRANCH' ? 'Bu filialda xaridlar yo‘q.' : 'Xaridlar yo‘q.'}</p>
      ) : (
        <ul className="orders">
          {items.map((item, i) => (
            <li className="orders__row" key={`${item.at}-${i}`}>
              <div>
                <div className="orders__date">
                  <span className={`src src--${(item.source ?? 'cup').toLowerCase()}`}>{item.source}</span> {formatDateTime(item.at)}
                </div>
                <div className="hint">
                  {item.branchName ?? 'Filial aniqlanmagan'}
                  {item.status ? ` · ${statusLabel(item.status)}` : ''}
                </div>
                {item.lines.length > 0 && <div className="hint">{lineSummary(item.lines)}</div>}
              </div>
              <div className="orders__total">{item.amountMinor === null ? '' : formatSom(item.amountMinor)}</div>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="error-text">{error}</p>}
      {next && (
        <button className="button button--secondary" disabled={busy} onClick={more} type="button">
          {busy ? 'Yuklanmoqda…' : 'Ko‘proq ko‘rsatish'}
        </button>
      )}
    </section>
  );
}

export function ReferralCard({ referral }: { referral: CustomerProfile['referral'] }) {
  const empty = !referral.referralCode && !referral.referredBy && referral.invited.successful + referral.invited.pending === 0;
  return (
    <section className="block">
      <div className="eyebrow">Do‘st taklif qilish</div>
      {empty ? (
        <p className="hint">Taklif ma‘lumotlari yo‘q.</p>
      ) : (
        <>
          {referral.referralCode && <p className="referral-code">{referral.referralCode}</p>}
          <dl className="facts">
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
            <p className="hint">
              Bu mijoz taklif orqali kelgan: {REFERRAL_STATUS_LABELS[referral.referredBy.status] ?? referral.referredBy.status}
              {referral.referredBy.at ? ` (${formatDate(referral.referredBy.at)})` : ''}.
            </p>
          )}
        </>
      )}
    </section>
  );
}
