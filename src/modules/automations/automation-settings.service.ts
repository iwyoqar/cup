import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '../../common/config/config.service';
import { SettingsService } from '../settings/settings.service';
import { hhmmToMinutes, minutesToHhmm } from './automation-time';

// Phase 13 — CRM business configuration (Setting table, "crm.automation." prefix). Every default means "do nothing": until an admin turns
// CRM automation on, no automation detects, queues or sends anything. A SEPARATE operator env flag (CRM_AUTOMATION_SEND_ENABLED) must ALSO be
// true before any Telegram message can leave the system.
export interface CrmSettings {
  enabled: boolean;
  dailyLimit: number; // max CRM messages per customer per business day, across ALL automations
  quietHoursStart: string; // HH:MM business time
  quietHoursEnd: string;
  batchSize: number;
  runIntervalSeconds: number;
  defaultCooldownHours: number;
  defaultMaxSends: number;
  maxEventAgeHours: number; // triggers older than this never fire (no flood after a long pause)
  enabledAt: string | null; // stamped when CRM automation is switched on (nothing before it can fire)
}

const KEYS = {
  enabled: 'crm.automation.enabled',
  enabledAtMs: 'crm.automation.enabledAtMs',
  dailyLimit: 'crm.automation.dailyLimit',
  quietStart: 'crm.automation.quietStartMinutes',
  quietEnd: 'crm.automation.quietEndMinutes',
  batchSize: 'crm.automation.batchSize',
  runIntervalSeconds: 'crm.automation.runIntervalSeconds',
  defaultCooldownHours: 'crm.automation.defaultCooldownHours',
  defaultMaxSends: 'crm.automation.defaultMaxSends',
  maxEventAgeHours: 'crm.automation.maxEventAgeHours',
} as const;

const DEFAULTS = { enabled: false, dailyLimit: 3, quietStart: 21 * 60, quietEnd: 9 * 60, batchSize: 100, runIntervalSeconds: 60, defaultCooldownHours: 24, defaultMaxSends: 3, maxEventAgeHours: 72 };

export interface CrmSettingsView extends CrmSettings {
  sendGateOpen: boolean; // the operator env flag — read-only here, never editable from Admin
}

@Injectable()
export class AutomationSettingsService {
  constructor(
    private readonly settings: SettingsService,
    private readonly config: ConfigService,
  ) {}

  sendGateOpen(): boolean {
    return this.config.env.CRM_AUTOMATION_SEND_ENABLED === true;
  }

  async get(): Promise<CrmSettings> {
    const [enabled, enabledAtMs, dailyLimit, quietStart, quietEnd, batchSize, runIntervalSeconds, defaultCooldownHours, defaultMaxSends, maxEventAgeHours] = await Promise.all([
      this.settings.getBoolean(KEYS.enabled, DEFAULTS.enabled),
      this.settings.getInteger(KEYS.enabledAtMs, 0),
      this.settings.getInteger(KEYS.dailyLimit, DEFAULTS.dailyLimit),
      this.settings.getInteger(KEYS.quietStart, DEFAULTS.quietStart),
      this.settings.getInteger(KEYS.quietEnd, DEFAULTS.quietEnd),
      this.settings.getInteger(KEYS.batchSize, DEFAULTS.batchSize),
      this.settings.getInteger(KEYS.runIntervalSeconds, DEFAULTS.runIntervalSeconds),
      this.settings.getInteger(KEYS.defaultCooldownHours, DEFAULTS.defaultCooldownHours),
      this.settings.getInteger(KEYS.defaultMaxSends, DEFAULTS.defaultMaxSends),
      this.settings.getInteger(KEYS.maxEventAgeHours, DEFAULTS.maxEventAgeHours),
    ]);
    return {
      enabled,
      dailyLimit,
      quietHoursStart: minutesToHhmm(quietStart),
      quietHoursEnd: minutesToHhmm(quietEnd),
      batchSize,
      runIntervalSeconds,
      defaultCooldownHours,
      defaultMaxSends,
      maxEventAgeHours,
      enabledAt: enabledAtMs > 0 ? new Date(enabledAtMs).toISOString() : null,
    };
  }

  async getView(): Promise<CrmSettingsView> {
    return { ...(await this.get()), sendGateOpen: this.sendGateOpen() };
  }

  // Partial update; the FULL resulting object is validated server-side. Switching on stamps enabledAt = now EVERY time it goes off -> on, so a
  // pause never lets stale triggers fire on resume.
  async update(partial: Partial<Omit<CrmSettings, 'enabledAt'>>, updatedBy: string): Promise<CrmSettingsView> {
    const current = await this.get();
    const next = { ...current, ...partial };
    const int = (name: string, v: number, min: number, max: number) => {
      if (!Number.isInteger(v) || v < min || v > max) throw new BadRequestException(`${name} must be an integer between ${min} and ${max}.`);
    };
    int('dailyLimit', next.dailyLimit, 1, 50);
    int('batchSize', next.batchSize, 1, 1000);
    int('runIntervalSeconds', next.runIntervalSeconds, 5, 86_400);
    int('defaultCooldownHours', next.defaultCooldownHours, 0, 24 * 365);
    int('defaultMaxSends', next.defaultMaxSends, 1, 1000);
    int('maxEventAgeHours', next.maxEventAgeHours, 1, 24 * 30);
    const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (!hhmm.test(next.quietHoursStart) || !hhmm.test(next.quietHoursEnd)) throw new BadRequestException('Quiet hours must be HH:MM (business time).');

    const writes: Promise<void>[] = [];
    const bool = (k: string, v: boolean | undefined) => v !== undefined && writes.push(this.settings.setBoolean(k, v, updatedBy));
    const num = (k: string, v: number | undefined) => v !== undefined && writes.push(this.settings.setInteger(k, v, updatedBy));
    bool(KEYS.enabled, partial.enabled);
    num(KEYS.dailyLimit, partial.dailyLimit);
    num(KEYS.batchSize, partial.batchSize);
    num(KEYS.runIntervalSeconds, partial.runIntervalSeconds);
    num(KEYS.defaultCooldownHours, partial.defaultCooldownHours);
    num(KEYS.defaultMaxSends, partial.defaultMaxSends);
    num(KEYS.maxEventAgeHours, partial.maxEventAgeHours);
    if (partial.quietHoursStart !== undefined) num(KEYS.quietStart, hhmmToMinutes(partial.quietHoursStart));
    if (partial.quietHoursEnd !== undefined) num(KEYS.quietEnd, hhmmToMinutes(partial.quietHoursEnd));
    if (partial.enabled === true && !current.enabled) num(KEYS.enabledAtMs, Date.now());
    await Promise.all(writes);
    return this.getView();
  }

  quietMinutes(s: CrmSettings): { start: number; end: number } {
    return { start: hhmmToMinutes(s.quietHoursStart), end: hhmmToMinutes(s.quietHoursEnd) };
  }
}
