import { FormEvent, useState } from 'react';
import { LifecycleBadge } from '../components/ProfileCards';
import { ApiError, toUserMessage } from '../lib/api';
import { daysAgo } from '../lib/format';
import { openCustomer } from '../lib/route';
import { searchCustomers, SearchResult } from '../lib/staffApi';
import { Badge, Button } from '../components/ui';

// Customer Search 2.0: name, phone (any format), Telegram @username or CUP code. At most 20 rows, each with the level, lifecycle and last purchase.
export function CustomersPage({ onSessionExpired }: { onSessionExpired: () => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setResults(await searchCustomers(query.trim()));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return onSessionExpired();
      setResults(null);
      setError(err instanceof ApiError && err.status === 400 ? 'Kamida 3 ta belgi kiriting (ko‘pi bilan 100).' : toUserMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-col gap-5 px-4 pt-5 pb-8">
      <h1 className="font-display text-[30px] font-medium">Mijozlar</h1>
      <form className="my-2 flex flex-col gap-3" onSubmit={run}>
        <label className="flex flex-col gap-1.5 text-[14px] font-semibold">
          <span>Ism, telefon, @telegram yoki CUP kodi</span>
          <input autoComplete="off" autoFocus maxLength={100} onChange={(e) => setQuery(e.target.value)} placeholder="Masalan: 90 123 45 67" type="search" value={query} />
        </label>
        <Button disabled={busy || query.trim().length < 3} type="submit" variant="primary">
          {busy ? 'Qidirilmoqda…' : 'Qidirish'}
        </Button>
      </form>

      {error && <p className="text-[14px] font-semibold text-terracotta-deep">{error}</p>}
      {results && results.length === 0 && <p className="text-[13px] text-muted">Hech narsa topilmadi.</p>}
      {results && results.length > 0 && <p className="text-[13px] text-muted">{results.length === 20 ? 'Dastlabki 20 ta natija — qidiruvni aniqlashtiring.' : `${results.length} ta natija`}</p>}
      {results?.map((r) => (
        <button className="font-[inherit] leading-[inherit] mt-2 flex min-h-12 w-full cursor-pointer flex-col gap-0.5 rounded-sm border border-line bg-white px-3.5 py-3 text-left text-[16px] font-normal" key={r.publicCode} onClick={() => openCustomer(r.publicCode)} type="button">
          <span className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold">{r.displayName ?? 'Ismsiz mijoz'}</span>
            <span className="flex flex-wrap items-center gap-1.5">
              {r.level && <Badge tone="level">{r.level}</Badge>}
              <LifecycleBadge state={r.lifecycleState} />
            </span>
          </span>
          <span className="text-[13px] text-muted">
            {r.phoneMasked ? `${r.phoneMasked} · ` : ''}
            {r.telegramUsername ? `@${r.telegramUsername} · ` : ''}
            {r.publicCode}
          </span>
          <span className="text-[13px] text-muted">Oxirgi xarid: {r.lastPurchaseAt ? daysAgo(r.daysSinceLastPurchase) : 'yo‘q'}</span>
        </button>
      ))}
    </div>
  );
}
