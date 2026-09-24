import { Injectable } from '@nestjs/common';
import { ConfigService } from '../../common/config/config.service';
import { AnalyticsPeriod, resolveAnalyticsRange } from '../analytics/analytics-period';
import { Loyalty2LevelsService } from '../loyalty2/loyalty2-levels.service';
import { Loyalty2SettingsService } from '../loyalty2/loyalty2-settings.service';
import { RewardProgramsRepository } from '../rewards/reward-programs.repository';
import { RewardProgressRepository } from '../rewards/reward-progress.repository';
import { RewardProgressService } from '../rewards/reward-progress.service';
import { RewardProgramRecord } from '../rewards/reward-program.types';
import { ReportsLoyaltyRepository } from './reports-loyalty.repository';

export interface LoyaltyReportQuery {
  period: AnalyticsPeriod;
  startDate?: string;
  endDate?: string;
  search?: string;
  page: number;
  limit: number;
}

export interface ReportsLoyaltyOverview {
  period: { key: AnalyticsPeriod; startDate: string; endDate: string; timezoneOffsetMinutes: number };
  loyalty2Enabled: boolean;
  // CURRENT STATE — never filtered by the selected period.
  current: {
    loyaltyCustomers: number; // customers with a LoyaltyAccount row (see note: accounts are created on first loyalty activity)
    pointsBalance: number; // sum of LoyaltyAccount.balance (the authoritative stored balance) — POINTS, not so'm
    rewardsAvailable: number; // RewardProgressService over the currently active reward programs
    customersWithAvailableReward: number;
    cashbackBalanceMinor: number; // CashbackTransaction ledger EARN - SPEND (Loyalty2's own wallet rule), whole UZS
  };
  levels: { code: string; name: string; color: string; minLifetimeSpend: number; customers: number; sharePercent: number | null }[];
  customersBelowFirstLevel: number;
  // PERIOD-SCOPED
  points: {
    earned: number;
    spent: number;
    netChange: number;
    customers: number; // distinct loyalty accounts with ledger activity in the period
    byType: { type: string; earned: number; spent: number; entries: number }[];
    spendFlowExists: false; // no CUP code path spends points yet — "spent" is a real ledger 0, not missing data
  };
  rewards: { redeemed: number; customers: number; programs: { rewardProgramId: string; name: string; type: string; redemptions: number; customers: number }[] };
  cashback: { grantedMinor: number; usedMinor: null; customers: number; usedTracked: false };
  achievements: { unlocked: number; customers: number; byAchievement: { achievementId: string; code: string; name: string; unlocks: number }[] };
  birthdayRewards: { claimed: number; customers: number; points: number };
  customerRows: { customerId: string; name: string | null; phone: string | null; level: string | null; pointsBalance: number; rewardsAvailable: number; cashbackBalanceMinor: number; achievements: number }[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
  notes: string[];
}

const pct1 = (part: number, whole: number) => (whole > 0 ? Math.round((part * 1000) / whole) / 10 : null);

// Reports Phase F1 — Loyalty. Descriptive only, over persisted records; no second loyalty engine:
//   LoyaltyAccount -> current points balance; Loyalty2LevelsService.resolve(levels, lifetime spend) -> current level (the
//   exact rule Loyalty 2.0 uses — levels are derived, never stored); LoyaltyTransaction -> points activity;
//   RewardRedemption -> successful rewards (attempts never count); RewardProgressService -> rewards available now;
//   CashbackTransaction -> cashback; CustomerAchievement -> achievements; BirthdayRewardClaim -> birthday rewards.
// All-branch: loyalty records carry no reliable branch, so none is inferred.
@Injectable()
export class ReportsLoyaltyService {
  constructor(
    private readonly repository: ReportsLoyaltyRepository,
    private readonly levels: Loyalty2LevelsService,
    private readonly loyaltySettings: Loyalty2SettingsService,
    private readonly programs: RewardProgramsRepository,
    private readonly progressRepository: RewardProgressRepository,
    private readonly progress: RewardProgressService,
    private readonly config: ConfigService,
  ) {}

  async getLoyalty(query: LoyaltyReportQuery, now: Date = new Date()): Promise<ReportsLoyaltyOverview> {
    const offset = this.config.env.BUSINESS_TIMEZONE_OFFSET_MINUTES;
    const range = resolveAnalyticsRange(query, now, offset);
    const r = { from: range.from, to: range.to };

    const [settings, accountTotals, levelDefs, loyaltyIds, allSpend, activePrograms, pointsByType, pointsCustomers, programs, redemptionCustomers, cashbackPeriod, cashbackAll, cashbackCustomers, achievements, achievementCustomers, birthday] =
      await Promise.all([
        this.loyaltySettings.get(),
        this.repository.accountTotals(),
        this.levels.getActiveLevels(),
        this.repository.loyaltyCustomerIds(),
        this.repository.lifetimeSpend(),
        this.programs.findActiveWithinValidity(now) as Promise<RewardProgramRecord[]>,
        this.repository.pointsByType(r),
        this.repository.pointsCustomers(r),
        this.repository.redemptionsByProgram(r),
        this.repository.redemptionCustomers(r),
        this.repository.cashbackByType(r),
        this.repository.cashbackByType(),
        this.repository.cashbackCustomers(r),
        this.repository.achievementUnlocks(r),
        this.repository.achievementCustomers(r),
        this.repository.birthdayClaims(r),
      ]);

    // Current level distribution over loyalty customers — same derivation as the Loyalty 2.0 profile.
    const levelCounts = new Map<string, number>();
    let belowFirst = 0;
    for (const id of loyaltyIds) {
      const { current } = this.levels.resolve(levelDefs, allSpend.get(id) ?? 0);
      if (current) levelCounts.set(current.code, (levelCounts.get(current.code) ?? 0) + 1);
      else belowFirst += 1;
    }

    // Rewards available now: RewardProgressService over each active program's qualifying customers (one grouped pass per program).
    let rewardsAvailable = 0;
    const withReward = new Set<string>();
    for (const program of activePrograms) {
      const ids = await this.progressRepository.distinctQualifyingCustomerIds(program.qualifyingCategoryId);
      const available = await this.progress.getAvailableForCustomers(program, ids);
      for (const [id, v] of available) {
        rewardsAvailable += v.available;
        withReward.add(id);
      }
    }

    // Points: "spent" follows Loyalty2HistoryService's own classification (negative points, or type SPEND).
    const byType = pointsByType.map((t) => ({ type: t.type, earned: t.type === 'SPEND' ? 0 : t.positive, spent: t.negative + (t.type === 'SPEND' ? t.positive : 0), entries: t.rows }));
    const earned = byType.reduce((s, t) => s + t.earned, 0);
    const spent = byType.reduce((s, t) => s + t.spent, 0);

    // Current-state customer table (one page; every lookup below is grouped over the page's ids).
    const skip = (query.page - 1) * query.limit;
    const { total, rows } = await this.repository.accountPage(query.search, skip, query.limit);
    const pageIds = rows.map((a) => a.customerId);
    const [pageSpend, pageCashback, pageAchievements] = await Promise.all([this.repository.lifetimeSpend(pageIds), this.repository.cashbackBalances(pageIds), this.repository.achievementCounts(pageIds)]);
    const pageRewards = new Map<string, number>();
    for (const program of activePrograms) {
      if (pageIds.length === 0) break;
      for (const [id, v] of await this.progress.getAvailableForCustomers(program, pageIds)) pageRewards.set(id, (pageRewards.get(id) ?? 0) + v.available);
    }

    const notes = [
      'Current balance, levels, available rewards and cashback balance describe today, not the selected period.',
      'Loyalty levels are derived from lifetime qualifying spend exactly as Loyalty 2.0 does — CUP stores no level history, so the distribution cannot be shown for a past date.',
      'No CUP flow spends loyalty points or cashback yet, so "spent" is a real zero from the ledger and cashback "used" is not tracked.',
      'Loyalty records have no reliable branch, so this report always covers all branches.',
    ];
    if (!settings.enabled) notes.unshift('Loyalty 2.0 is currently switched off in settings; historical records are still reported.');

    const cashbackBalance = (cashbackAll.get('EARN') ?? 0) - (cashbackAll.get('SPEND') ?? 0);
    const loyaltyCustomers = accountTotals.accounts;
    return {
      period: { key: query.period, startDate: range.startDate, endDate: range.endDate, timezoneOffsetMinutes: offset },
      loyalty2Enabled: settings.enabled,
      current: { loyaltyCustomers, pointsBalance: accountTotals.balance, rewardsAvailable, customersWithAvailableReward: withReward.size, cashbackBalanceMinor: cashbackBalance },
      levels: levelDefs.map((l) => ({ code: l.code, name: l.name, color: l.color, minLifetimeSpend: l.minLifetimeSpend, customers: levelCounts.get(l.code) ?? 0, sharePercent: pct1(levelCounts.get(l.code) ?? 0, loyaltyIds.length) })),
      customersBelowFirstLevel: belowFirst,
      points: { earned, spent, netChange: earned - spent, customers: pointsCustomers, byType, spendFlowExists: false },
      rewards: { redeemed: programs.reduce((s, p) => s + p.redemptions, 0), customers: redemptionCustomers, programs: programs.sort((a, b) => b.redemptions - a.redemptions || a.rewardProgramId.localeCompare(b.rewardProgramId)) },
      cashback: { grantedMinor: cashbackPeriod.get('EARN') ?? 0, usedMinor: null, customers: cashbackCustomers, usedTracked: false },
      achievements: { unlocked: achievements.reduce((s, a) => s + a.unlocks, 0), customers: achievementCustomers, byAchievement: achievements.sort((a, b) => b.unlocks - a.unlocks || a.name.localeCompare(b.name)) },
      birthdayRewards: { claimed: birthday.claims, customers: birthday.customers, points: birthday.points },
      customerRows: rows.map((a) => ({
        customerId: a.customerId,
        name: a.customer.displayName,
        phone: a.customer.phone,
        level: this.levels.resolve(levelDefs, pageSpend.get(a.customerId) ?? 0).current?.name ?? null,
        pointsBalance: a.balance,
        rewardsAvailable: pageRewards.get(a.customerId) ?? 0,
        cashbackBalanceMinor: pageCashback.get(a.customerId) ?? 0,
        achievements: pageAchievements.get(a.customerId) ?? 0,
      })),
      pagination: { page: query.page, limit: query.limit, total, totalPages: Math.max(1, Math.ceil(total / query.limit)) },
      notes,
    };
  }
}
