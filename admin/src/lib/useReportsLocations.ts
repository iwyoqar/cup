import { useCallback, useEffect, useState } from 'react';
import { fetchReportsLocations, ReportsFilters } from './adminReports';
import { ApiError } from './api';
import { ReportsLocationsOverview } from './types';

// Mirrors useReportsOverview.ts / useAnalyticsOverview.ts exactly, for GET /admin/reports/locations.
export function useReportsLocations(filters: ReportsFilters, ready = true) {
  const [data, setData] = useState<ReportsLocationsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const { period, branchId, startDate, endDate } = filters;

  const load = useCallback(() => {
    if (!ready) return undefined;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchReportsLocations({ period, branchId: branchId || undefined, startDate: startDate || undefined, endDate: endDate || undefined })
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
