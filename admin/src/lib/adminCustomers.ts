import { apiRequest } from './api';
import { AdminCustomer360, AdminCustomerListPage, CustomerActivityPage } from './types';

export function fetchCustomers(options: { search?: string; cursor?: string } = {}): Promise<AdminCustomerListPage> {
  const params = new URLSearchParams();
  if (options.search) params.set('search', options.search);
  if (options.cursor) params.set('cursor', options.cursor);
  const query = params.toString();
  return apiRequest<AdminCustomerListPage>(`/admin/customers${query ? `?${query}` : ''}`);
}

// Phase 11: explicit regeneration only (the server rejects the call without { confirm: true }).
export function regenerateLoyaltyCode(customerId: string): Promise<{ loyaltyCode: string }> {
  return apiRequest<{ loyaltyCode: string }>(`/admin/customers/${customerId}/loyalty-code/regenerate`, { method: 'POST', body: { confirm: true } });
}

export function fetchCustomer360(customerId: string): Promise<AdminCustomer360> {
  return apiRequest<AdminCustomer360>(`/admin/customers/${customerId}`);
}

// Phase 11.4: bounded, cursor-paginated purchase activity (CUP orders + POS purchases). The cursor is opaque.
export function fetchCustomerActivity(customerId: string, options: { cursor?: string; limit?: number; filter?: 'purchases' | 'all' } = {}): Promise<CustomerActivityPage> {
  const params = new URLSearchParams();
  if (options.cursor) params.set('cursor', options.cursor);
  if (options.limit) params.set('limit', String(options.limit));
  if (options.filter) params.set('filter', options.filter);
  const query = params.toString();
  return apiRequest<CustomerActivityPage>(`/admin/customers/${customerId}/activity${query ? `?${query}` : ''}`);
}
