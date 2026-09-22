import { useCallback, useEffect, useState } from 'react';
import { LifecycleBadge } from '../components/ProfileCards';
import { ApiError, toUserMessage } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { openCustomer } from '../lib/route';
import { fetchRecent, RecentCustomer } from '../lib/staffApi';

// The customers THIS staff member looked at most recently (from their own audit trail) — survives a reload or a tablet change.
export function RecentPage({ onSessionExpired }: { onSessionExpired: () => void }) {
  const [items, setItems] = useState<RecentCustomer[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setItems(null);
    setError(null);
    fetchRecent()
      .then(setItems)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) return onSessionExpired();
        setError(toUserMessage(err));
      });
  }, [onSessionExpired]);

  useEffect(load, [load]);

  return (
    <div className="scan">
      <h1 className="scan__title">So‘nggi mijozlar</h1>
      {error && (
        <>
          <p className="error-text">{error}</p>
          <button className="button button--secondary" onClick={load} type="button">
            Qayta urinish
          </button>
        </>
      )}
      {!items && !error && <p className="hint">Yuklanmoqda…</p>}
      {items && items.length === 0 && <p className="hint">Hozircha ko‘rilgan mijozlar yo‘q.</p>}
      {items?.map((r) => (
        <button className="result" key={r.publicCode} onClick={() => openCustomer(r.publicCode)} type="button">
          <span className="result__top">
            <span className="result__name">{r.displayName ?? 'Ismsiz mijoz'}</span>
            <LifecycleBadge state={r.lifecycleState} />
          </span>
          <span className="hint">
            {r.phoneMasked ? `${r.phoneMasked} · ` : ''}
            {r.publicCode}
          </span>
          <span className="hint">Ko‘rilgan: {formatDateTime(r.viewedAt)}</span>
        </button>
      ))}
    </div>
  );
}
