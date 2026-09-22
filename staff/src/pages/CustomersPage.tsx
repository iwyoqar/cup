import { FormEvent, useState } from 'react';
import { LifecycleBadge } from '../components/ProfileCards';
import { ApiError, toUserMessage } from '../lib/api';
import { daysAgo } from '../lib/format';
import { openCustomer } from '../lib/route';
import { searchCustomers, SearchResult } from '../lib/staffApi';

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
    <div className="scan">
      <h1 className="scan__title">Mijozlar</h1>
      <form className="search__form" onSubmit={run}>
        <label className="field">
          <span>Ism, telefon, @telegram yoki CUP kodi</span>
          <input autoComplete="off" autoFocus maxLength={100} onChange={(e) => setQuery(e.target.value)} placeholder="Masalan: 90 123 45 67" type="search" value={query} />
        </label>
        <button className="button button--primary" disabled={busy || query.trim().length < 3} type="submit">
          {busy ? 'Qidirilmoqda…' : 'Qidirish'}
        </button>
      </form>

      {error && <p className="error-text">{error}</p>}
      {results && results.length === 0 && <p className="hint">Hech narsa topilmadi.</p>}
      {results && results.length > 0 && <p className="hint">{results.length === 20 ? 'Dastlabki 20 ta natija — qidiruvni aniqlashtiring.' : `${results.length} ta natija`}</p>}
      {results?.map((r) => (
        <button className="result" key={r.publicCode} onClick={() => openCustomer(r.publicCode)} type="button">
          <span className="result__top">
            <span className="result__name">{r.displayName ?? 'Ismsiz mijoz'}</span>
            <span className="chips">
              {r.level && <span className="badge badge--level">{r.level}</span>}
              <LifecycleBadge state={r.lifecycleState} />
            </span>
          </span>
          <span className="hint">
            {r.phoneMasked ? `${r.phoneMasked} · ` : ''}
            {r.telegramUsername ? `@${r.telegramUsername} · ` : ''}
            {r.publicCode}
          </span>
          <span className="hint">Oxirgi xarid: {r.lastPurchaseAt ? daysAgo(r.daysSinceLastPurchase) : 'yo‘q'}</span>
        </button>
      ))}
    </div>
  );
}
