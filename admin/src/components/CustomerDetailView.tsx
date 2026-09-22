import { useCallback, useEffect, useState } from 'react';
import { fetchCustomer360, fetchCustomerActivity, regenerateLoyaltyCode } from '../lib/adminCustomers';
import { ApiError } from '../lib/api';
import { LIFECYCLE_LABELS, OPPORTUNITY_LABELS, SIGNAL_LABELS } from '../lib/adminGrowth';
import { formatDate, formatDateTime, formatSom } from '../lib/format';
import { REASON_LABELS } from '../lib/adminAutomations';
import { AdminCustomer360, CustomerActivityItem } from '../lib/types';

interface CustomerDetailViewProps {
  customerId: string;
  onBack: () => void;
}

const NO_BRANCH = 'Filial aniqlanmagan';
const NO_PRODUCT = "Mahsulot ma'lumoti mavjud emas";

// Friendly, non-technical wording only — never the transport/backend message (no "network_error", no stack, no Prisma text).
function friendlyError(err: unknown): string {
  if (err instanceof ApiError && err.status === 404) return 'Mijoz topilmadi.';
  return "Mijoz ma'lumotini yuklab bo'lmadi. Iltimos, qayta urinib ko'ring.";
}

// Phase 11.4 — unified Customer 360. Every figure (totals, breakdown, favorite branch, reward progress, segments,
// promotions, activity order) is calculated by the server; this page only formats and lays out what it receives.
export function CustomerDetailView({ customerId, onBack }: CustomerDetailViewProps) {
  const [data, setData] = useState<AdminCustomer360 | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // Phase 11: never automatic — the admin must confirm, and the old code (and any QR already shown or
  // printed) stops working immediately.
  const handleRegenerate = async () => {
    if (!window.confirm("Regenerate this customer's CUP code? Their current QR/barcode will stop working immediately.")) return;
    setRegenerating(true);
    setActionError(null);
    try {
      const result = await regenerateLoyaltyCode(customerId);
      setData((current) => (current ? { ...current, identity: { ...current.identity, loyaltyCode: result.loyaltyCode } } : current));
    } catch {
      setActionError("Kodni yangilab bo'lmadi. Iltimos, qayta urinib ko'ring.");
    } finally {
      setRegenerating(false);
    }
  };

  // Selecting another customer (or retrying) always clears the previous customer's figures first — stale numbers are never
  // shown under a new selection.
  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    setActionError(null);
    fetchCustomer360(customerId)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err) => {
        if (!cancelled) setError(friendlyError(err));
      });
    return () => {
      cancelled = true;
    };
  }, [customerId, reloadKey]);

  return (
    <div className="c360">
      <button className="button-secondary" onClick={onBack} type="button" style={{ marginBottom: 16 }}>
        ← Back to customers
      </button>

      {error && (
        <div className="c360__error" role="alert">
          <span>{error}</span>
          <button className="button-secondary" onClick={() => setReloadKey((k) => k + 1)} type="button">
            Retry
          </button>
        </div>
      )}
      {!data && !error && <Skeleton />}

      {data && (
        <>
          <header className="c360__header">
            <div className="c360__eyebrow">Customer</div>
            <h1 className="c360__name">{data.profile.displayName ?? 'Customer'}</h1>
            <div className="c360__chips">
              <span className="c360__chip">{data.profile.phone ?? 'Phone not provided'}</span>
              <span className="c360__chip">{data.profile.username ? `@${data.profile.username}` : 'No Telegram username'}</span>
              <span className={`c360__chip${data.identity.posterLinked ? ' c360__chip--ok' : ''}`}>{data.identity.posterLinked ? 'Poster linked' : 'Poster not linked'}</span>
              <span className="c360__chip">{data.summary.favoriteBranch ? `Favorite: ${data.summary.favoriteBranch.name}` : 'No favorite branch yet'}</span>
            </div>
          </header>

          <section className="c360__kpis">
            <Kpi label="Total spent" value={formatSom(data.summary.totalRevenueMinor)} strong />
            <Kpi label="Purchases" value={data.summary.totalPurchases.toLocaleString('ru-RU')} />
            <Kpi label="Average check" value={formatSom(data.summary.averageCheckMinor)} />
            <Kpi label="Last purchase" value={data.summary.lastPurchaseAt ? formatDate(data.summary.lastPurchaseAt) : '—'} hint={data.summary.firstPurchaseAt ? `First: ${formatDate(data.summary.firstPurchaseAt)}` : undefined} />
          </section>

          <section className="c360__grid3">
            <SourceCard label="Total" count={data.summary.totalPurchases} unit="purchases" revenue={data.summary.totalRevenueMinor} empty="Xaridlar hali mavjud emas" />
            <SourceCard label="CUP" count={data.summary.cupOrderCount} unit="orders" revenue={data.summary.cupRevenueMinor} empty="CUP buyurtmalari hali mavjud emas" />
            <SourceCard label="POS" count={data.summary.posPurchaseCount} unit="purchases" revenue={data.summary.posRevenueMinor} empty="POS xaridlari hali mavjud emas" />
          </section>

          <section className="c360__grid2">
            <div className="c360__card">
              <h2 className="c360__h2">Loyalty</h2>
              <div className="c360__stats">
                <Stat label="Balance" value={`${data.loyalty.balance.toLocaleString('ru-RU')} points`} />
                <Stat label="Lifetime earned" value={`${data.loyalty.lifetimeEarned.toLocaleString('ru-RU')}`} />
                <Stat label="Lifetime spent" value={`${data.loyalty.lifetimeSpent.toLocaleString('ru-RU')}`} />
              </div>
            </div>

            <div className="c360__card c360__card--cream">
              <h2 className="c360__h2">Rewards</h2>
              {data.rewards.length === 0 ? (
                <p className="c360__empty">Faol bonus dasturlari yo'q</p>
              ) : (
                data.rewards.map((reward) => (
                  <div className="c360__reward" key={reward.programName}>
                    <div className="c360__reward-head">
                      <span>{reward.programName}</span>
                      <strong>
                        {reward.qualifyingCount} / {reward.threshold}
                      </strong>
                    </div>
                    <div className="c360__bar" aria-hidden="true">
                      <span style={{ width: `${reward.threshold > 0 ? (reward.qualifyingCount / reward.threshold) * 100 : 0}%` }} />
                    </div>
                    <div className="c360__hint">{reward.availableRewards > 0 ? `${reward.availableRewards} reward${reward.availableRewards === 1 ? '' : 's'} available` : 'No reward available yet'}</div>
                  </div>
                ))
              )}
              {data.rewardHistory.length > 0 && (
                <div className="c360__history">
                  <div className="c360__label">Redeemed</div>
                  {data.rewardHistory.map((r) => (
                    <div className="c360__history-row" key={`${r.redeemedAt}-${r.programName}`}>
                      <span>{r.productName ? `${r.productName} × ${r.quantity}` : r.programName}</span>
                      <span className="c360__hint">{formatDate(r.redeemedAt)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          {data.membership.enabled && (
            <section className="c360__card">
              <h2 className="c360__h2">Membership</h2>
              <div className="c360__stats" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
                <Stat label="Level" value={data.membership.level ? `${data.membership.level.icon} ${data.membership.level.name}` : '—'} />
                <Stat label="Lifetime spend" value={formatSom(data.membership.lifetimeSpend)} />
                <Stat label="XP" value={data.membership.xp.lifetimeXP.toLocaleString('ru-RU')} />
                <Stat label="Cashback" value={data.membership.cashback.enabled ? formatSom(data.membership.cashback.balance) : 'Off'} />
              </div>
              <p className="c360__hint" style={{ margin: '10px 0 0' }}>
                {data.membership.nextLevel ? `${formatSom(data.membership.nextLevel.spendToNext)} to ${data.membership.nextLevel.name}` : 'Top level reached'}
                {data.membership.streak.enabled ? ` · Streak ${data.membership.streak.current} (best ${data.membership.streak.best})` : ''}
                {data.membership.cashback.enabled ? ` · Cashback earned ${formatSom(data.membership.cashback.lifetimeEarned)}` : ''}
              </p>
              <div className="c360__chips" style={{ marginTop: 10 }}>
                {data.membership.achievements.filter((a) => a.unlocked).length === 0 ? (
                  <span className="c360__empty">Yutuqlar hali ochilmagan</span>
                ) : (
                  data.membership.achievements
                    .filter((a) => a.unlocked)
                    .map((a) => (
                      <span className="c360__chip c360__chip--ok" key={a.code}>
                        {a.icon} {a.name}
                      </span>
                    ))
                )}
              </div>
            </section>
          )}

          <section className="c360__card">
            <h2 className="c360__h2">Recent activity</h2>
            {data.recentActivity.length === 0 ? <p className="c360__empty">Hozircha faollik yo'q</p> : <ol className="c360__timeline">{data.recentActivity.map((item, i) => <TimelineRow item={item} key={`${item.type}-${item.at}-${i}`} />)}</ol>}
          </section>

          <section className="c360__card">
            <h2 className="c360__h2">CRM automation activity</h2>
            {data.crmActivity.length === 0 ? (
              <p className="c360__empty">Avtomatik xabarlar hali mavjud emas</p>
            ) : (
              <ul className="c360__list">
                {data.crmActivity.map((a, i) => (
                  <li className="c360__list-row" key={`${a.at}-${i}`}>
                    <span className="c360__grow">{crmActivityText(a)}</span>
                    <span className="c360__hint">{formatDate(a.at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="c360__card">
            <h2 className="c360__h2">Growth Intelligence</h2>
            <div className="c360__stats">
              <Stat label="Lifecycle" value={data.growth.lifecycleState ? LIFECYCLE_LABELS[data.growth.lifecycleState] : 'No purchase yet'} />
              <Stat label="RFM" value={data.growth.rfm ? `${data.growth.rfm.score}  (R${data.growth.rfm.recency} F${data.growth.rfm.frequency} M${data.growth.rfm.monetary})` : '—'} />
              <Stat label="Last purchase" value={data.growth.recencyDays === null ? '—' : data.growth.recencyDays === 0 ? 'Today' : `${data.growth.recencyDays} days ago`} />
              <Stat label="Purchases (all time)" value={data.growth.lifetimePurchases.toLocaleString('ru-RU')} />
              <Stat label="Revenue (all time)" value={formatSom(data.growth.lifetimeRevenue)} />
              <Stat label={`Last ${data.growth.lookbackDays} days`} value={`${data.growth.frequency} purchases · ${formatSom(data.growth.monetary)}`} />
            </div>
            <h3 className="c360__h3" style={{ marginBottom: 6 }}>Signals</h3>
            {data.growth.signals.length === 0 ? (
              <p className="c360__empty">Hozircha signallar yo&apos;q</p>
            ) : (
              <ul className="c360__list">
                {data.growth.signals.map((s) => (
                  <li className="c360__list-row" key={s.type + s.reason}>
                    <strong>{SIGNAL_LABELS[s.type]}</strong>
                    <span className="c360__grow">{s.reason}</span>
                    <span className="c360__hint">{s.detectedAt ? formatDate(s.detectedAt) : ''}</span>
                  </li>
                ))}
              </ul>
            )}
            <h3 className="c360__h3" style={{ marginBottom: 6 }}>Opportunities</h3>
            {data.growth.opportunities.length === 0 ? (
              <p className="c360__empty">Hozircha imkoniyatlar yo&apos;q</p>
            ) : (
              <ul className="c360__list">
                {data.growth.opportunities.map((o) => (
                  <li className="c360__list-row" key={o.type}>
                    <strong>{OPPORTUNITY_LABELS[o.type]}</strong>
                    <span className="c360__grow">
                      {o.reason} <span className="c360__hint">Priority: {o.priority}. Existing tool: {o.recommended.segment}{o.recommended.automationTrigger ? ` · trigger ${o.recommended.automationTrigger}` : ''}.</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="c360__card">
            <h2 className="c360__h2">Referrals</h2>
            <div className="c360__stats">
              <Stat label="Referral code" value={data.referral.referralCode ?? '—'} />
              <Stat label="Successful referrals" value={String(data.referral.successfulReferrals)} />
              <Stat label="Pending referrals" value={String(data.referral.pendingReferrals)} />
              <Stat label="Referral points earned" value={data.referral.rewardPointsEarned.total.toLocaleString('ru-RU')} />
            </div>
            <p className="c360__hint" style={{ marginBottom: 0 }}>
              {data.referral.referredBy
                ? `Referred by ${data.referral.referredBy.referrerName ?? 'a customer'} — ${data.referral.referredBy.status}${data.referral.referredBy.at ? ` (since ${formatDate(data.referral.referredBy.at)})` : ''}.`
                : 'Not referred by another customer.'}
            </p>
          </section>

          <PurchaseActivity customerId={customerId} key={customerId} />

          <section className="c360__card">
            <h2 className="c360__h2">Loyalty activity</h2>
            {data.loyalty.recent.length === 0 ? (
              <p className="c360__empty">Bonuslar tarixi mavjud emas</p>
            ) : (
              <ul className="c360__list">
                {data.loyalty.recent.map((t) => (
                  <li className="c360__list-row" key={`${t.at}-${t.points}-${t.balanceAfter}`}>
                    <span className={`c360__points${t.points < 0 ? ' c360__points--neg' : ''}`}>{t.points > 0 ? '+' : ''}{t.points.toLocaleString('ru-RU')} points</span>
                    <span className="c360__grow">{t.description ?? t.type}</span>
                    <span className="c360__hint">{formatDate(t.at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="c360__grid2">
            <div className="c360__card">
              <h2 className="c360__h2">Promotions</h2>
              {data.promotions.length === 0 ? (
                <p className="c360__empty">Hozircha mos aksiyalar yo'q</p>
              ) : (
                <ul className="c360__list">
                  {data.promotions.map((p) => (
                    <li className="c360__list-row c360__list-row--stack" key={p.name}>
                      <strong>{p.name}</strong>
                      <span>{benefitLabel(p.benefit)}</span>
                      <span className="c360__hint">
                        {p.endsAt ? `Until ${formatDate(p.endsAt)}` : 'No end date'}
                        {p.remainingUses !== null ? ` · ${p.remainingUses} use${p.remainingUses === 1 ? '' : 's'} left` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="c360__card">
              <h2 className="c360__h2">Segments</h2>
              {data.segments.length === 0 ? (
                <p className="c360__empty">Mijoz hozircha hech qaysi segmentga kirmaydi</p>
              ) : (
                <div className="c360__chips">
                  {data.segments.map((s) => (
                    <span className="c360__chip c360__chip--ok" key={s.name} title={s.description ?? undefined}>
                      {s.name}
                    </span>
                  ))}
                </div>
              )}
              <p className="c360__hint">Segments are evaluated from CUP order data.</p>
            </div>
          </section>

          <section className="c360__card">
            <h2 className="c360__h2">Identity</h2>
            <div className="c360__list-row">
              <span>CUP code</span>
              <span className="c360__code">{data.identity.loyaltyCode ?? '—'}</span>
            </div>
            <div>
              <button className="button-secondary" disabled={regenerating} onClick={handleRegenerate} type="button">
                {regenerating ? 'Regenerating...' : 'Regenerate code'}
              </button>
            </div>
            {actionError && <p className="error-text">{actionError}</p>}
          </section>
        </>
      )}
    </div>
  );
}

const TRIGGER_TEXT: Record<string, string> = {
  FIRST_PURCHASE: 'First-purchase',
  REWARD_UNLOCKED: 'Reward notification',
  BIRTHDAY: 'Birthday',
  INACTIVE_CUSTOMER: 'Win-back',
  ABANDONED_CART: 'Abandoned-cart',
  LOYALTY_MILESTONE: 'Milestone',
  SCHEDULED_SEGMENT: 'Scheduled',
};

// Display text only; never an internal error. e.g. "Win-back automation yuborildi", "Birthday automation o'tkazib yuborildi — Cooldown".
function crmActivityText(a: AdminCustomer360['crmActivity'][number]): string {
  const base = `${TRIGGER_TEXT[a.triggerType] ?? 'CRM'} automation`;
  if (a.status === 'SENT') return `${base} yuborildi`;
  if (a.status === 'PENDING') return `${base} navbatda`;
  if (a.status === 'FAILED') return `${base} yuborilmadi`;
  return `${base} o'tkazib yuborildi${a.reason ? ` — ${REASON_LABELS[a.reason] ?? a.reason}` : ''}`;
}

function Kpi({ label, value, hint, strong }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <div className={`c360__kpi${strong ? ' c360__kpi--strong' : ''}`}>
      <div className="c360__label">{label}</div>
      <div className="c360__kpi-value">{value}</div>
      {hint && <div className="c360__hint">{hint}</div>}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="c360__label">{label}</div>
      <div className="c360__stat-value">{value}</div>
    </div>
  );
}

function SourceCard({ label, count, unit, revenue, empty }: { label: string; count: number; unit: string; revenue: number; empty: string }) {
  return (
    <div className="c360__card c360__source">
      <div className="c360__label">{label}</div>
      {count === 0 ? (
        <p className="c360__empty">{empty}</p>
      ) : (
        <>
          <div className="c360__kpi-value">{formatSom(revenue)}</div>
          <div className="c360__hint">
            {count.toLocaleString('ru-RU')} {unit}
          </div>
        </>
      )}
    </div>
  );
}

function linesSummary(item: CustomerActivityItem): string {
  if (item.lines.length === 0) return NO_PRODUCT;
  return item.lines.map((l) => `${l.productName ?? NO_PRODUCT} × ${l.quantity}${l.isReward ? ' (free reward)' : ''}`).join(', ');
}

function TimelineRow({ item }: { item: CustomerActivityItem }) {
  let title: string;
  let detail: string;
  let right: string | null = null;
  switch (item.type) {
    case 'CUP_ORDER':
      title = 'CUP order';
      detail = `${linesSummary(item)} · ${item.branchName ?? NO_BRANCH}`;
      right = item.amountMinor !== null ? formatSom(item.amountMinor) : null;
      break;
    case 'POS_PURCHASE':
      title = 'POS purchase';
      detail = `${linesSummary(item)} · ${item.branchName ?? NO_BRANCH}`;
      right = item.amountMinor !== null ? formatSom(item.amountMinor) : null;
      break;
    case 'LOYALTY':
      title = 'Loyalty';
      detail = item.label ?? '';
      right = item.points !== null ? `${item.points > 0 ? '+' : ''}${item.points.toLocaleString('ru-RU')} points` : null;
      break;
    default:
      title = 'Reward redeemed';
      detail = item.lines.length > 0 ? `${item.lines[0].productName ?? NO_PRODUCT}${item.label ? ` · ${item.label}` : ''}` : (item.label ?? '');
  }
  return (
    <li className="c360__event">
      <div className="c360__event-date">{formatDateTime(item.at)}</div>
      <div className="c360__event-body">
        <strong>{title}</strong>
        <span className="c360__hint">{detail}</span>
      </div>
      {right && <div className="c360__event-amount">{right}</div>}
    </li>
  );
}

// Cursor-paginated purchase table (CUP orders + POS purchases). Only ever holds the pages the admin has asked for.
function PurchaseActivity({ customerId }: { customerId: string }) {
  const [items, setItems] = useState<CustomerActivityItem[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    setError(null);
    fetchCustomerActivity(customerId, { filter: 'purchases' })
      .then((page) => {
        if (cancelled) return;
        setItems(page.items);
        setNextCursor(page.nextCursor);
      })
      .catch(() => {
        if (!cancelled) setError("Xaridlar tarixini yuklab bo'lmadi.");
      });
    return () => {
      cancelled = true;
    };
  }, [customerId, reloadKey]);

  const loadMore = useCallback(async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    setError(null);
    try {
      const page = await fetchCustomerActivity(customerId, { filter: 'purchases', cursor: nextCursor });
      setItems((current) => [...(current ?? []), ...page.items]);
      setNextCursor(page.nextCursor);
    } catch {
      setError("Yana yuklab bo'lmadi.");
    } finally {
      setLoadingMore(false);
    }
  }, [customerId, nextCursor]);

  return (
    <section className="c360__card">
      <h2 className="c360__h2">Purchase activity</h2>
      {error && (
        <div className="c360__error" role="alert">
          <span>{error}</span>
          <button className="button-secondary" onClick={() => (items ? loadMore() : setReloadKey((k) => k + 1))} type="button">
            Retry
          </button>
        </div>
      )}
      {items === null && !error && <div className="c360__skeleton" style={{ height: 120 }} />}
      {items !== null && items.length === 0 && <p className="c360__empty">Xaridlar hali mavjud emas</p>}
      {items !== null && items.length > 0 && (
        <>
          <div className="c360__scroll">
            <table className="data-table c360__table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Source</th>
                  <th>Branch</th>
                  <th>Items</th>
                  <th className="c360__num">Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => (
                  <tr key={`${item.type}-${item.at}-${i}`}>
                    <td>{formatDateTime(item.at)}</td>
                    <td>
                      <span className={`c360__badge c360__badge--${item.source === 'POS' ? 'pos' : 'cup'}`}>{item.source}</span>
                    </td>
                    <td>{item.branchName ?? NO_BRANCH}</td>
                    <td>{linesSummary(item)}</td>
                    <td className="c360__num">{item.amountMinor !== null ? formatSom(item.amountMinor) : '—'}</td>
                    <td>{item.status ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {nextCursor && (
            <div style={{ marginTop: 12 }}>
              <button className="button-secondary" disabled={loadingMore} onClick={loadMore} type="button">
                {loadingMore ? 'Loading...' : 'Load more'}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

// Display formatting of a promotion's benefit as returned by the server (no eligibility logic here).
function benefitLabel(benefit: AdminCustomer360['promotions'][number]['benefit']): string {
  switch (benefit.type) {
    case 'PERCENT_DISCOUNT':
      return `${benefit.value ?? 0}% discount`;
    case 'FIXED_DISCOUNT':
      return `${formatSom(benefit.value ?? 0)} discount`;
    case 'FREE_PRODUCT':
      return `Free ${benefit.productName ?? 'product'}${benefit.quantity && benefit.quantity > 1 ? ` × ${benefit.quantity}` : ''}`;
    case 'LOYALTY_POINTS':
      return `+${(benefit.value ?? 0).toLocaleString('ru-RU')} loyalty points`;
    default:
      return 'Benefit';
  }
}

function Skeleton() {
  return (
    <div aria-busy="true">
      <div className="c360__skeleton" style={{ height: 72, width: '55%' }} />
      <div className="c360__kpis">
        {[0, 1, 2, 3].map((n) => (
          <div className="c360__skeleton" key={n} style={{ height: 86 }} />
        ))}
      </div>
      <div className="c360__skeleton" style={{ height: 160, marginTop: 16 }} />
    </div>
  );
}
