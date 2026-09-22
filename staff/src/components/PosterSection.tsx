import { useState } from 'react';
import { ApiError, toUserMessage } from '../lib/api';
import { fetchPosterCandidates, linkPosterClient, PosterCandidates } from '../lib/staffApi';

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
    <section className="block">
      <div className="eyebrow">Poster</div>
      <p className={`poster-state poster-state--${state === 'LINKED' ? 'linked' : 'unlinked'}`}>
        {state === 'LINKED' ? 'Poster bilan bog‘langan' : 'Poster bilan bog‘lanmagan'}
      </p>

      {state === 'NOT_LINKED' && (
        <>
          <p className="hint">
            Poster kassada mijozni telefon raqamining oxirgi 4 raqami{phoneLast4 ? ` (${phoneLast4})` : ''} yoki ismi bo‘yicha qo‘lda tanlang.
          </p>

          {!candidates && (
            <button className="button button--secondary" disabled={busy} onClick={findMatches} type="button">
              {busy ? 'Qidirilmoqda...' : 'Poster mijozni topish'}
            </button>
          )}

          {candidates && candidates.candidates.length === 0 && <p className="hint">Poster’da mos mijoz topilmadi.</p>}

          {candidates && candidates.candidates.length > 1 && <p className="hint hint--strong">Bir nechta Poster mijoz topildi. To‘g‘risini tanlang.</p>}

          {candidates?.candidates.map((candidate) => (
            <div className="candidate" key={candidate.choice}>
              <div>
                <div className="candidate__name">{candidate.displayName}</div>
                <div className="hint">•••• {candidate.phoneLast4}</div>
              </div>
              <button className="button button--primary button--compact" disabled={busy} onClick={() => link(candidate.choice)} type="button">
                Bog‘lash
              </button>
            </div>
          ))}
        </>
      )}

      {error && <p className="error-text">{error}</p>}
    </section>
  );
}
