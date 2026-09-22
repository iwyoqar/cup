import { Injectable } from '@nestjs/common';
import { ConfigService } from '../../common/config/config.service';
import { RewardProgressRepository } from '../rewards/reward-progress.repository';
import { AchievementConditionType, isAchievementConditionType } from './loyalty2-defaults';
import { computeStreak, Streak } from './loyalty2-math';
import { Loyalty2Repository } from './loyalty2.repository';
import { businessDateOf } from '../analytics/analytics-period';

export interface AchievementDef {
  id: string;
  code: string;
  name: string;
  description: string;
  icon: string;
  conditionType: string;
  conditionValue: number;
  conditionParam: number | null;
  categoryId: string | null;
  rewardPoints: number;
}

export interface AchievementProgress {
  current: number;
  target: number;
  met: boolean;
}

// Evaluates achievement conditions from CANONICAL data only (qualifying CUP orders + imported POS, reward redemptions), reusing
// the reward engine's own category-unit count. Progress is always derived; nothing here writes.
@Injectable()
export class Loyalty2ProgressService {
  constructor(
    private readonly repository: Loyalty2Repository,
    private readonly rewardProgressRepository: RewardProgressRepository,
    private readonly config: ConfigService,
  ) {}

  offsetMinutes(): number {
    return this.config.env.BUSINESS_TIMEZONE_OFFSET_MINUTES;
  }

  today(now: Date = new Date()): string {
    return businessDateOf(now, this.offsetMinutes());
  }

  async getStreak(customerId: string, now: Date = new Date()): Promise<Streak> {
    return computeStreak(await this.repository.visitDays(customerId, this.offsetMinutes()), this.today(now));
  }

  // Current value of each achievement's metric for one customer. Each metric is computed at most once (a category's units per
  // categoryId), and only for the conditions that are actually configured.
  async evaluate(customerId: string, achievements: AchievementDef[], streakEnabled: boolean, now: Date = new Date()): Promise<Map<string, AchievementProgress>> {
    const result = new Map<string, AchievementProgress>();
    if (achievements.length === 0) return result;
    const memo = new Map<string, Promise<number>>();
    const once = (key: string, load: () => Promise<number>) => {
      if (!memo.has(key)) memo.set(key, load());
      return memo.get(key) as Promise<number>;
    };
    const offset = this.offsetMinutes();
    await Promise.all(
      achievements.map(async (a) => {
        let current = 0;
        if (!isAchievementConditionType(a.conditionType)) {
          result.set(a.id, { current: 0, target: a.conditionValue, met: false });
          return;
        }
        switch (a.conditionType as AchievementConditionType) {
          case 'TOTAL_PURCHASES':
            current = await once('purchases', async () => (await this.repository.purchaseTotals(customerId)).count);
            break;
          case 'CATEGORY_UNITS':
            current = a.categoryId ? await once(`cat:${a.categoryId}`, () => this.rewardProgressRepository.sumQualifyingQuantity(customerId, a.categoryId as string)) : 0;
            break;
          case 'MORNING_PURCHASES':
            current = await once(`morning:${a.conditionParam ?? 11}`, () => this.repository.countMorningPurchases(customerId, a.conditionParam ?? 11, offset));
            break;
          case 'WEEKEND_PURCHASES':
            current = await once('weekend', () => this.repository.countWeekendPurchases(customerId, offset));
            break;
          case 'BEST_STREAK':
            current = streakEnabled ? await once('best', async () => (await this.getStreak(customerId, now)).best) : 0;
            break;
          case 'REWARD_REDEMPTIONS':
            current = await once('redemptions', () => this.repository.redemptionCount(customerId));
            break;
        }
        result.set(a.id, { current, target: a.conditionValue, met: current >= a.conditionValue });
      }),
    );
    return result;
  }
}
