import { apiRequest } from './api';
import { RewardProgram, RewardProgramListPage, RewardRedemptionsPage } from './types';

export interface RewardProgramInput {
  name: string;
  description?: string;
  type: string;
  qualifyingCategoryId: string;
  buyQuantity: number;
  rewardQuantity: number;
  startsAt: string;
  endsAt?: string | null;
  isActive?: boolean;
}

export function fetchRewardPrograms(cursor?: string): Promise<RewardProgramListPage> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  return apiRequest<RewardProgramListPage>(`/admin/reward-programs${query}`);
}

export function fetchRewardProgram(id: string): Promise<RewardProgram> {
  return apiRequest<RewardProgram>(`/admin/reward-programs/${id}`);
}

export function createRewardProgram(input: RewardProgramInput): Promise<RewardProgram> {
  return apiRequest<RewardProgram>('/admin/reward-programs', { method: 'POST', body: input });
}

export function updateRewardProgram(id: string, input: Partial<RewardProgramInput>): Promise<RewardProgram> {
  return apiRequest<RewardProgram>(`/admin/reward-programs/${id}`, { method: 'PATCH', body: input });
}

export function deleteRewardProgram(id: string): Promise<{ success: boolean }> {
  return apiRequest<{ success: boolean }>(`/admin/reward-programs/${id}`, { method: 'DELETE' });
}

export function activateRewardProgram(id: string): Promise<RewardProgram> {
  return apiRequest<RewardProgram>(`/admin/reward-programs/${id}/activate`, { method: 'POST' });
}

export function deactivateRewardProgram(id: string): Promise<RewardProgram> {
  return apiRequest<RewardProgram>(`/admin/reward-programs/${id}/deactivate`, { method: 'POST' });
}

export function fetchRewardRedemptions(id: string, cursor?: string): Promise<RewardRedemptionsPage> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  return apiRequest<RewardRedemptionsPage>(`/admin/reward-programs/${id}/redemptions${query}`);
}
