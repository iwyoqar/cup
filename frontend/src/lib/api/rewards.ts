import { apiRequest } from './client';
import { CustomerRewardProgram } from '../../types/api';

export function fetchMyRewards(): Promise<CustomerRewardProgram[]> {
  return apiRequest<CustomerRewardProgram[]>('/loyalty/rewards');
}
