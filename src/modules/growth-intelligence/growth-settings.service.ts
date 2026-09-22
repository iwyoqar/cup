import { BadRequestException, Injectable } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import { GrowthSettings } from './growth-intelligence.types';

// Phase 15 — every Growth Intelligence threshold lives in Admin configuration (Setting table, "growth." prefix), never in code. The defaults are
// STARTING values, not business rules: they only decide how customers are labelled on screen (nothing is sent or changed by any of them).
export const GROWTH_DEFAULTS: GrowthSettings = {
  lookbackDays: 90,
  recencyDaysBoundaries: [7, 14, 30, 60],
  frequencyBoundaries: [2, 3, 5, 8],
  monetaryBoundaries: [50_000, 150_000, 300_000, 600_000],
  newDays: 14,
  activeDays: 30,
  dormantDays: 90,
  churnDays: 180,
  loyalMinPurchases: 5,
  loyalMinRevenue: 0,
  highValueRevenue: 1_000_000,
  risingDays: 30,
  secondPurchaseDueDays: 7,
  signalWindowDays: 30,
  birthdayLookaheadDays: 7,
  upgradeProximityPercent: 20,
};

const KEY = (name: keyof GrowthSettings) => `growth.${name}`;
const ARRAY_KEYS = ['recencyDaysBoundaries', 'frequencyBoundaries', 'monetaryBoundaries'] as const;
const INT_KEYS = ['lookbackDays', 'newDays', 'activeDays', 'dormantDays', 'churnDays', 'loyalMinPurchases', 'loyalMinRevenue', 'highValueRevenue', 'risingDays', 'secondPurchaseDueDays', 'signalWindowDays', 'birthdayLookaheadDays', 'upgradeProximityPercent'] as const;

const parseList = (raw: string, fallback: number[]): number[] => {
  const parts = raw.split(',').map((p) => Number(p.trim()));
  return parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0) ? parts : fallback;
};

@Injectable()
export class GrowthSettingsService {
  constructor(private readonly settings: SettingsService) {}

  async get(): Promise<GrowthSettings> {
    const out = { ...GROWTH_DEFAULTS } as Record<string, number | number[]>;
    await Promise.all([
      ...INT_KEYS.map(async (k) => {
        out[k] = await this.settings.getInteger(KEY(k), GROWTH_DEFAULTS[k]);
      }),
      ...ARRAY_KEYS.map(async (k) => {
        out[k] = parseList(await this.settings.getString(KEY(k), GROWTH_DEFAULTS[k].join(',')), GROWTH_DEFAULTS[k]);
      }),
    ]);
    return out as unknown as GrowthSettings;
  }

  // Partial update; the FULL resulting object is validated server-side (ranges + the ordering rules the lifecycle / scoring precedence relies on).
  async update(partial: Partial<GrowthSettings>, updatedBy: string): Promise<GrowthSettings> {
    const next = { ...(await this.get()), ...partial };
    this.validate(next);
    const writes: Promise<void>[] = [];
    for (const k of INT_KEYS) if (partial[k] !== undefined) writes.push(this.settings.setInteger(KEY(k), partial[k] as number, updatedBy));
    for (const k of ARRAY_KEYS) if (partial[k] !== undefined) writes.push(this.settings.setString(KEY(k), (partial[k] as number[]).join(','), updatedBy));
    await Promise.all(writes);
    return this.get();
  }

  validate(s: GrowthSettings): void {
    const int = (name: string, v: number, min: number, max: number) => {
      if (!Number.isInteger(v) || v < min || v > max) throw new BadRequestException(`${name} must be an integer between ${min} and ${max}.`);
    };
    int('lookbackDays', s.lookbackDays, 1, 3650);
    int('newDays', s.newDays, 1, 3650);
    int('activeDays', s.activeDays, 1, 3650);
    int('dormantDays', s.dormantDays, 1, 3650);
    int('churnDays', s.churnDays, 1, 3650);
    int('loyalMinPurchases', s.loyalMinPurchases, 1, 100_000);
    int('loyalMinRevenue', s.loyalMinRevenue, 0, 100_000_000_000);
    int('highValueRevenue', s.highValueRevenue, 1, 100_000_000_000);
    int('risingDays', s.risingDays, 1, 3650);
    int('secondPurchaseDueDays', s.secondPurchaseDueDays, 1, 3650);
    int('signalWindowDays', s.signalWindowDays, 1, 3650);
    int('birthdayLookaheadDays', s.birthdayLookaheadDays, 0, 60);
    int('upgradeProximityPercent', s.upgradeProximityPercent, 1, 100);
    // Explicit ordering — the lifecycle precedence assumes it, so overlapping or inverted thresholds are refused rather than guessed at.
    if (!(s.newDays <= s.activeDays)) throw new BadRequestException('newDays must not exceed activeDays.');
    if (!(s.activeDays < s.dormantDays)) throw new BadRequestException('activeDays must be smaller than dormantDays.');
    if (!(s.dormantDays < s.churnDays)) throw new BadRequestException('dormantDays must be smaller than churnDays.');
    for (const [name, list] of [['recencyDaysBoundaries', s.recencyDaysBoundaries], ['frequencyBoundaries', s.frequencyBoundaries], ['monetaryBoundaries', s.monetaryBoundaries]] as const) {
      if (!Array.isArray(list) || list.length !== 4 || !list.every((n) => Number.isInteger(n) && n >= 0 && n <= 100_000_000_000)) throw new BadRequestException(`${name} must be 4 non-negative integers.`);
      if (!list.every((n, i) => i === 0 || n > list[i - 1])) throw new BadRequestException(`${name} must be strictly ascending.`);
    }
  }
}
