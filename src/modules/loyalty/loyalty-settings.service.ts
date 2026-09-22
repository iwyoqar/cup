import { BadRequestException, Injectable } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';

export interface LoyaltySettingsView {
  enabled: boolean;
  earnRate: number;
  earnUnitAmount: number;
  minimumOrderAmount: number;
  welcomeBonus: number;
  pointsExpireAfterDays: number;
  spendEnabled: boolean;
  pointValue: number;
}

// Every key lives under the "loyalty." prefix — Part 19's convention for how future modules
// (marketing.*, campaign.*, referral.*, business.*, ...) should namespace their own settings
// through the same generic SettingsService, with zero new schema.
const KEYS = {
  enabled: 'loyalty.enabled',
  earnRate: 'loyalty.earnRate',
  earnUnitAmount: 'loyalty.earnUnitAmount',
  minimumOrderAmount: 'loyalty.minimumOrderAmount',
  welcomeBonus: 'loyalty.welcomeBonus',
  pointsExpireAfterDays: 'loyalty.pointsExpireAfterDays',
  spendEnabled: 'loyalty.spendEnabled',
  pointValue: 'loyalty.pointValue',
} as const;

// Part 20: admin configuration is the source of truth for every configurable business rule —
// this code must never guess a business decision on its own. Every default here means "do
// nothing": until an admin explicitly enables loyalty and sets real values, no points are ever
// earned, spent, or granted.
const DEFAULTS: LoyaltySettingsView = {
  enabled: false,
  earnRate: 0,
  earnUnitAmount: 1000,
  minimumOrderAmount: 0,
  welcomeBonus: 0,
  pointsExpireAfterDays: 0,
  spendEnabled: false,
  pointValue: 1,
};

@Injectable()
export class LoyaltySettingsService {
  constructor(private readonly settings: SettingsService) {}

  async get(): Promise<LoyaltySettingsView> {
    const [enabled, earnRate, earnUnitAmount, minimumOrderAmount, welcomeBonus, pointsExpireAfterDays, spendEnabled, pointValue] =
      await Promise.all([
        this.settings.getBoolean(KEYS.enabled, DEFAULTS.enabled),
        this.settings.getInteger(KEYS.earnRate, DEFAULTS.earnRate),
        this.settings.getInteger(KEYS.earnUnitAmount, DEFAULTS.earnUnitAmount),
        this.settings.getInteger(KEYS.minimumOrderAmount, DEFAULTS.minimumOrderAmount),
        this.settings.getInteger(KEYS.welcomeBonus, DEFAULTS.welcomeBonus),
        this.settings.getInteger(KEYS.pointsExpireAfterDays, DEFAULTS.pointsExpireAfterDays),
        this.settings.getBoolean(KEYS.spendEnabled, DEFAULTS.spendEnabled),
        this.settings.getInteger(KEYS.pointValue, DEFAULTS.pointValue),
      ]);
    return { enabled, earnRate, earnUnitAmount, minimumOrderAmount, welcomeBonus, pointsExpireAfterDays, spendEnabled, pointValue };
  }

  // Partial update: only the fields actually present are written — a PATCH, not a full
  // replace. Server-side validation runs regardless of what the Admin frontend already
  // checked (Part 11: "Do not trust Admin frontend validation alone").
  async update(partial: Partial<LoyaltySettingsView>, updatedBy: string): Promise<LoyaltySettingsView> {
    const current = await this.get();
    const next: LoyaltySettingsView = { ...current, ...partial };
    validateLoyaltySettings(next);

    const writes: Promise<void>[] = [];
    if (partial.enabled !== undefined) writes.push(this.settings.setBoolean(KEYS.enabled, partial.enabled, updatedBy));
    if (partial.earnRate !== undefined) writes.push(this.settings.setInteger(KEYS.earnRate, partial.earnRate, updatedBy));
    if (partial.earnUnitAmount !== undefined)
      writes.push(this.settings.setInteger(KEYS.earnUnitAmount, partial.earnUnitAmount, updatedBy));
    if (partial.minimumOrderAmount !== undefined)
      writes.push(this.settings.setInteger(KEYS.minimumOrderAmount, partial.minimumOrderAmount, updatedBy));
    if (partial.welcomeBonus !== undefined) writes.push(this.settings.setInteger(KEYS.welcomeBonus, partial.welcomeBonus, updatedBy));
    if (partial.pointsExpireAfterDays !== undefined)
      writes.push(this.settings.setInteger(KEYS.pointsExpireAfterDays, partial.pointsExpireAfterDays, updatedBy));
    if (partial.spendEnabled !== undefined) writes.push(this.settings.setBoolean(KEYS.spendEnabled, partial.spendEnabled, updatedBy));
    if (partial.pointValue !== undefined) writes.push(this.settings.setInteger(KEYS.pointValue, partial.pointValue, updatedBy));
    await Promise.all(writes);

    return next;
  }
}

// Validates the FULL resulting settings object (current + partial merged), not just the
// fields being changed — so e.g. setting spendEnabled=true while pointValue is already 0 from
// an earlier save is caught too, not just the reverse order.
function validateLoyaltySettings(settings: LoyaltySettingsView): void {
  const nonNegativeIntegerFields: (keyof LoyaltySettingsView)[] = [
    'earnRate',
    'earnUnitAmount',
    'minimumOrderAmount',
    'welcomeBonus',
    'pointsExpireAfterDays',
    'pointValue',
  ];
  for (const field of nonNegativeIntegerFields) {
    const value = settings[field];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      throw new BadRequestException(`${field} must be a non-negative integer.`);
    }
  }
  if (settings.earnRate > 0 && settings.earnUnitAmount === 0) {
    throw new BadRequestException('earnUnitAmount cannot be 0 while earnRate is greater than 0 (division by zero).');
  }
  if (settings.spendEnabled && settings.pointValue === 0) {
    throw new BadRequestException('pointValue cannot be 0 while spending is enabled.');
  }
}
