import { apiRequest } from './api';
import { LoyaltySettings } from './types';

export function fetchLoyaltySettings(): Promise<LoyaltySettings> {
  return apiRequest<LoyaltySettings>('/admin/settings/loyalty');
}

export function updateLoyaltySettings(partial: Partial<LoyaltySettings>): Promise<LoyaltySettings> {
  return apiRequest<LoyaltySettings>('/admin/settings/loyalty', { method: 'PATCH', body: partial });
}
