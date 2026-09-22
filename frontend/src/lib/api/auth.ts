import { apiRequest } from './client';
import { AuthenticatedSession, Customer } from '../../types/api';

// Sends the RAW Telegram.WebApp.initData string, exactly as Telegram provided it — the
// backend re-derives identity from its own HMAC verification (see auth.service.ts /
// telegram-init-data.ts). Never reconstruct or serialize initDataUnsafe here (Phase 1.7 spec
// section 30).
export function authenticateWithTelegram(initData: string): Promise<AuthenticatedSession> {
  return apiRequest<AuthenticatedSession>('/auth/telegram', { method: 'POST', body: { initData } });
}

export function fetchMe(): Promise<Customer> {
  return apiRequest<Customer>('/auth/me');
}
