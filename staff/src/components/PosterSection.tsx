import { useState } from 'react';
import { ApiError, toUserMessage } from '../lib/api';
import { fetchPosterCandidates, linkPosterClient, PosterCandidates } from '../lib/staffApi';
import { Button } from './ui';
import { cx } from '../lib/cx';

interface PosterSectionProps {
  publicCode: string;
  phoneLast4: string | null;
  state: 'LINKED' | 'NOT_LINKED';
  onLinked: () => void;
}

// Poster association. What CUP can do today (verified against the real Poster API, read-only): find Poster
// customers by the customer's exact phone and record the match. What it CANNOT do from here: switch the
// customer selected in the Poster POS terminal — see the "kassada" instruction below.
export function PosterSection({ publicCode, phoneLast4, state, onLinked }: PosterSectionProps) {
  const [busy, setBusy] = useState(false);
  const [candidates, setCandidates] = useState<PosterCandidates | null>(null);
  const [error, setError] = useState<string | null>(null);

  const findMatches = async () => {
    setBusy(true);
    setError(null);
    try {
      setCandidates(await fetchPosterCandidates(publicCode));
    } catch (err) {
      setError(toUserMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const link = async (choice: string) => {
    setBusy(true);
    setError(null);
    try {
      await linkPosterClient(publicCode, choice);
      onLinked();
    } catch (err) {
      setError(err instanceof ApiError && err.status === 409 ? err.backendMessage : toUserMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-2 rounded-md border border-line p-4">
      <div className="text-[11px] font-bold tracking-[0.14em] text-muted uppercase">Poster</div>
      <p className={cx("font-bold before:mr-2 before:inline-block before:size-[9px] before:rounded-full before:content-['']", state === 'LINKED' ? 'before:bg-black' : 'before:bg-terracotta')}>
        {state === 'LINKED' ? 'Poster bilan bog‘langan' : 'Poster bilan bog‘lanmagan'}
      </p>

      {state === 'NOT_LINKED' && (
        <>
          <p className="text-[13px] text-muted">
            Poster kassada mijozni telefon raqamining oxirgi 4 raqami{phoneLast4 ? ` (${phoneLast4})` : ''} yoki ismi bo‘yicha qo‘lda tanlang.
          </p>

          {!candidates && (
            <Button disabled={busy} onClick={findMatches} variant="secondary">
              {busy ? 'Qidirilmoqda...' : 'Poster mijozni topish'}
            </Button>
          )}

          {candidates && candidates.candidates.length === 0 && <p className="text-[13px] text-muted">Poster’da mos mijoz topilmadi.</p>}

          {candidates && candidates.candidates.length > 1 && <p className="text-[13px] font-bold text-black">Bir nechta Poster mijoz topildi. To‘g‘risini tanlang.</p>}

          {candidates?.candidates.map((candidate) => (
            <div className="flex items-center justify-between gap-3 rounded-sm border border-line px-3 py-2.5" key={candidate.choice}>
              <div>
                <div className="font-semibold">{candidate.displayName}</div>
                <div className="text-[13px] text-muted">•••• {candidate.phoneLast4}</div>
              </div>
              <Button disabled={busy} onClick={() => link(candidate.choice)} size="compact" variant="primary">
                Bog‘lash
              </Button>
            </div>
          ))}
        </>
      )}

      {error && <p className="text-[14px] font-semibold text-terracotta-deep">{error}</p>}
    </section>
  );
}
