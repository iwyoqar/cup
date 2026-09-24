import { useCallback, useEffect, useState } from 'react';
import { apiRequest, ApiError } from './api';

// Reports Phase D-G — one generic loader for GET /admin/reports/<name>. Same behaviour as the per-report hooks
// (useReportsLocations etc.): cancels stale responses, keeps the previous data visible while reloading, and turns
// transport failures into a friendly message. `params` values that are empty/undefined are not sent.
export function useReport<T>(name: string, params: Record<string, string | number | undefined>, ready = true) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)])).toString();

  const load = useCallback(() => {
    if (!ready) return undefined;
    let cancelled = false;
    // Phase H: a newer filter change aborts the in-flight request (the `cancelled` flag still guards against a late response).
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    apiRequest<T>(`/admin/reports/${name}?${qs}`, { signal: controller.signal })
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError && err.status !== 0 && err.backendMessage !== 'network_error' ? err.backendMessage : "Ma'lumotni yuklab bo'lmadi");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [name, qs, ready]);

  useEffect(() => load(), [load, reloadKey]);

  return { data, error, loading, reload: () => setReloadKey((k) => k + 1) };
}

export function rangeParams(range: { period: string; startDate: string; endDate: string }) {
  return range.period === 'custom' ? { period: range.period, startDate: range.startDate, endDate: range.endDate } : { period: range.period };
}
