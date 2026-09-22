import { apiRequest } from './api';
import { AnalyticsOverview, AnalyticsPeriodKey } from './types';

export interface AnalyticsFilters {
  period: AnalyticsPeriodKey;
  startDate?: string;
  endDate?: string;
  branchId?: string;
}

export function fetchAnalyticsOverview(filters: AnalyticsFilters): Promise<AnalyticsOverview> {
  const params = new URLSearchParams({ period: filters.period });
  if (filters.period === 'custom') {
    if (filters.startDate) params.set('startDate', filters.startDate);
    if (filters.endDate) params.set('endDate', filters.endDate);
  }
  if (filters.branchId) params.set('branchId', filters.branchId);
  return apiRequest<AnalyticsOverview>(`/admin/analytics/overview?${params.toString()}`);
}
