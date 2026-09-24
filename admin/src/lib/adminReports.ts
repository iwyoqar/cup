import { apiRequest } from './api';
import { ReportsOverview, ReportsLocationsOverview, ReportsPaymentsOverview, AnalyticsPeriodKey } from './types';

export interface ReportsFilters {
  period: AnalyticsPeriodKey;
  startDate?: string;
  endDate?: string;
  branchId?: string;
}

function buildParams(filters: ReportsFilters): URLSearchParams {
  const params = new URLSearchParams({ period: filters.period });
  if (filters.period === 'custom') {
    if (filters.startDate) params.set('startDate', filters.startDate);
    if (filters.endDate) params.set('endDate', filters.endDate);
  }
  if (filters.branchId) params.set('branchId', filters.branchId);
  return params;
}

export function fetchReportsOverview(filters: ReportsFilters): Promise<ReportsOverview> {
  return apiRequest<ReportsOverview>(`/admin/reports/overview?${buildParams(filters).toString()}`);
}

export function fetchReportsSales(filters: ReportsFilters): Promise<ReportsOverview> {
  return apiRequest<ReportsOverview>(`/admin/reports/sales?${buildParams(filters).toString()}`);
}

export function fetchReportsLocations(filters: ReportsFilters): Promise<ReportsLocationsOverview> {
  return apiRequest<ReportsLocationsOverview>(`/admin/reports/locations?${buildParams(filters).toString()}`);
}

export function fetchReportsPayments(filters: ReportsFilters): Promise<ReportsPaymentsOverview> {
  return apiRequest<ReportsPaymentsOverview>(`/admin/reports/payments?${buildParams(filters).toString()}`);
}
