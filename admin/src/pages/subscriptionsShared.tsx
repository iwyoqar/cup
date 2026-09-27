import { useEffect, useState } from 'react';
import { CustomerDetail, CustomerRef, errorText, FAILURE_LABELS, SubPlan, SubView, subscriptionsApi, useSubscriptionsGet, SubSettings } from '../lib/adminSubscriptions';
import { formatDateTime, formatSom } from '../lib/format';
import { BadgeTone, Button, Drawer, ErrorState, Input, KeyValue, LoadingState, SectionCard, Select, StatusBadge, useToast } from '../ui';
import { num } from './reportsShared';

// Coffee Subscription — pieces shared by the six Admin → Subscriptions pages.

export function businessDate(ymd: string | null): string {
  if (!ymd) return '—';
  const [y, m, d] = ymd.split('-');
  return `${d}.${m}.${y}`;
}

export function timeOrDash(iso: string | null): string {
  return iso ? formatDateTime(iso) : '—';
}

const STATUS_TONE: Record<string, BadgeTone> = {
  ACTIVE: 'ok',
  CONFIRMED: 'ok',
  SCHEDULED: 'info',
  PENDING_PAYMENT: 'warn',
  PAYMENT_PENDING: 'warn',
  UNKNOWN: 'warn',
  POSTER_MUTATING: 'warn',
  REQUESTED: 'warn',
  PAUSED: 'neutral',
  EXPIRED: 'neutral',
  PAID: 'ok',
  CANCELLED: 'err',
  FAILED: 'err',
};

export function StatusPill({ status }: { status: string }) {
  return <StatusBadge tone={STATUS_TONE[status] ?? 'neutral'}>{status.replace(/_/g, ' ').toLowerCase()}</StatusBadge>;
}

export function CustomerCell({ c }: { c: CustomerRef }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="font-semibold text-black">{c.name ?? 'Unnamed customer'}</span>
      <span className="text-xs text-muted">{[c.code, c.phone].filter(Boolean).join(' · ') || '—'}</span>
    </span>
  );
}

export function failureText(reason: string | null): string {
  return reason ? (FAILURE_LABELS[reason] ?? reason) : '—';
}

export function usageRows(s: SubView) {
  const u = s.usage;
  return [
    { key: 'st', label: 'Status', value: <StatusPill status={s.effectiveStatus} /> },
    { key: 'pe', label: 'Period', value: `${businessDate(s.startBusinessDate)} → ${businessDate(s.endBusinessDate)}` },
    { key: 're', label: 'Remaining portions', value: `${num(u.remainingPortions)} / ${num(u.totalPortions)}` },
    { key: 'co', label: 'Consumed', value: num(u.consumedPortions) + (u.heldPortions ? ` (+${u.heldPortions} held)` : '') },
    { key: 'to', label: 'Today', value: `${u.todayUsedPortions} / ${u.dailyPortionLimit}` },
    { key: 'la', label: 'Last redemption', value: timeOrDash(u.lastRedemptionAt) },
    { key: 'ne', label: 'Next available', value: u.nextAvailableAt ? formatDateTime(u.nextAvailableAt) : 'Now' },
  ];
}

// The one customer view for subscriptions (opened from Active / Customers). Reuses the page-level primitives, not a second Customer 360:
// the full customer profile stays in Commerce → Customers. Lifecycle actions are the only writes and each is confirmed + audited server-side.
export function SubscriptionCustomerDrawer({ customerId, onClose, onChanged }: { customerId: string; onClose: () => void; onChanged?: () => void }) {
  const toast = useToast();
  const [data, setData] = useState<CustomerDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [planId, setPlanId] = useState('');
  const [note, setNote] = useState('');
  const settings = useSubscriptionsGet<SubSettings>('/settings');
  const plans = useSubscriptionsGet<SubPlan[]>('/plans');

  useEffect(() => {
    let cancelled = false;
    setError(null);
    subscriptionsApi
      .customer(customerId)
      .then((d) => !cancelled && setData(d))
      .catch((err) => !cancelled && setError(errorText(err)));
    return () => {
      cancelled = true;
    };
  }, [customerId, reloadKey]);

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      toast({ tone: 'success', title: done });
      setReloadKey((k) => k + 1);
      onChanged?.();
    } catch (err) {
      toast({ tone: 'error', title: 'Action failed', text: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  const activePlans = (plans.data ?? []).filter((p) => p.isActive);
  return (
    <Drawer onClose={onClose} title={data?.customer.name ?? 'Subscription customer'}>
      {error ? (
        <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} title="Customer could not be loaded" />
      ) : !data ? (
        <LoadingState />
      ) : (
        <div className="flex flex-col gap-5">
          <p className="m-0 text-sm text-muted">{[data.customer.code, data.customer.phone].filter(Boolean).join(' · ')}</p>

          <SectionCard title="Current subscription">
            {data.current ? (
              <>
                <div className="mb-3 font-display text-xl">{data.current.planName}</div>
                <KeyValue rows={usageRows(data.current)} />
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    disabled={busy}
                    onClick={() => {
                      const reason = window.prompt('Cancel this subscription? No refund is issued. Reason:');
                      if (reason && reason.trim().length >= 3) void act(() => subscriptionsApi.cancelSubscription(data.current!.id, reason.trim()), 'Subscription cancelled');
                    }}
                    size="sm"
                    variant="danger"
                  >
                    Cancel subscription
                  </Button>
                </div>
              </>
            ) : (
              <p className="m-0 text-sm text-muted">No running subscription.</p>
            )}
            {data.upcoming.map((u) => (
              <p className="mt-3 mb-0 text-sm" key={u.id}>
                Scheduled: <strong>{u.planName}</strong> {businessDate(u.startBusinessDate)} → {businessDate(u.endBusinessDate)}
              </p>
            ))}
          </SectionCard>

          <SectionCard description="Creates a purchase waiting for payment. No payment provider is integrated yet." title="Purchase">
            {data.pendingPurchase ? (
              <div className="flex flex-col gap-3">
                <p className="m-0 text-sm">
                  Pending: <strong>{data.pendingPurchase.planName}</strong> — {formatSom(data.pendingPurchase.amountMinor)} ({data.pendingPurchase.kind.toLowerCase()})
                </p>
                {settings.data?.manualActivationEnabled ? (
                  <div className="flex flex-col gap-2 rounded-md border-l-[3px] border-terracotta bg-cream-soft px-4 py-3 text-sm">
                    <strong>Manual activation (development / initialization only — not a payment, never revenue)</strong>
                    <Input onChange={(e) => setNote(e.target.value)} placeholder="Why is this activated without a payment?" value={note} />
                    <div className="flex flex-wrap gap-2">
                      <Button disabled={busy || note.trim().length < 3} onClick={() => void act(() => subscriptionsApi.manualActivate(data.pendingPurchase!.id, note.trim()), 'Subscription activated manually')} size="sm" variant="primary">
                        Activate manually
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="m-0 text-xs text-muted">Manual activation is disabled (SUBSCRIPTIONS_MANUAL_ACTIVATION_ENABLED). The purchase activates when a payment provider confirms it.</p>
                )}
                <Button className="self-start" disabled={busy} onClick={() => void act(() => subscriptionsApi.cancelPurchase(data.pendingPurchase!.id), 'Purchase cancelled')} size="sm" variant="secondary">
                  Cancel pending purchase
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap items-end gap-2">
                <Select aria-label="Plan" onChange={(e) => setPlanId(e.target.value)} value={planId}>
                  <option value="">Choose a plan…</option>
                  {activePlans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {formatSom(p.priceMinor)}
                    </option>
                  ))}
                </Select>
                <Button disabled={busy || !planId} onClick={() => void act(() => subscriptionsApi.createPurchase(data.customer.id, planId), 'Pending purchase created')} variant="secondary">
                  {data.current || data.upcoming.length ? 'Create renewal' : 'Create purchase'}
                </Button>
              </div>
            )}
          </SectionCard>

          <SectionCard flush title="Subscription history">
            <table className="w-full border-separate border-spacing-0 text-sm">
              <tbody>
                {data.subscriptions.length === 0 ? (
                  <tr>
                    <td className="px-5 py-4 text-muted">No subscriptions yet.</td>
                  </tr>
                ) : (
                  data.subscriptions.map((s) => (
                    <tr key={s.id}>
                      <td className="border-b border-line px-5 py-3">
                        <div className="font-semibold">{s.planName}</div>
                        <div className="text-xs text-muted">
                          {businessDate(s.startBusinessDate)} → {businessDate(s.endBusinessDate)}
                        </div>
                      </td>
                      <td className="border-b border-line px-5 py-3 text-right tabular-nums">
                        {s.usage.consumedPortions} / {s.usage.totalPortions}
                      </td>
                      <td className="border-b border-line px-5 py-3 text-right">
                        <StatusPill status={s.effectiveStatus} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </SectionCard>

          <SectionCard flush title="Purchases">
            <table className="w-full border-separate border-spacing-0 text-sm">
              <tbody>
                {data.purchases.map((p) => (
                  <tr key={p.id}>
                    <td className="border-b border-line px-5 py-3">
                      <div className="font-semibold">
                        {p.planName} · {p.kind.toLowerCase()}
                      </div>
                      <div className="text-xs text-muted">
                        {formatDateTime(p.createdAt)}
                        {p.activationSource ? ` · ${p.activationSource === 'ADMIN_MANUAL' ? 'manual activation' : `paid via ${p.provider ?? 'provider'}`}` : ''}
                      </div>
                    </td>
                    <td className="border-b border-line px-5 py-3 text-right tabular-nums">{formatSom(p.amountMinor)}</td>
                    <td className="border-b border-line px-5 py-3 text-right">
                      <StatusPill status={p.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </SectionCard>

          <SectionCard flush title="Recent redemptions">
            <table className="w-full border-separate border-spacing-0 text-sm">
              <tbody>
                {data.redemptions.length === 0 ? (
                  <tr>
                    <td className="px-5 py-4 text-muted">No redemptions yet.</td>
                  </tr>
                ) : (
                  data.redemptions.map((r) => (
                    <tr key={r.id}>
                      <td className="border-b border-line px-5 py-3">
                        <div className="font-semibold">{r.productName}</div>
                        <div className="text-xs text-muted">
                          {formatDateTime(r.at)} · {r.branchName ?? '—'}
                          {r.status === 'FAILED' ? ` · ${failureText(r.failureReason)}` : ''}
                        </div>
                      </td>
                      <td className="border-b border-line px-5 py-3 text-right tabular-nums">−{r.portionCost}</td>
                      <td className="border-b border-line px-5 py-3 text-right">
                        <StatusPill status={r.status} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </SectionCard>
        </div>
      )}
    </Drawer>
  );
}
