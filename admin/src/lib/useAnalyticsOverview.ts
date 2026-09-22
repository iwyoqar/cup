import { useCallback, useEffect, useState } from 'react';
import { AnalyticsFilters, fetchAnalyticsOverview } from './adminAnalytics';
import { ApiError } from './api';
import { AnalyticsOverview } from './types';

// The one place that loads /admin/analytics/overview (Dashboard, Sales and Analytics all read it). The backend computes every figure; callers only
// format and draw. Stale responses are dropped, and `ready=false` (an incomplete custom range) simply does not fetch.
export function useAnalyticsOverview(filters: AnalyticsFilters, ready = true) {
  const [data, setData] = useState<AnalyticsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const { period, branchId, startDate, endDate } = filters;

  const load = useCallback(() => {
    if (!ready) return undefined;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchAnalyticsOverview({ period, branchId: branchId || undefined, startDate: startDate || undefined, endDate: endDate || undefined })
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
    };
  }, [period, branchId, startDate, endDate, ready]);

  useEffect(() => load(), [load, reloadKey]);

  return { data, error, loading, reload: () => setReloadKey((k) => k + 1) };
}
