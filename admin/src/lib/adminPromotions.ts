import { apiRequest } from './api';
import { Promotion, PromotionAudiencePreviewPage, PromotionListPage, PromotionRedemptionsPage } from './types';

export interface PromotionInput {
  name: string;
  description?: string;
  segmentId?: string | null;
  benefitType: string;
  benefitValue?: number | null;
  benefitProductId?: string | null;
  benefitQuantity?: number | null;
  startsAt: string;
  endsAt?: string | null;
  usageLimitPerCustomer?: number | null;
  isActive?: boolean;
}

export function fetchPromotions(cursor?: string): Promise<PromotionListPage> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  return apiRequest<PromotionListPage>(`/admin/promotions${query}`);
}

export function fetchPromotion(id: string): Promise<Promotion> {
  return apiRequest<Promotion>(`/admin/promotions/${id}`);
}

export function createPromotion(input: PromotionInput): Promise<Promotion> {
  return apiRequest<Promotion>('/admin/promotions', { method: 'POST', body: input });
}

export function updatePromotion(id: string, input: Partial<PromotionInput>): Promise<Promotion> {
  return apiRequest<Promotion>(`/admin/promotions/${id}`, { method: 'PATCH', body: input });
}

export function deletePromotion(id: string): Promise<{ success: boolean }> {
  return apiRequest<{ success: boolean }>(`/admin/promotions/${id}`, { method: 'DELETE' });
}

export function activatePromotion(id: string): Promise<Promotion> {
  return apiRequest<Promotion>(`/admin/promotions/${id}/activate`, { method: 'POST' });
}

export function deactivatePromotion(id: string): Promise<Promotion> {
  return apiRequest<Promotion>(`/admin/promotions/${id}/deactivate`, { method: 'POST' });
}

export function fetchPromotionAudience(id: string, cursor?: string): Promise<PromotionAudiencePreviewPage> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  return apiRequest<PromotionAudiencePreviewPage>(`/admin/promotions/${id}/audience${query}`);
}

export function fetchPromotionRedemptions(id: string, cursor?: string): Promise<PromotionRedemptionsPage> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  return apiRequest<PromotionRedemptionsPage>(`/admin/promotions/${id}/redemptions${query}`);
}
