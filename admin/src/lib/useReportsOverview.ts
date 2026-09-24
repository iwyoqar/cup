import { useCallback, useEffect, useState } from 'react';
import { fetchReportsOverview, fetchReportsSales, ReportsFilters } from './adminReports';
import { ApiError } from './api';
import { ReportsOverview } from './types';

// Mirrors useAnalyticsOverview.ts exactly, for the two Reports routes (overview/sales share one backend
// computation — see reports.service.ts — so this only differs in which endpoint it calls).
export function useReportsOverview(view: 'overview' | 'sales', filters: ReportsFilters, ready = true) {
  const [data, setData] = useState<ReportsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const { period, branchId, startDate, endDate } = filters;

  const load = useCallback(() => {
    if (!ready) return undefined;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const fetcher = view === 'overview' ? fetchReportsOverview : fetchReportsSales;
    fetcher({ period, branchId: branchId || undefined, startDate: startDate || undefined, endDate: endDate || undefined })
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
  }, [view, period, branchId, startDate, endDate, ready]);

  useEffect(() => load(), [load, reloadKey]);

  return { data, error, loading, reload: () => setReloadKey((k) => k + 1) };
}
