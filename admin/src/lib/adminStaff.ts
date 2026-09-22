import { apiRequest } from './api';
import { StaffMember } from './types';

export interface BranchOption {
  id: string;
  name: string;
}

export function fetchStaff(): Promise<StaffMember[]> {
  return apiRequest<StaffMember[]>('/admin/staff');
}

export function createStaff(input: { username: string; displayName: string; password: string; branchId: string | null }): Promise<StaffMember> {
  return apiRequest<StaffMember>('/admin/staff', { method: 'POST', body: input });
}

export function updateStaff(id: string, patch: { displayName?: string; password?: string; branchId?: string | null; isActive?: boolean }): Promise<StaffMember> {
  return apiRequest<StaffMember>(`/admin/staff/${id}`, { method: 'PATCH', body: patch });
}

// Branches are public read-only reference data (the same list the customer Mini App shows).
export function fetchBranchOptions(): Promise<BranchOption[]> {
  return apiRequest<BranchOption[]>('/branches');
}
