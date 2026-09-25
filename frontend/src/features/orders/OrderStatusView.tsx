import { useEffect, useRef, useState } from 'react';
import { Order } from '../../types/api';
import { fetchOrder } from '../../lib/api/orders';
import { formatDateTime, formatSom } from '../../lib/format';
import { getOrderStatusLabel, getOrderStatusTone, isTerminalOrderStatus } from '../../lib/orderStatusLabels';
import { StatusScreen } from '../../app/StatusScreen';
import { buttonSecondary } from '../../app/buttonStyles';
import { cx } from '../../lib/cx';

interface OrderStatusViewProps {
  orderId: string;
  onBackToMenu: () => void;
}

// Mirrors the backend's own default (ORDER_STATUS_POLL_INTERVAL_MS in .env) — not fetched from
// the backend, since no endpoint exposes it and adding one would be an unnecessary backend
// change for Phase 1.8 (spec section 36 prefers zero backend changes).
const ORDER_STATUS_POLL_INTERVAL_MS = 30_000;

// Owns its own fetch + poll lifecycle for exactly one order (spec sections 12-15). Polls
// GET /orders/:id — the same ownership-checked, authenticated endpoint Phase 1.5 already
// exposes — starting immediately on mount and stopping on unmount or once the order reaches a
// backend-defined terminal status (never assumed to be 'accepted' — see orderStatusLabels.ts).
export function OrderStatusView({ orderId, onBackToMenu }: OrderStatusViewProps) {
  const [order, setOrder] = useState<Order | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [initialLoadFailed, setInitialLoadFailed] = useState(false);
  const hasLoadedOnceRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | undefined;

    const poll = async () => {
      try {
        const fetched = await fetchOrder(orderId);
        if (cancelled) return;
        hasLoadedOnceRef.current = true;
        setOrder(fetched);
        setPollError(null);
        if (isTerminalOrderStatus(fetched.status) && intervalId !== undefined) {
          clearInterval(intervalId);
          intervalId = undefined;
        }
      } catch {
        if (cancelled) return;
        // Spec section 15: a temporary poll failure never wipes out the last known order
        // state or marks the order as failed — only a neutral, non-alarming note, and the
        // interval keeps running so the next tick can recover on its own. Only the very first
        // load (nothing displayed yet) is treated as a harder failure with a way back out.
        setPollError('Buyurtma holatini yangilashda muammo yuz berdi.');
        if (!hasLoadedOnceRef.current) {
          setInitialLoadFailed(true);
        }
      }
    };

    poll();
    intervalId = setInterval(poll, ORDER_STATUS_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (intervalId !== undefined) {
        clearInterval(intervalId);
      }
    };
  }, [orderId]);

  if (!order) {
    if (initialLoadFailed) {
      return (
        <div className="mx-auto flex min-h-dvh max-w-[560px] flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
          <StatusScreen
            title="Xatolik"
            message="Buyurtma ma'lumotlarini yuklab bo'lmadi."
            actionLabel="Menyu'ga qaytish"
            onAction={onBackToMenu}
          />
        </div>
      );
    }
    return (
      <div className="mx-auto flex min-h-dvh max-w-[560px] flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
        <StatusScreen title="Buyurtma" message="Yuklanmoqda..." isLoading />
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-[560px] flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <div className="flex flex-1 flex-col gap-6 px-4 pt-3 pb-8">
        <div className="-mx-4 flex min-h-11 items-center gap-2 px-4">
          <button className="min-h-11 cursor-pointer py-2.5 text-small font-semibold tracking-[0.02em] text-black" onClick={onBackToMenu} type="button">
            ← Menyu
          </button>
        </div>

        {/* Calm, prominent status: a serif headline, not an alert. A pulsing terracotta dot marks
            an order that is still moving; settled/dead-end statuses simply read as text. */}
        <div className="flex flex-col gap-2">
          <div className="text-micro font-bold tracking-[0.14em] text-muted uppercase">Buyurtma · {formatDateTime(order.createdAt)}</div>
          <h1 className="font-display text-title leading-[1.15] font-medium">
            {getOrderStatusTone(order.status) === 'active' && <span className="mr-2 inline-block size-2.5 animate-dot-pulse rounded-full bg-terracotta align-middle" aria-hidden="true" />}
            {getOrderStatusLabel(order.status)}
          </h1>
          {order.branch && <p className="text-small leading-[1.45] text-muted">CUP Coffee — {order.branch.name}</p>}
          {pollError && <p className="text-small leading-[1.45] text-muted">{pollError}</p>}
        </div>

        <div>
          <h2 className="font-display text-section leading-[1.2] font-medium">Buyurtma tarkibi</h2>
          <ul className="m-0 list-none p-0">
            {order.items.map((item, index) => (
              <li className="flex items-baseline justify-between gap-3 border-b border-line py-3" key={`${item.productName}-${index}`}>
                <span className="min-w-0 font-medium">
                  {item.productName} <span className="font-medium text-muted">× {item.quantity}</span>
                </span>
                <span className="shrink-0 font-semibold tabular-nums">{formatSom(item.totalPriceMinor)}</span>
              </li>
            ))}
          </ul>
          <div className="flex items-baseline justify-between gap-3 pt-4">
            <span className="text-small font-bold tracking-[0.14em] text-muted uppercase">Jami</span>
            <span className="font-display text-title font-medium whitespace-nowrap tabular-nums">{formatSom(order.totalMinor)}</span>
          </div>
        </div>

        <button className={cx(buttonSecondary, 'self-start')} onClick={onBackToMenu} type="button">
          Menyu'ga qaytish
        </button>
      </div>
    </div>
  );
}
