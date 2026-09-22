// Same money/date conventions as frontend/'s lib/format.ts — a separate copy, not shared code,
// since these are two independent Vite projects (Phase 3 Part 3: deliberately isolated), but
// the same formatting rules: CUP's canonical unit is WHOLE UZS (integer, never floats; the
// "...Minor" field names are historical). No Poster-specific conversion belongs here — that
// lives only in the backend's Poster adapter (src/modules/poster/poster-money.ts).
export function formatSom(minor: number): string {
  return `${minor.toLocaleString('ru-RU')} so'm`;
}

export function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDateTime(isoString: string): string {
  const date = new Date(isoString);
  return `${formatDate(isoString)}, ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
}

// "3 min ago" / "2 h ago" / "4 d ago" — for status lines where the exact timestamp matters less than the freshness.
export function formatAgo(isoString: string | null, now: number = Date.now()): string {
  if (!isoString) return 'never';
  const seconds = Math.max(0, Math.round((now - new Date(isoString).getTime()) / 1000));
  if (seconds < 45) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`;
  return `${Math.round(seconds / 86400)} d ago`;
}

export function formatDuration(totalSeconds: number | null): string {
  if (totalSeconds === null) return '—';
  if (totalSeconds < 60) return `${totalSeconds} s`;
  if (totalSeconds < 3600) return `${Math.round(totalSeconds / 60)} min`;
  if (totalSeconds < 86400) return `${(totalSeconds / 3600).toFixed(1)} h`;
  return `${(totalSeconds / 86400).toFixed(1)} d`;
}
