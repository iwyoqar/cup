import { apiRequest } from './api';

// Phase 13 — CRM Automation admin API. The backend validates everything again; nothing here decides a business rule.
export type TriggerType = 'FIRST_PURCHASE' | 'REWARD_UNLOCKED' | 'BIRTHDAY' | 'INACTIVE_CUSTOMER' | 'ABANDONED_CART' | 'LOYALTY_MILESTONE' | 'SCHEDULED_SEGMENT';
export type AutomationStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED';

export type TriggerConfig = Record<string, string | number | boolean | undefined>;

export interface AutomationView {
  id: string;
  name: string;
  description: string | null;
  status: AutomationStatus;
  triggerType: TriggerType;
  triggerLabel: string;
  triggerConfig: TriggerConfig | null;
  campaign: { id: string; name: string; status: string };
  segment: { id: string; name: string } | null;
  cooldownHours: number;
  maxSendsPerCustomer: number | null;
  activatedAt: string | null;
  lastRunAt: string | null;
  createdAt: string;
  stats: { pending: number; sent: number; skipped: number; failed: number };
}

export interface AutomationInput {
  name: string;
  description: string | null;
  triggerType: TriggerType;
  triggerConfig: TriggerConfig;
  campaignId: string;
  segmentId: string | null;
  cooldownHours: number;
  maxSendsPerCustomer: number | null;
}

export interface AutomationMeta {
  triggers: { type: TriggerType; label: string; description: string }[];
  variables: string[];
  defaults: { cooldownHours: number; maxSendsPerCustomer: number };
  cartExpiryMinutes: number;
  sendGate: { crmEnabled: boolean; envGateOpen: boolean };
}

export interface CrmSettings {
  enabled: boolean;
  dailyLimit: number;
  quietHoursStart: string;
  quietHoursEnd: string;
  batchSize: number;
  runIntervalSeconds: number;
  defaultCooldownHours: number;
  defaultMaxSends: number;
  maxEventAgeHours: number;
  enabledAt: string | null;
  sendGateOpen: boolean;
}

export interface ExecutionRow {
  status: 'PENDING' | 'SENT' | 'SKIPPED' | 'FAILED';
  reason: string | null;
  customer: { displayName: string | null };
  trigger: string;
  campaign: string;
  createdAt: string;
  sentAt: string | null;
}

export interface AutomationPreview {
  mode: 'preview';
  notice: string;
  trigger: string;
  campaign: { name: string; status: string; ready: boolean; unresolvedVariables: string[] };
  sendGate: { crmEnabled: boolean; envGateOpen: boolean };
  quietHoursNow: boolean;
  matched: number;
  alreadyProcessed: number;
  segmentMismatch: number;
  noTelegram: number;
  cooldownBlocked: number;
  frequencyBlocked: number;
  dailyLimitBlocked: number;
  finalRecipients: number;
  sample: { displayName: string | null; outcome: string }[];
  sampleMessage: string | null;
  truncated: boolean;
}

const BASE = '/admin/crm';
export const fetchCrmSettings = () => apiRequest<CrmSettings>(`${BASE}/settings`);
export const updateCrmSettings = (partial: Partial<Omit<CrmSettings, 'enabledAt' | 'sendGateOpen'>>) => apiRequest<CrmSettings>(`${BASE}/settings`, { method: 'PATCH', body: partial });
export const fetchAutomationMeta = () => apiRequest<AutomationMeta>(`${BASE}/automations/meta`);
export const fetchAutomations = (cursor?: string) => apiRequest<{ items: AutomationView[]; nextCursor: string | null }>(`${BASE}/automations${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
export const fetchAutomation = (id: string) => apiRequest<AutomationView>(`${BASE}/automations/${id}`);
export const createAutomation = (input: AutomationInput) => apiRequest<AutomationView>(`${BASE}/automations`, { method: 'POST', body: input });
export const updateAutomation = (id: string, input: Partial<AutomationInput>) => apiRequest<AutomationView>(`${BASE}/automations/${id}`, { method: 'PATCH', body: input });
export const activateAutomation = (id: string) => apiRequest<AutomationView>(`${BASE}/automations/${id}/activate`, { method: 'POST' });
export const pauseAutomation = (id: string) => apiRequest<AutomationView>(`${BASE}/automations/${id}/pause`, { method: 'POST' });
export const archiveAutomation = (id: string) => apiRequest<AutomationView>(`${BASE}/automations/${id}/archive`, { method: 'POST' });
export const previewAutomation = (id: string) => apiRequest<AutomationPreview>(`${BASE}/automations/${id}/preview`, { method: 'POST' });
export const fetchExecutions = (id: string, cursor?: string) => apiRequest<{ items: ExecutionRow[]; nextCursor: string | null }>(`${BASE}/automations/${id}/executions${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);

export const REASON_LABELS: Record<string, string> = {
  NO_TELEGRAM_ACCOUNT: 'No Telegram account',
  COOLDOWN: 'Cooldown',
  FREQUENCY_LIMIT: 'Frequency limit',
  DAILY_LIMIT: 'Daily limit',
  SEGMENT_MISMATCH: 'Not in segment',
  AUTOMATION_DISABLED: 'Automation not active',
  INVALID_TRIGGER: 'Invalid trigger',
  CAMPAIGN_NOT_READY: 'Campaign not ready',
  CONDITION_NO_LONGER_MET: 'Condition no longer met',
  EXPIRED: 'Expired',
  DELIVERY_FAILED: 'Delivery failed',
};
