import { apiRequest } from './api';
import { AdminAuthenticatedSession, AdminProfile } from './types';

export function login(email: string, password: string): Promise<AdminAuthenticatedSession> {
  return apiRequest<AdminAuthenticatedSession>('/admin/auth/login', { method: 'POST', body: { email, password } });
}

export function fetchMe(): Promise<AdminProfile> {
  return apiRequest<AdminProfile>('/admin/auth/me');
}
