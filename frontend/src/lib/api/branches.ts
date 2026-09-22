import { apiRequest } from './client';
import { Branch } from '../../types/api';

export function fetchBranches(): Promise<Branch[]> {
  return apiRequest<Branch[]>('/branches');
}
