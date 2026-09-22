import { BadRequestException, Injectable } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';

// Phase 12 — every Loyalty 2.0 business rule lives in Admin configuration (Setting table, "loyalty2." prefix), never in code.
// Every default means "do nothing": until an admin switches the program on, nothing is earned, credited or unlocked and the
// customer endpoints simply report enabled=false.
export interface Loyalty2Settings {
  enabled: boolean; // master switch
  xpRate: number; // XP granted per xpUnitAmount so'm
  xpUnitAmount: number;
  cashbackEnabled: boolean; // the cashback PERCENT itself is per level (Admin > Levels)
  purchasePointsEnabled: boolean; // earn loyalty POINTS on purchases using the existing earn rate x the level multiplier
  streakEnabled: boolean;
  birthdayEnabled: boolean;
  birthdayRewardPoints: number;
  birthdayWindowDays: number;
  referralEnabled: boolean; // legacy Phase 12 flag, no longer consulted — the referral program is configured under "referral." settings (Phase 14)
  accrualStartsAt: string | null; // ISO instant: purchases before it never earn cashback/points (XP and level use full history)
}

const KEYS = {
  enabled: 'loyalty2.enabled',
  xpRate: 'loyalty2.xpRate',
  xpUnitAmount: 'loyalty2.xpUnitAmount',
  cashbackEnabled: 'loyalty2.cashbackEnabled',
  purchasePointsEnabled: 'loyalty2.purchasePointsEnabled',
  streakEnabled: 'loyalty2.streakEnabled',
  birthdayEnabled: 'loyalty2.birthdayEnabled',
  birthdayRewardPoints: 'loyalty2.birthdayRewardPoints',
  birthdayWindowDays: 'loyalty2.birthdayWindowDays',
  referralEnabled: 'loyalty2.referralEnabled',
  accrualStartsAtMs: 'loyalty2.accrualStartsAtMs',
} as const;

const DEFAULTS: Omit<Loyalty2Settings, 'accrualStartsAt'> = {
  enabled: false,
  xpRate: 1,
  xpUnitAmount: 1,
  cashbackEnabled: false,
  purchasePointsEnabled: false,
  streakEnabled: false,
  birthdayEnabled: false,
  birthdayRewardPoints: 0,
  birthdayWindowDays: 7,
  referralEnabled: false,
};

@Injectable()
export class Loyalty2SettingsService {
  constructor(private readonly settings: SettingsService) {}

  async get(): Promise<Loyalty2Settings> {
    const [enabled, xpRate, xpUnitAmount, cashbackEnabled, purchasePointsEnabled, streakEnabled, birthdayEnabled, birthdayRewardPoints, birthdayWindowDays, referralEnabled, startMs] = await Promise.all([
      this.settings.getBoolean(KEYS.enabled, DEFAULTS.enabled),
      this.settings.getInteger(KEYS.xpRate, DEFAULTS.xpRate),
      this.settings.getInteger(KEYS.xpUnitAmount, DEFAULTS.xpUnitAmount),
      this.settings.getBoolean(KEYS.cashbackEnabled, DEFAULTS.cashbackEnabled),
      this.settings.getBoolean(KEYS.purchasePointsEnabled, DEFAULTS.purchasePointsEnabled),
      this.settings.getBoolean(KEYS.streakEnabled, DEFAULTS.streakEnabled),
      this.settings.getBoolean(KEYS.birthdayEnabled, DEFAULTS.birthdayEnabled),
      this.settings.getInteger(KEYS.birthdayRewardPoints, DEFAULTS.birthdayRewardPoints),
      this.settings.getInteger(KEYS.birthdayWindowDays, DEFAULTS.birthdayWindowDays),
      this.settings.getBoolean(KEYS.referralEnabled, DEFAULTS.referralEnabled),
      this.settings.getInteger(KEYS.accrualStartsAtMs, 0),
    ]);
    return { enabled, xpRate, xpUnitAmount, cashbackEnabled, purchasePointsEnabled, streakEnabled, birthdayEnabled, birthdayRewardPoints, birthdayWindowDays, referralEnabled, accrualStartsAt: startMs > 0 ? new Date(startMs).toISOString() : null };
  }

  // Partial update with server-side validation of the FULL resulting object. Switching the program on for the first time
  // stamps accrualStartsAt = now (unless the admin supplied one), so historical purchases never earn cashback/points
  // retroactively by surprise.
  async update(partial: Partial<Omit<Loyalty2Settings, 'accrualStartsAt'>> & { accrualStartsAt?: string | null }, updatedBy: string): Promise<Loyalty2Settings> {
    const current = await this.get();
    const next = { ...current, ...partial };
    if (!Number.isInteger(next.xpRate) || next.xpRate < 0 || next.xpRate > 1_000_000) throw new BadRequestException('xpRate must be an integer between 0 and 1,000,000.');
    if (!Number.isInteger(next.xpUnitAmount) || next.xpUnitAmount < 1 || next.xpUnitAmount > 1_000_000_000) throw new BadRequestException('xpUnitAmount must be a positive integer.');
    if (!Number.isInteger(next.birthdayRewardPoints) || next.birthdayRewardPoints < 0 || next.birthdayRewardPoints > 1_000_000) throw new BadRequestException('birthdayRewardPoints must be an integer between 0 and 1,000,000.');
    if (!Number.isInteger(next.birthdayWindowDays) || next.birthdayWindowDays < 1 || next.birthdayWindowDays > 31) throw new BadRequestException('birthdayWindowDays must be between 1 and 31.');

    let startMs: number | undefined;
    if (partial.accrualStartsAt !== undefined) {
      // Cannot be cleared: an enabled program always has a start, so nothing can ever accrue "from the beginning" by accident.
      const parsed = partial.accrualStartsAt === null ? NaN : new Date(partial.accrualStartsAt).getTime();
      if (Number.isNaN(parsed) || parsed <= 0) throw new BadRequestException('accrualStartsAt must be a valid date.');
      startMs = parsed;
    } else if (partial.enabled === true && !current.enabled && current.accrualStartsAt === null) {
      startMs = Date.now();
    }

    const writes: Promise<void>[] = [];
    const setBool = (key: string, v: boolean | undefined) => v !== undefined && writes.push(this.settings.setBoolean(key, v, updatedBy));
    const setInt = (key: string, v: number | undefined) => v !== undefined && writes.push(this.settings.setInteger(key, v, updatedBy));
    setBool(KEYS.enabled, partial.enabled);
    setInt(KEYS.xpRate, partial.xpRate);
    setInt(KEYS.xpUnitAmount, partial.xpUnitAmount);
    setBool(KEYS.cashbackEnabled, partial.cashbackEnabled);
    setBool(KEYS.purchasePointsEnabled, partial.purchasePointsEnabled);
    setBool(KEYS.streakEnabled, partial.streakEnabled);
    setBool(KEYS.birthdayEnabled, partial.birthdayEnabled);
    setInt(KEYS.birthdayRewardPoints, partial.birthdayRewardPoints);
    setInt(KEYS.birthdayWindowDays, partial.birthdayWindowDays);
    setBool(KEYS.referralEnabled, partial.referralEnabled);
    setInt(KEYS.accrualStartsAtMs, startMs);
    await Promise.all(writes);
    return this.get();
  }
}
