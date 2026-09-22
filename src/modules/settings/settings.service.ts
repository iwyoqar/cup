import { Injectable } from '@nestjs/common';
import { SettingsRepository } from './settings.repository';

export type SettingValueType = 'boolean' | 'integer' | 'string';

// Generic, reusable key/value configuration store (Phase 3 Part 4/19) — the foundation every
// future module (marketing.*, campaign.*, referral.*, business.*, ...) reads/writes through
// these typed getters/setters. No module should ever touch the Setting table via raw Prisma
// directly, and no new simple config value should ever need its own migration again.
//
// Values are always stored as text (Setting.value); valueType records how to parse them back.
// The typed getters below are the ONLY place that parsing happens, so a malformed/legacy value
// can never propagate further than "fall back to the caller's default" — never a thrown
// exception from a bad stored value, since a broken setting should degrade safely, not crash
// whatever business logic reads it.
@Injectable()
export class SettingsService {
  constructor(private readonly repository: SettingsRepository) {}

  async getBoolean(key: string, fallback: boolean): Promise<boolean> {
    const row = await this.repository.findByKey(key);
    if (!row) {
      return fallback;
    }
    return row.value === 'true';
  }

  async getInteger(key: string, fallback: number): Promise<number> {
    const row = await this.repository.findByKey(key);
    if (!row) {
      return fallback;
    }
    const parsed = Number(row.value);
    return Number.isInteger(parsed) ? parsed : fallback;
  }

  async getString(key: string, fallback: string): Promise<string> {
    const row = await this.repository.findByKey(key);
    return row ? row.value : fallback;
  }

  async setString(key: string, value: string, updatedBy: string | null): Promise<void> {
    await this.repository.upsert(key, value, 'string' satisfies SettingValueType, updatedBy);
  }

  async setBoolean(key: string, value: boolean, updatedBy: string | null): Promise<void> {
    await this.repository.upsert(key, value ? 'true' : 'false', 'boolean' satisfies SettingValueType, updatedBy);
  }

  async setInteger(key: string, value: number, updatedBy: string | null): Promise<void> {
    if (!Number.isInteger(value)) {
      throw new Error(`Setting "${key}": integer setting value must be an integer, got ${value}.`);
    }
    await this.repository.upsert(key, String(value), 'integer' satisfies SettingValueType, updatedBy);
  }
}
