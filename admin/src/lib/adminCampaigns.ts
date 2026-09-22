import { apiRequest } from './api';
import { AudiencePreviewPage, Campaign, CampaignListPage, CampaignRecipientsPage } from './types';

export interface CampaignInput {
  name: string;
  description?: string;
  segmentId: string;
  messageText: string;
}

export function fetchCampaigns(cursor?: string): Promise<CampaignListPage> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  return apiRequest<CampaignListPage>(`/admin/campaigns${query}`);
}

export function fetchCampaign(id: string): Promise<Campaign> {
  return apiRequest<Campaign>(`/admin/campaigns/${id}`);
}

export function createCampaign(input: CampaignInput): Promise<Campaign> {
  return apiRequest<Campaign>('/admin/campaigns', { method: 'POST', body: input });
}

export function updateCampaign(id: string, input: Partial<CampaignInput>): Promise<Campaign> {
  return apiRequest<Campaign>(`/admin/campaigns/${id}`, { method: 'PATCH', body: input });
}

export function deleteCampaign(id: string): Promise<{ success: boolean }> {
  return apiRequest<{ success: boolean }>(`/admin/campaigns/${id}`, { method: 'DELETE' });
}

export function fetchCampaignAudience(id: string, cursor?: string): Promise<AudiencePreviewPage> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  return apiRequest<AudiencePreviewPage>(`/admin/campaigns/${id}/audience${query}`);
}

// The one call in this file with a real external side effect — the Admin UI must only reach
// this from an explicit confirmation step, never directly from the campaign form (see
// CampaignDetailView).
export function sendCampaign(id: string): Promise<Campaign> {
  return apiRequest<Campaign>(`/admin/campaigns/${id}/send`, { method: 'POST' });
}

export function fetchCampaignRecipients(id: string, cursor?: string): Promise<CampaignRecipientsPage> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  return apiRequest<CampaignRecipientsPage>(`/admin/campaigns/${id}/recipients${query}`);
}
