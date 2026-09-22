import { Injectable } from '@nestjs/common';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { isAchievementConditionType } from './loyalty2-defaults';
import { Loyalty2LevelsService } from './loyalty2-levels.service';
import { birthdayStatus, computeXp, XpProgress } from './loyalty2-math';
import { Loyalty2ProgressService } from './loyalty2-progress.service';
import { Loyalty2SettingsService } from './loyalty2-settings.service';
import { Loyalty2Repository } from './loyalty2.repository';

export interface LevelSummary {
  code: string;
  name: string;
  color: string;
  icon: string;
  minLifetimeSpend: number;
  cashbackRateBps: number;
  pointMultiplierPercent: number;
  prioritySupport: boolean;
}

export interface Loyalty2Profile {
  enabled: true;
  level: LevelSummary | null;
  nextLevel: (LevelSummary & { spendToNext: number }) | null;
  lifetimeSpend: number;
  purchaseCount: number;
  xp: XpProgress;
  points: { balance: number; lifetimeEarned: number; lifetimeSpent: number };
  cashback: { enabled: boolean; balance: number; lifetimeEarned: number; lifetimeSpent: number; currentRateBps: number };
  streak: { enabled: boolean; current: number; best: number; lastVisitDate: string | null };
  achievements: { code: string; name: string; description: string; icon: string; rewardPoints: number; unlocked: boolean; unlockedAt: string | null; progress: { current: number; target: number } }[];
  birthday: { enabled: boolean; birthdaySet: boolean; eligible: boolean; rewardPoints: number; windowEndsOn: string | null };
}
export type Loyalty2ProfileResult = Loyalty2Profile | { enabled: false };

const summarize = (l: { code: string; name: string; color: string; icon: string; minLifetimeSpend: number; cashbackRateBps: number; pointMultiplierPercent: number; prioritySupport: boolean }): LevelSummary => ({
  code: l.code,
  name: l.name,
  color: l.color,
  icon: l.icon,
  minLifetimeSpend: l.minLifetimeSpend,
  cashbackRateBps: l.cashbackRateBps,
  pointMultiplierPercent: l.pointMultiplierPercent,
  prioritySupport: l.prioritySupport,
});

// The READ model of everything Loyalty 2.0 shows a customer or an admin. Strictly read-only (no lazy creation, no sync): level,
// XP, streak and achievement progress are derived on the spot from canonical purchases, the cashback wallet is an aggregate of
// its ledger, points come from the existing LoyaltyService snapshot. Used by the Mini App (after a sync) and by Admin Customer
// 360 (never syncing — an admin viewing a profile must not change anything).
@Injectable()
export class Loyalty2ProfileService {
  constructor(
    private readonly repository: Loyalty2Repository,
    private readonly settingsService: Loyalty2SettingsService,
    private readonly levelsService: Loyalty2LevelsService,
    private readonly progress: Loyalty2ProgressService,
    private readonly loyalty: LoyaltyService,
  ) {}

  async getProfile(customerId: string, now: Date = new Date()): Promise<Loyalty2ProfileResult> {
    const settings = await this.settingsService.get();
    if (!settings.enabled) return { enabled: false };

    const [levels, totals, points, wallet, streakData, defs, unlocks, birthDate, claimedYears] = await Promise.all([
      this.levelsService.getActiveLevels(),
      this.repository.purchaseTotals(customerId),
      this.loyalty.getAccountSnapshot(customerId),
      this.repository.cashbackWallet(customerId),
      settings.streakEnabled ? this.progress.getStreak(customerId, now) : Promise.resolve(null),
      this.repository.findAchievements(),
      this.repository.unlocks(customerId),
      this.repository.findBirthDate(customerId),
      this.repository.claimedBirthdayYears(customerId),
    ]);

    const { current, next } = this.levelsService.resolve(levels, totals.spend);
    const unlockedAt = new Map(unlocks.map((u) => [u.achievementId, u.unlockedAt]));
    const shown = defs.filter((a) => (a.isActive || unlockedAt.has(a.id)) && isAchievementConditionType(a.conditionType));
    const evaluated = await this.progress.evaluate(customerId, shown, settings.streakEnabled, now);
    const bday = birthdayStatus(birthDate, this.progress.today(now), settings.birthdayWindowDays, claimedYears, settings.birthdayEnabled);

    return {
      enabled: true,
      level: current ? summarize(current) : null,
      nextLevel: next ? { ...summarize(next), spendToNext: Math.max(0, next.minLifetimeSpend - totals.spend) } : null,
      lifetimeSpend: totals.spend,
      purchaseCount: totals.count,
      xp: computeXp(totals.spend, current, next, settings.xpRate, settings.xpUnitAmount),
      points: points ?? { balance: 0, lifetimeEarned: 0, lifetimeSpent: 0 },
      cashback: { enabled: settings.cashbackEnabled, balance: wallet.balance, lifetimeEarned: wallet.earned, lifetimeSpent: wallet.spent, currentRateBps: current ? current.cashbackRateBps : 0 },
      streak: streakData ? { enabled: true, current: streakData.current, best: streakData.best, lastVisitDate: streakData.lastVisitDate } : { enabled: false, current: 0, best: 0, lastVisitDate: null },
      achievements: shown.map((a) => {
        const p = evaluated.get(a.id);
        const at = unlockedAt.get(a.id);
        return {
          code: a.code,
          name: a.name,
          description: a.description,
          icon: a.icon,
          rewardPoints: a.rewardPoints,
          unlocked: !!at,
          unlockedAt: at ? at.toISOString() : null,
          progress: { current: Math.min(p?.current ?? 0, a.conditionValue), target: a.conditionValue },
        };
      }),
      birthday: { enabled: settings.birthdayEnabled, birthdaySet: bday.birthdaySet, eligible: bday.eligible, rewardPoints: settings.birthdayRewardPoints, windowEndsOn: bday.windowEndsOn },
    };
  }

}
