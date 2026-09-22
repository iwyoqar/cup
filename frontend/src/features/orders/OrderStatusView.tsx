import { useEffect, useRef, useState } from 'react';
import { Order } from '../../types/api';
import { fetchOrder } from '../../lib/api/orders';
import { formatDateTime, formatSom } from '../../lib/format';
import { getOrderStatusLabel, getOrderStatusTone, isTerminalOrderStatus } from '../../lib/orderStatusLabels';
import { StatusScreen } from '../../app/StatusScreen';

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
        <div className="app-shell">
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
      <div className="app-shell">
        <StatusScreen title="Buyurtma" message="Yuklanmoqda..." isLoading />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="screen">
        <div className="top-bar">
          <button className="top-bar__back" onClick={onBackToMenu} type="button">
            ← Menyu
          </button>
        </div>

        {/* Calm, prominent status: a serif headline, not an alert. A pulsing terracotta dot marks
            an order that is still moving; settled/dead-end statuses simply read as text. */}
        <div className="order-hero">
          <div className="eyebrow">Buyurtma · {formatDateTime(order.createdAt)}</div>
          <h1 className="order-hero__status">
            {getOrderStatusTone(order.status) === 'active' && <span className="order-hero__dot" aria-hidden="true" />}
            {getOrderStatusLabel(order.status)}
          </h1>
          {order.branch && <p className="hint-text">CUP Coffee — {order.branch.name}</p>}
          {pollError && <p className="hint-text">{pollError}</p>}
        </div>

        <div>
          <h2 className="section-title">Buyurtma tarkibi</h2>
          <ul className="receipt">
            {order.items.map((item, index) => (
              <li className="receipt__line" key={`${item.productName}-${index}`}>
                <span className="receipt__name">
                  {item.productName} <span className="receipt__qty">× {item.quantity}</span>
                </span>
                <span className="receipt__amount">{formatSom(item.totalPriceMinor)}</span>
              </li>
            ))}
          </ul>
          <div className="summary__row" style={{ paddingTop: 'var(--space-4)' }}>
            <span className="summary__label">Jami</span>
            <span className="summary__total">{formatSom(order.totalMinor)}</span>
          </div>
        </div>

        <button className="button-secondary" style={{ alignSelf: 'flex-start' }} onClick={onBackToMenu} type="button">
          Menyu'ga qaytish
        </button>
      </div>
    </div>
  );
}
