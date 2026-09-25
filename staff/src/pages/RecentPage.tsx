import { useCallback, useEffect, useState } from 'react';
import { LifecycleBadge } from '../components/ProfileCards';
import { ApiError, toUserMessage } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { openCustomer } from '../lib/route';
import { fetchRecent, RecentCustomer } from '../lib/staffApi';
import { Button } from '../components/ui';

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
    <div className="mx-auto flex w-full max-w-[560px] flex-col gap-5 px-4 pt-5 pb-8">
      <h1 className="font-display text-[30px] font-medium">So‘nggi mijozlar</h1>
      {error && (
        <>
          <p className="text-[14px] font-semibold text-terracotta-deep">{error}</p>
          <Button onClick={load} variant="secondary">
            Qayta urinish
          </Button>
        </>
      )}
      {!items && !error && <p className="text-[13px] text-muted">Yuklanmoqda…</p>}
      {items && items.length === 0 && <p className="text-[13px] text-muted">Hozircha ko‘rilgan mijozlar yo‘q.</p>}
      {items?.map((r) => (
        <button className="font-[inherit] leading-[inherit] mt-2 flex min-h-12 w-full cursor-pointer flex-col gap-0.5 rounded-sm border border-line bg-white px-3.5 py-3 text-left text-[16px] font-normal" key={r.publicCode} onClick={() => openCustomer(r.publicCode)} type="button">
          <span className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold">{r.displayName ?? 'Ismsiz mijoz'}</span>
            <LifecycleBadge state={r.lifecycleState} />
          </span>
          <span className="text-[13px] text-muted">
            {r.phoneMasked ? `${r.phoneMasked} · ` : ''}
            {r.publicCode}
          </span>
          <span className="text-[13px] text-muted">Ko‘rilgan: {formatDateTime(r.viewedAt)}</span>
        </button>
      ))}
    </div>
  );
}
