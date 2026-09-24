import { apiRequest } from './api';
import { ReportsOverview, ReportsLocationsOverview, ReportsPaymentsOverview, ReportsProductsOverview, ReportsCategoriesOverview, ReportsSource, AnalyticsPeriodKey } from './types';

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

// Reports Phase C1/C2. Search and sort are applied client-side on the Products/Categories pages (the product list is
// catalog-sized), so only the filters that change the aggregate itself are sent — one Poster read per filter change,
// not per keystroke.
export interface ProductReportsFilters extends ReportsFilters {
  source: ReportsSource;
  categoryId?: string;
}

function buildProductParams(filters: ProductReportsFilters): URLSearchParams {
  const params = buildParams(filters);
  params.set('source', filters.source);
  if (filters.categoryId) params.set('categoryId', filters.categoryId);
  return params;
}

export function fetchReportsProducts(filters: ProductReportsFilters): Promise<ReportsProductsOverview> {
  return apiRequest<ReportsProductsOverview>(`/admin/reports/products?${buildProductParams(filters).toString()}`);
}

export function fetchReportsCategories(filters: ProductReportsFilters): Promise<ReportsCategoriesOverview> {
  return apiRequest<ReportsCategoriesOverview>(`/admin/reports/categories?${buildProductParams({ ...filters, categoryId: undefined }).toString()}`);
}
