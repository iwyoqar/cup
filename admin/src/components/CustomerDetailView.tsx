import { ReactNode, useCallback, useEffect, useState } from 'react';
import { deactivateCustomer, fetchCustomer360, fetchCustomerActivity, regenerateLoyaltyCode } from '../lib/adminCustomers';
import { ApiError } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { LIFECYCLE_LABELS, OPPORTUNITY_LABELS, SIGNAL_LABELS } from '../lib/adminGrowth';
import { formatDate, formatDateTime, formatSom } from '../lib/format';
import { REASON_LABELS } from '../lib/adminAutomations';
import { AdminCustomer360, CustomerActivityItem } from '../lib/types';
import { Button, Column, ConfirmDialog, DataTable, EmptyState, ErrorState, KeyValue, LoadingState, SectionCard, StatCard, StatGrid, StatusBadge, TabItem, Tabs } from '../ui';

interface CustomerDetailViewProps {
  customerId: string;
  onBack: () => void;
  /** Phase 26: called after a successful deactivation, so the caller can navigate away and refresh its own list. */
  onDeactivated?: () => void;
  /** Reports (Phase D1) open Customer 360 for viewing only: hides the two write actions below. Default false keeps the Customers page unchanged. */
  readOnly?: boolean;
  /** Label of the back button; defaults to the Customers page wording. */
  backLabel?: string;
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
export function CustomerDetailView({ customerId, onBack, onDeactivated, readOnly = false, backLabel }: CustomerDetailViewProps) {
  const [data, setData] = useState<AdminCustomer360 | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [confirmingDeactivate, setConfirmingDeactivate] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);
  const [tab, setTab] = useState<C360Tab>('overview');

  // Phase 26: soft delete only (Customer.isActive = false) — no order/loyalty/reward/referral
  // history, and no Poster mapping, is ever touched or reversed.
  const handleDeactivate = async () => {
    setDeactivating(true);
    setDeactivateError(null);
    try {
      await deactivateCustomer(customerId);
      setConfirmingDeactivate(false);
      onDeactivated?.();
    } catch (err) {
      setDeactivateError(errorMessage(err, "Mijozni o'chirib bo'lmadi. Qayta urinib ko'ring."));
    } finally {
      setDeactivating(false);
    }
  };

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
    <div className="flex flex-col gap-5">
      <div>
        <Button className="-ml-3" onClick={onBack} size="sm" variant="ghost">
          ← {backLabel ?? 'Back to customers'}
        </Button>
      </div>

      {error && <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} title="Customer could not be loaded" />}
      {!data && !error && <LoadingState label="Loading customer" variant="page" />}

      {data && (
        <>
          <ProfileHeader data={data} />

          <StatGrid>
            <StatCard label="Total spent" strong value={formatSom(data.summary.totalRevenueMinor)} />
            <StatCard label="Purchases" value={data.summary.totalPurchases.toLocaleString('ru-RU')} />
            <StatCard label="Average check" value={formatSom(data.summary.averageCheckMinor)} />
            <StatCard hint={data.summary.firstPurchaseAt ? `First: ${formatDate(data.summary.firstPurchaseAt)}` : undefined} label="Last purchase" value={data.summary.lastPurchaseAt ? formatDate(data.summary.lastPurchaseAt) : '—'} />
          </StatGrid>

          <Tabs active={tab} label="Customer sections" onChange={setTab} tabs={TABS} />

          <div className="flex animate-fade-in flex-col gap-5" key={tab}>
            {tab === 'overview' && (
              <>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <SourceCard count={data.summary.totalPurchases} empty="Xaridlar hali mavjud emas" label="All purchases" revenue={data.summary.totalRevenueMinor} unit="purchases" />
                  <SourceCard count={data.summary.cupOrderCount} empty="CUP buyurtmalari hali mavjud emas" label="CUP orders" revenue={data.summary.cupRevenueMinor} unit="orders" />
                  <SourceCard count={data.summary.posPurchaseCount} empty="POS xaridlari hali mavjud emas" label="POS purchases" revenue={data.summary.posRevenueMinor} unit="purchases" />
                </div>
                <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                  <LoyaltyCard data={data} />
                  <RewardsCard data={data} />
                </div>
                <SectionCard description="Orders, POS purchases, loyalty and rewards — newest first." title="Recent activity">
                  {data.recentActivity.length === 0 ? (
                    <Empty text="Hozircha faollik yo'q" />
                  ) : (
                    <ol className="m-0 flex list-none flex-col p-0">
                      {data.recentActivity.map((item, i) => (
                        <TimelineRow item={item} key={`${item.type}-${item.at}-${i}`} />
                      ))}
                    </ol>
                  )}
                </SectionCard>
              </>
            )}

            {tab === 'purchases' && <PurchaseActivity customerId={customerId} key={customerId} />}

            {tab === 'loyalty' && (
              <>
                <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                  <LoyaltyCard data={data} />
                  <RewardsCard data={data} />
                </div>
                {data.membership.enabled && (
                  <SectionCard title="Membership">
                    <StatRow
                      items={[
                        { label: 'Level', value: data.membership.level ? `${data.membership.level.icon} ${data.membership.level.name}` : '—' },
                        { label: 'Lifetime spend', value: formatSom(data.membership.lifetimeSpend) },
                        { label: 'XP', value: data.membership.xp.lifetimeXP.toLocaleString('ru-RU') },
                        { label: 'Cashback', value: data.membership.cashback.enabled ? formatSom(data.membership.cashback.balance) : 'Off' },
                      ]}
                    />
                    <p className="text-[13px] leading-snug text-muted mt-3">
                      {data.membership.nextLevel ? `${formatSom(data.membership.nextLevel.spendToNext)} to ${data.membership.nextLevel.name}` : 'Top level reached'}
                      {data.membership.streak.enabled ? ` · Streak ${data.membership.streak.current} (best ${data.membership.streak.best})` : ''}
                      {data.membership.cashback.enabled ? ` · Cashback earned ${formatSom(data.membership.cashback.lifetimeEarned)}` : ''}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {data.membership.achievements.filter((a) => a.unlocked).length === 0 ? (
                        <Empty text="Yutuqlar hali ochilmagan" />
                      ) : (
                        data.membership.achievements
                          .filter((a) => a.unlocked)
                          .map((a) => (
                            <StatusBadge key={a.code} tone="ok">
                              {a.icon} {a.name}
                            </StatusBadge>
                          ))
                      )}
                    </div>
                  </SectionCard>
                )}
                <SectionCard title="Loyalty activity">
                  {data.loyalty.recent.length === 0 ? (
                    <Empty text="Bonuslar tarixi mavjud emas" />
                  ) : (
                    <ListRows>
                      {data.loyalty.recent.map((t) => (
                        <ListRow key={`${t.at}-${t.points}-${t.balanceAfter}`} meta={formatDate(t.at)}>
                          <span className={t.points < 0 ? 'font-semibold text-err' : 'font-semibold text-ok'}>
                            {t.points > 0 ? '+' : ''}
                            {t.points.toLocaleString('ru-RU')} points
                          </span>
                          <span className="text-muted">{t.description ?? t.type}</span>
                        </ListRow>
                      ))}
                    </ListRows>
                  )}
                </SectionCard>
              </>
            )}

            {tab === 'growth' && (
              <SectionCard description="Current state from Growth Intelligence (as of today)." title="Growth Intelligence">
                <StatRow
                  items={[
                    { label: 'Lifecycle', value: data.growth.lifecycleState ? LIFECYCLE_LABELS[data.growth.lifecycleState] : 'No purchase yet' },
                    { label: 'RFM', value: data.growth.rfm ? `${data.growth.rfm.score}  (R${data.growth.rfm.recency} F${data.growth.rfm.frequency} M${data.growth.rfm.monetary})` : '—' },
                    { label: 'Last purchase', value: data.growth.recencyDays === null ? '—' : data.growth.recencyDays === 0 ? 'Today' : `${data.growth.recencyDays} days ago` },
                    { label: 'Purchases (all time)', value: data.growth.lifetimePurchases.toLocaleString('ru-RU') },
                    { label: 'Revenue (all time)', value: formatSom(data.growth.lifetimeRevenue) },
                    { label: `Last ${data.growth.lookbackDays} days`, value: `${data.growth.frequency} purchases · ${formatSom(data.growth.monetary)}` },
                  ]}
                />
                <SubHeading>Signals</SubHeading>
                {data.growth.signals.length === 0 ? (
                  <Empty text="Hozircha signallar yo'q" />
                ) : (
                  <ListRows>
                    {data.growth.signals.map((s) => (
                      <ListRow key={s.type + s.reason} meta={s.detectedAt ? formatDate(s.detectedAt) : ''}>
                        <strong>{SIGNAL_LABELS[s.type]}</strong>
                        <span className="text-muted">{s.reason}</span>
                      </ListRow>
                    ))}
                  </ListRows>
                )}
                <SubHeading>Opportunities</SubHeading>
                {data.growth.opportunities.length === 0 ? (
                  <Empty text="Hozircha imkoniyatlar yo'q" />
                ) : (
                  <ListRows>
                    {data.growth.opportunities.map((o) => (
                      <ListRow key={o.type} meta={<StatusBadge tone={o.priority === 'HIGH' ? 'err' : o.priority === 'MEDIUM' ? 'warn' : 'neutral'}>{o.priority}</StatusBadge>}>
                        <strong>{OPPORTUNITY_LABELS[o.type]}</strong>
                        <span className="text-muted">
                          {o.reason} Existing tool: {o.recommended.segment}
                          {o.recommended.automationTrigger ? ` · trigger ${o.recommended.automationTrigger}` : ''}.
                        </span>
                      </ListRow>
                    ))}
                  </ListRows>
                )}
              </SectionCard>
            )}

            {tab === 'marketing' && (
              <>
                <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                  <SectionCard title="Promotions">
                    {data.promotions.length === 0 ? (
                      <Empty text="Hozircha mos aksiyalar yo'q" />
                    ) : (
                      <ListRows>
                        {data.promotions.map((p) => (
                          <ListRow key={p.name} meta={`${p.endsAt ? `Until ${formatDate(p.endsAt)}` : 'No end date'}${p.remainingUses !== null ? ` · ${p.remainingUses} use${p.remainingUses === 1 ? '' : 's'} left` : ''}`}>
                            <strong>{p.name}</strong>
                            <span className="text-muted">{benefitLabel(p.benefit)}</span>
                          </ListRow>
                        ))}
                      </ListRows>
                    )}
                  </SectionCard>
                  <SectionCard description="Segments are evaluated from CUP order data." title="Segments">
                    {data.segments.length === 0 ? (
                      <Empty text="Mijoz hozircha hech qaysi segmentga kirmaydi" />
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {data.segments.map((s) => (
                          <span className="inline-flex items-center rounded-full bg-cream-soft px-3 py-1 text-[13px] font-semibold ring-1 ring-cream" key={s.name} title={s.description ?? undefined}>
                            {s.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </SectionCard>
                </div>
                <SectionCard title="Referrals">
                  <StatRow
                    items={[
                      { label: 'Referral code', value: data.referral.referralCode ?? '—' },
                      { label: 'Successful referrals', value: String(data.referral.successfulReferrals) },
                      { label: 'Pending referrals', value: String(data.referral.pendingReferrals) },
                      { label: 'Referral points earned', value: data.referral.rewardPointsEarned.total.toLocaleString('ru-RU') },
                    ]}
                  />
                  <p className="text-[13px] leading-snug text-muted mt-3">
                    {data.referral.referredBy
                      ? `Referred by ${data.referral.referredBy.referrerName ?? 'a customer'} — ${data.referral.referredBy.status}${data.referral.referredBy.at ? ` (since ${formatDate(data.referral.referredBy.at)})` : ''}.`
                      : 'Not referred by another customer.'}
                  </p>
                </SectionCard>
                <SectionCard title="CRM automation activity">
                  {data.crmActivity.length === 0 ? (
                    <Empty text="Avtomatik xabarlar hali mavjud emas" />
                  ) : (
                    <ListRows>
                      {data.crmActivity.map((a, i) => (
                        <ListRow key={`${a.at}-${i}`} meta={formatDate(a.at)}>
                          <span>{crmActivityText(a)}</span>
                        </ListRow>
                      ))}
                    </ListRows>
                  )}
                </SectionCard>
              </>
            )}

            {tab === 'identity' && (
              <SectionCard title="Identity">
                <KeyValue
                  rows={[
                    { key: 'code', label: 'CUP code', value: <span className="rounded-sm bg-canvas px-2 py-1 font-mono text-sm tracking-wider ring-1 ring-line">{data.identity.loyaltyCode ?? '—'}</span> },
                    { key: 'phone', label: 'Phone', value: data.profile.phone ?? 'Not provided' },
                    { key: 'tg', label: 'Telegram', value: data.profile.username ? `@${data.profile.username}` : 'No username' },
                    { key: 'poster', label: 'Poster', value: data.identity.posterLinked ? 'Linked' : 'Not linked' },
                  ]}
                />
                {!readOnly && (
                  <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-4">
                    <Button disabled={regenerating} onClick={handleRegenerate} variant="secondary">
                      {regenerating ? 'Regenerating...' : 'Regenerate code'}
                    </Button>
                    {/* text-err!: Button's ghost variant already sets text-muted; cx() doesn't merge conflicting
                        utilities, so `!` makes this override deterministic (see Button.tsx's sizing() comment). */}
                    <Button className="text-err!" onClick={() => setConfirmingDeactivate(true)} variant="ghost">
                      Deactivate customer
                    </Button>
                  </div>
                )}
                {actionError && <p className="mt-3 text-[13px] font-semibold text-err">{actionError}</p>}
              </SectionCard>
            )}
          </div>
        </>
      )}

      {confirmingDeactivate && (
        <ConfirmDialog
          busy={deactivating}
          confirmLabel="Deactivate"
          error={deactivateError}
          message="This customer will be removed from the active customer list and search. Their historical orders, loyalty activity and any linked Poster identity are retained — this cannot be undone from the Admin panel."
          onCancel={() => {
            setConfirmingDeactivate(false);
            setDeactivateError(null);
          }}
          onConfirm={handleDeactivate}
          tone="danger"
          title="Deactivate this customer?"
        />
      )}
    </div>
  );
}

type C360Tab = 'overview' | 'purchases' | 'loyalty' | 'growth' | 'marketing' | 'identity';
const TABS: TabItem<C360Tab>[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'purchases', label: 'Purchases' },
  { id: 'loyalty', label: 'Loyalty & rewards' },
  { id: 'growth', label: 'Growth' },
  { id: 'marketing', label: 'Marketing' },
  { id: 'identity', label: 'Identity' },
];

function ProfileHeader({ data }: { data: AdminCustomer360 }) {
  const name = data.profile.displayName ?? 'Customer';
  const chip = 'inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-[13px] text-muted-cream ring-1 ring-line';
  return (
    <header className="flex flex-wrap items-center gap-5 rounded-lg border border-line bg-white p-6">
      <span aria-hidden="true" className="grid size-16 shrink-0 place-items-center rounded-full bg-black font-display text-2xl text-cream uppercase">
        {name.slice(0, 1)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-semibold tracking-[0.12em] text-terracotta-deep uppercase">Customer</div>
        <h1 className="mt-0.5 font-display text-[30px] leading-tight font-medium">{name}</h1>
        <div className="mt-3 flex flex-wrap gap-2">
          <span className={chip}>{data.profile.phone ?? 'Phone not provided'}</span>
          <span className={chip}>{data.profile.username ? `@${data.profile.username}` : 'No Telegram username'}</span>
          <span className={data.identity.posterLinked ? 'inline-flex items-center rounded-full bg-ok-bg px-3 py-1 text-[13px] font-semibold text-ok' : chip}>{data.identity.posterLinked ? 'Poster linked' : 'Poster not linked'}</span>
          <span className={chip}>{data.summary.favoriteBranch ? `Favorite: ${data.summary.favoriteBranch.name}` : 'No favorite branch yet'}</span>
        </div>
      </div>
      {data.growth.lifecycleState && (
        <div className="text-right">
          <div className="text-[11px] font-semibold tracking-[0.08em] text-muted uppercase">Current lifecycle</div>
          <div className="mt-1">
            <StatusBadge tone="info">{LIFECYCLE_LABELS[data.growth.lifecycleState]}</StatusBadge>
          </div>
        </div>
      )}
    </header>
  );
}

function LoyaltyCard({ data }: { data: AdminCustomer360 }) {
  return (
    <SectionCard title="Loyalty">
      <StatRow
        items={[
          { label: 'Balance', value: `${data.loyalty.balance.toLocaleString('ru-RU')} points` },
          { label: 'Lifetime earned', value: data.loyalty.lifetimeEarned.toLocaleString('ru-RU') },
          { label: 'Lifetime spent', value: data.loyalty.lifetimeSpent.toLocaleString('ru-RU') },
        ]}
      />
    </SectionCard>
  );
}

function RewardsCard({ data }: { data: AdminCustomer360 }) {
  return (
    <SectionCard title="Rewards" tone="cream">
      {data.rewards.length === 0 ? (
        <Empty text="Faol bonus dasturlari yo'q" />
      ) : (
        <div className="flex flex-col gap-4">
          {data.rewards.map((reward) => (
            <div key={reward.programName}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="font-semibold">{reward.programName}</span>
                <span className="font-display text-lg tabular-nums">
                  {reward.qualifyingCount} / {reward.threshold}
                </span>
              </div>
              <div aria-hidden="true" className="mt-2 h-2 overflow-hidden rounded-full bg-white">
                <div className="h-full rounded-full bg-terracotta transition-[width] duration-500 ease-out" style={{ width: `${reward.threshold > 0 ? Math.min(100, (reward.qualifyingCount / reward.threshold) * 100) : 0}%` }} />
              </div>
              <div className="mt-1.5 text-xs text-muted-cream">{reward.availableRewards > 0 ? `${reward.availableRewards} reward${reward.availableRewards === 1 ? '' : 's'} available` : 'No reward available yet'}</div>
            </div>
          ))}
        </div>
      )}
      {data.rewardHistory.length > 0 && (
        <div className="mt-4 border-t border-cream pt-3">
          <div className="mb-1 text-[11px] font-semibold tracking-[0.08em] text-muted-cream uppercase">Redeemed</div>
          {data.rewardHistory.map((r) => (
            <div className="flex justify-between gap-3 py-1 text-[13px]" key={`${r.redeemedAt}-${r.programName}`}>
              <span>{r.productName ? `${r.productName} × ${r.quantity}` : r.programName}</span>
              <span className="text-muted-cream">{formatDate(r.redeemedAt)}</span>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function StatRow({ items }: { items: { label: string; value: string }[] }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-x-6 gap-y-4">
      {items.map((i) => (
        <div className="min-w-0" key={i.label}>
          <div className="text-[11px] font-semibold tracking-[0.08em] text-muted uppercase">{i.label}</div>
          <div className="mt-1 text-[15px] font-semibold [overflow-wrap:anywhere]">{i.value}</div>
        </div>
      ))}
    </div>
  );
}

function SubHeading({ children }: { children: ReactNode }) {
  return <h3 className="mt-6 mb-2 text-[11px] font-semibold tracking-[0.1em] text-muted uppercase">{children}</h3>;
}

function ListRows({ children }: { children: ReactNode }) {
  return <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">{children}</ul>;
}

function ListRow({ children, meta }: { children: ReactNode; meta?: ReactNode }) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 py-2.5 text-sm first:pt-0 last:pb-0">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">{children}</div>
      {meta && <div className="shrink-0 text-[13px] text-muted">{meta}</div>}
    </li>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="m-0 text-[13px] text-muted">{text}</p>;
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

function SourceCard({ label, count, unit, revenue, empty }: { label: string; count: number; unit: string; revenue: number; empty: string }) {
  return (
    <div className="rounded-lg border border-line bg-white p-5">
      <div className="text-[11px] font-semibold tracking-[0.08em] text-muted uppercase">{label}</div>
      {count === 0 ? (
        <p className="mt-2 mb-0 text-[13px] text-muted">{empty}</p>
      ) : (
        <>
          <div className="mt-2 font-display text-2xl tabular-nums">{formatSom(revenue)}</div>
          <div className="mt-1 text-xs text-muted">
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
  const dot = item.type === 'CUP_ORDER' ? 'bg-black' : item.type === 'POS_PURCHASE' ? 'bg-muted' : item.type === 'LOYALTY' ? 'bg-ok' : 'bg-terracotta';
  return (
    <li className="group/tl relative grid grid-cols-[auto_minmax(0,1fr)_auto] gap-x-4 pb-4 pl-5 last:pb-0">
      <span aria-hidden="true" className="absolute top-1.5 bottom-0 left-[3px] w-px bg-line group-last/tl:hidden" />
      <span aria-hidden="true" className={`absolute top-1.5 left-0 size-2 rounded-full ring-4 ring-white ${dot}`} />
      <div className="col-span-3 text-xs text-muted sm:col-span-1 sm:w-36">{formatDateTime(item.at)}</div>
      <div className="col-span-2 min-w-0 sm:col-span-1">
        <div className="text-sm font-semibold">{title}</div>
        <div className="text-[13px] text-muted">{detail}</div>
      </div>
      {right ? <div className="text-sm font-semibold whitespace-nowrap tabular-nums">{right}</div> : <div />}
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

  const columns: Column<CustomerActivityItem>[] = [
    { key: 'd', header: 'Date', cell: (item) => formatDateTime(item.at) },
    { key: 's', header: 'Source', cell: (item) => <StatusBadge tone={item.source === 'POS' ? 'neutral' : 'info'}>{item.source}</StatusBadge> },
    { key: 'b', header: 'Branch', low: true, cell: (item) => item.branchName ?? NO_BRANCH },
    { key: 'i', header: 'Items', cell: (item) => <span className="text-muted">{linesSummary(item)}</span> },
    { key: 'a', header: 'Amount', numeric: true, cell: (item) => (item.amountMinor !== null ? formatSom(item.amountMinor) : '—') },
    { key: 'st', header: 'Status', low: true, cell: (item) => item.status ?? '—' },
  ];
  return (
    <SectionCard description="CUP orders and POS purchases, newest first." flush title="Purchase activity">
      {error && (
        <div className="p-4">
          <ErrorState message={error} onRetry={() => (items ? loadMore() : setReloadKey((k) => k + 1))} title="Purchases could not be loaded" />
        </div>
      )}
      {items === null && !error && <LoadingState variant="table" />}
      {items !== null && (
        <DataTable columns={columns} empty={<EmptyState text="Xaridlar hali mavjud emas" title="No purchases yet" variant="inline" />} rowKey={(item) => `${item.type}-${item.at}-${item.source}-${item.amountMinor}`} rows={items} />
      )}
      {items !== null && nextCursor && (
        <div className="border-t border-line px-4 py-3">
          <Button loading={loadingMore} onClick={loadMore} size="sm" variant="secondary">
            {loadingMore ? 'Loading...' : 'Load more'}
          </Button>
        </div>
      )}
    </SectionCard>
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
