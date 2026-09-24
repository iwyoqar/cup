import { useCallback, useEffect, useState } from 'react';
import { fetchReportsCategories, ProductReportsFilters } from './adminReports';
import { ApiError } from './api';
import { ReportsCategoriesOverview } from './types';

// Mirrors useReportsLocations.ts exactly, for GET /admin/reports/categories (plus `source`/`categoryId`).
export function useReportsCategories(filters: ProductReportsFilters, ready = true) {
  const [data, setData] = useState<ReportsCategoriesOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const { period, branchId, startDate, endDate, source, categoryId } = filters;

  const load = useCallback(() => {
    if (!ready) return undefined;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchReportsCategories({ period, source, branchId: branchId || undefined, categoryId: categoryId || undefined, startDate: startDate || undefined, endDate: endDate || undefined })
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
  }, [period, branchId, startDate, endDate, source, categoryId, ready]);

  useEffect(() => load(), [load, reloadKey]);

  return { data, error, loading, reload: () => setReloadKey((k) => k + 1) };
}
