import { BadRequestException, Injectable } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import { REWARD_TYPES, RewardType, SUPPORTED_REWARD_TYPES } from './referral.types';

// Phase 14 — every referral business rule lives in Admin configuration (Setting table, "referral." prefix), never in code. The master switch
// defaults to OFF: while it is off no /start ref_ attribution is stored, no code is issued, nothing qualifies and no reward is granted.
export interface ReferralSettings {
  enabled: boolean;
  referrerRewardType: RewardType;
  referrerRewardValue: number; // points the referrer earns per successful referral
  referredRewardType: RewardType;
  referredRewardValue: number; // points the friend earns after their first qualifying purchase
  minimumPurchaseAmount: number; // so'm; the qualifying purchase must be at least this much (a purchase is never qualifying below 1)
  rewardOnFirstPurchaseOnly: boolean; // true: only the friend's very first qualifying purchase can qualify the referral
  maxSuccessfulReferrals: number; // per referrer; 0 = unlimited
  attributionWindowDays: number; // 0 = the attribution never expires
}

const KEYS = {
  enabled: 'referral.enabled',
  referrerRewardType: 'referral.referrerRewardType',
  referrerRewardValue: 'referral.referrerRewardValue',
  referredRewardType: 'referral.referredRewardType',
  referredRewardValue: 'referral.referredRewardValue',
  minimumPurchaseAmount: 'referral.minimumPurchaseAmount',
  rewardOnFirstPurchaseOnly: 'referral.rewardOnFirstPurchaseOnly',
  maxSuccessfulReferrals: 'referral.maxSuccessfulReferrals',
  attributionWindowDays: 'referral.attributionWindowDays',
} as const;

// The reward values are editable STARTING values (the spec's own example), not business rules baked into code: the program is off until an
// admin switches it on, and Admin shows them right next to the switch.
export const REFERRAL_DEFAULTS: ReferralSettings = {
  enabled: false,
  referrerRewardType: 'POINTS',
  referrerRewardValue: 100,
  referredRewardType: 'POINTS',
  referredRewardValue: 50,
  minimumPurchaseAmount: 0,
  rewardOnFirstPurchaseOnly: true,
  maxSuccessfulReferrals: 10,
  attributionWindowDays: 30,
};

const asRewardType = (value: string, fallback: RewardType): RewardType => ((REWARD_TYPES as readonly string[]).includes(value) ? (value as RewardType) : fallback);

@Injectable()
export class ReferralSettingsService {
  constructor(private readonly settings: SettingsService) {}

  async get(): Promise<ReferralSettings> {
    const [enabled, referrerType, referrerValue, referredType, referredValue, minimum, firstOnly, maxSuccessful, windowDays] = await Promise.all([
      this.settings.getBoolean(KEYS.enabled, REFERRAL_DEFAULTS.enabled),
      this.settings.getString(KEYS.referrerRewardType, REFERRAL_DEFAULTS.referrerRewardType),
      this.settings.getInteger(KEYS.referrerRewardValue, REFERRAL_DEFAULTS.referrerRewardValue),
      this.settings.getString(KEYS.referredRewardType, REFERRAL_DEFAULTS.referredRewardType),
      this.settings.getInteger(KEYS.referredRewardValue, REFERRAL_DEFAULTS.referredRewardValue),
      this.settings.getInteger(KEYS.minimumPurchaseAmount, REFERRAL_DEFAULTS.minimumPurchaseAmount),
      this.settings.getBoolean(KEYS.rewardOnFirstPurchaseOnly, REFERRAL_DEFAULTS.rewardOnFirstPurchaseOnly),
      this.settings.getInteger(KEYS.maxSuccessfulReferrals, REFERRAL_DEFAULTS.maxSuccessfulReferrals),
      this.settings.getInteger(KEYS.attributionWindowDays, REFERRAL_DEFAULTS.attributionWindowDays),
    ]);
    return {
      enabled,
      referrerRewardType: asRewardType(referrerType, REFERRAL_DEFAULTS.referrerRewardType),
      referrerRewardValue: referrerValue,
      referredRewardType: asRewardType(referredType, REFERRAL_DEFAULTS.referredRewardType),
      referredRewardValue: referredValue,
      minimumPurchaseAmount: minimum,
      rewardOnFirstPurchaseOnly: firstOnly,
      maxSuccessfulReferrals: maxSuccessful,
      attributionWindowDays: windowDays,
    };
  }

  isEnabled(): Promise<boolean> {
    return this.settings.getBoolean(KEYS.enabled, REFERRAL_DEFAULTS.enabled);
  }

  // Partial update; the FULL resulting object is validated server-side (the DTO only checks shape).
  async update(partial: Partial<ReferralSettings>, updatedBy: string): Promise<ReferralSettings> {
    const next = { ...(await this.get()), ...partial };
    const int = (name: string, v: number, min: number, max: number) => {
      if (!Number.isInteger(v) || v < min || v > max) throw new BadRequestException(`${name} must be an integer between ${min} and ${max}.`);
    };
    int('referrerRewardValue', next.referrerRewardValue, 0, 1_000_000);
    int('referredRewardValue', next.referredRewardValue, 0, 1_000_000);
    int('minimumPurchaseAmount', next.minimumPurchaseAmount, 0, 1_000_000_000);
    int('maxSuccessfulReferrals', next.maxSuccessfulReferrals, 0, 1_000_000);
    int('attributionWindowDays', next.attributionWindowDays, 0, 3650);
    for (const [name, type] of [['referrerRewardType', next.referrerRewardType], ['referredRewardType', next.referredRewardType]] as const) {
      if (!SUPPORTED_REWARD_TYPES.includes(type)) throw new BadRequestException(`${name}: ${type} rewards are not available yet — only ${SUPPORTED_REWARD_TYPES.join(', ')} is supported.`);
    }

    const writes: Promise<void>[] = [];
    const bool = (k: string, v: boolean | undefined) => v !== undefined && writes.push(this.settings.setBoolean(k, v, updatedBy));
    const num = (k: string, v: number | undefined) => v !== undefined && writes.push(this.settings.setInteger(k, v, updatedBy));
    const str = (k: string, v: string | undefined) => v !== undefined && writes.push(this.settings.setString(k, v, updatedBy));
    bool(KEYS.enabled, partial.enabled);
    str(KEYS.referrerRewardType, partial.referrerRewardType);
    num(KEYS.referrerRewardValue, partial.referrerRewardValue);
    str(KEYS.referredRewardType, partial.referredRewardType);
    num(KEYS.referredRewardValue, partial.referredRewardValue);
    num(KEYS.minimumPurchaseAmount, partial.minimumPurchaseAmount);
    bool(KEYS.rewardOnFirstPurchaseOnly, partial.rewardOnFirstPurchaseOnly);
    num(KEYS.maxSuccessfulReferrals, partial.maxSuccessfulReferrals);
    num(KEYS.attributionWindowDays, partial.attributionWindowDays);
    await Promise.all(writes);
    return this.get();
  }
}
