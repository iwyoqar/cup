import { Injectable } from '@nestjs/common';
import { ConfigService } from '../../common/config/config.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AnalyticsPeriod, resolveAnalyticsRange } from '../analytics/analytics-period';
import { RewardProgramRecord } from './reward-program.types';
import { RewardProgramsRepository } from './reward-programs.repository';
import { toRecord } from './reward-programs.service';
import { RewardProgressRepository } from './reward-progress.repository';
import { RewardProgressService } from './reward-progress.service';
import { RewardRedemptionsRepository } from './reward-redemptions.repository';

export interface RewardReportQuery {
  period: AnalyticsPeriod;
  startDate?: string;
  endDate?: string;
}

export interface RewardReportTopCustomer {
  rank: number;
  customerId: string;
  customerName: string;
  phone: string | null;
  freeCoffeesRedeemed: number; // within the selected period — the ranking criterion
  qualifyingCoffees: number; // all-time cumulative, current status (see summary.qualifyingCoffees)
  currentProgress: { qualifyingCount: number; buyQuantity: number; availableRewards: number }; // current status, not period-scoped
  lastRedemptionAt: string;
}

export interface RewardReportRedemption {
  redeemedAt: string;
  customerId: string;
  customerName: string;
  rewardProductName: string;
  branchName: string | null; // null when the redemption has no linked CUP order (the POS-redeem path) — never inferred
  orderId: string | null;
}

export interface RewardReport {
  program: { id: string; name: string; buyQuantity: number; rewardQuantity: number; qualifyingCategoryName: string; isActive: boolean } | null;
  period: { key: AnalyticsPeriod; startDate: string; endDate: string; timezoneOffsetMinutes: number };
  summary: {
    participatingCustomers: number; // all-time, current status
    qualifyingCoffees: number; // all-time cumulative quantity, current status — NOT the occasion-count the engine uses for progress
    freeCoffeesRedeemed: number; // within the selected period
    rewardsAvailable: number; // current status
    customersWithAvailableReward: number; // current status
  };
  topCustomers: RewardReportTopCustomer[];
  recentRedemptions: RewardReportRedemption[];
  branchAttributionAvailable: boolean;
  notes: string[];
}

const TOP_N = 10;
const RECENT_LIMIT = 20;

// 5+1 Admin Report — READ-ONLY composition over the EXISTING reward engine (RewardProgressService/Repository,
// RewardRedemptionsRepository). No qualification rule, progress formula or redemption mechanism is redefined here;
// this only aggregates and presents what those already compute. Two time scopes are deliberately kept separate
// (see reward-report.controller usage and the field comments above): PERIOD ACTIVITY (redemption count, recent
// redemptions, Top 10 ranking) uses the selected date range; CURRENT CUSTOMER STATUS (qualifying coffees, current
// progress, rewards available) is always all-time, matching the engine's own cumulative design — never
// re-derived "as of a past date" (no event log exists to do that correctly, so it is not faked).
@Injectable()
export class RewardReportService {
  constructor(
    private readonly programsRepository: RewardProgramsRepository,
    private readonly progressRepository: RewardProgressRepository,
    private readonly progressService: RewardProgressService,
    private readonly redemptionsRepository: RewardRedemptionsRepository,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async getReport(query: RewardReportQuery, now: Date = new Date()): Promise<RewardReport> {
    const offset = this.config.env.BUSINESS_TIMEZONE_OFFSET_MINUTES;
    const range = resolveAnalyticsRange(query, now, offset);
    const period = { key: query.period, startDate: range.startDate, endDate: range.endDate, timezoneOffsetMinutes: offset };

    const program = await this.pickProgram();
    if (!program) {
      return {
        program: null,
        period,
        summary: { participatingCustomers: 0, qualifyingCoffees: 0, freeCoffeesRedeemed: 0, rewardsAvailable: 0, customersWithAvailableReward: 0 },
        topCustomers: [],
        recentRedemptions: [],
        branchAttributionAvailable: false,
        notes: ['No BUY_X_GET_Y reward program is currently configured.'],
      };
    }

    const [qualifyingIds, redeemedIds, freeCoffeesRedeemed, topRows, recentRows] = await Promise.all([
      this.progressRepository.distinctQualifyingCustomerIds(program.qualifyingCategoryId),
      this.redemptionsRepository.distinctCustomerIdsForProgram(program.id),
      this.redemptionsRepository.countForProgramInRange(program.id, range.from, range.to),
      this.redemptionsRepository.topCustomersForProgram(program.id, { from: range.from, to: range.to }, TOP_N),
      this.redemptionsRepository.recentForProgram(program.id, { from: range.from, to: range.to }, RECENT_LIMIT),
    ]);

    const participatingIds = [...new Set([...qualifyingIds, ...redeemedIds])];
    const [qualifyingQuantities, available] = await Promise.all([
      this.progressRepository.sumQualifyingQuantityForCustomers(participatingIds, program.qualifyingCategoryId),
      this.progressService.getAvailableForCustomers(program, participatingIds),
    ]);
    const qualifyingCoffees = [...qualifyingQuantities.values()].reduce((n, v) => n + v, 0);
    const rewardsAvailable = [...available.values()].reduce((n, v) => n + v.available, 0);

    const topCustomers = await this.buildTopCustomers(program, topRows);

    const recentRedemptions: RewardReportRedemption[] = recentRows.map((r) => ({
      redeemedAt: r.redeemedAt.toISOString(),
      customerId: r.customerId,
      customerName: r.customer.displayName ?? 'Unknown',
      rewardProductName: r.rewardProductName ?? 'Free coffee',
      branchName: r.order?.branch?.name ?? null,
      orderId: r.orderId,
    }));

    // Branch attribution is judged over ALL-TIME redemptions (not just this period's), so a quiet period never
    // makes the report wrongly claim branch data is unavailable.
    const branchAttributionAvailable = await this.anyRedemptionHasBranch(program.id);
    const notes: string[] = [];
    if (!branchAttributionAvailable) {
      notes.push('Reward redemptions have no reliable branch attribution in this data yet — most are redeemed at the POS with no linked CUP order. This report covers all branches.');
    }

    return {
      program: { id: program.id, name: program.name, buyQuantity: program.buyQuantity, rewardQuantity: program.rewardQuantity, qualifyingCategoryName: program.qualifyingCategory.name, isActive: program.isActive },
      period,
      summary: { participatingCustomers: participatingIds.length, qualifyingCoffees, freeCoffeesRedeemed, rewardsAvailable, customersWithAvailableReward: available.size },
      topCustomers,
      recentRedemptions,
      branchAttributionAvailable,
      notes,
    };
  }

  private async buildTopCustomers(program: RewardProgramRecord, topRows: { customerId: string; count: number; lastRedemptionAt: Date }[]): Promise<RewardReportTopCustomer[]> {
    if (topRows.length === 0) return [];
    const topIds = topRows.map((r) => r.customerId);
    // Bounded to exactly topRows.length (<= TOP_N) customers — never a query per customer over the full base.
    const [customers, topQualifyingQty, topQualifyingOccasions, topRedeemedAllTime] = await Promise.all([
      this.prisma.customer.findMany({ where: { id: { in: topIds } }, select: { id: true, displayName: true, phone: true } }),
      this.progressRepository.sumQualifyingQuantityForCustomers(topIds, program.qualifyingCategoryId),
      this.progressRepository.countQualifyingOccasionsForCustomers(topIds, program.qualifyingCategoryId),
      this.redemptionsRepository.countsForCustomers(program.id, topIds),
    ]);
    const customerById = new Map(customers.map((c) => [c.id, c]));

    return topRows.map((row, i) => {
      const totalQualifying = topQualifyingOccasions.get(row.customerId) ?? 0;
      const totalEarned = Math.floor(totalQualifying / program.buyQuantity);
      const redeemedAllTime = topRedeemedAllTime.get(row.customerId) ?? 0;
      const c = customerById.get(row.customerId);
      return {
        rank: i + 1,
        customerId: row.customerId,
        customerName: c?.displayName ?? 'Unknown',
        phone: c?.phone ?? null,
        freeCoffeesRedeemed: row.count,
        qualifyingCoffees: topQualifyingQty.get(row.customerId) ?? 0,
        currentProgress: { qualifyingCount: totalQualifying % program.buyQuantity, buyQuantity: program.buyQuantity, availableRewards: Math.max(0, totalEarned - redeemedAllTime) },
        lastRedemptionAt: row.lastRedemptionAt.toISOString(),
      };
    });
  }

  private async anyRedemptionHasBranch(rewardProgramId: string): Promise<boolean> {
    const row = await this.prisma.rewardRedemption.findFirst({ where: { rewardProgramId, order: { branchId: { not: null } } }, select: { id: true } });
    return row !== null;
  }

  // There may be several RewardProgram records (Part 2 of the spec: never blindly pick the first). The type
  // allowlist has only BUY_X_GET_Y today; among those, prefer an ACTIVE program, then the one whose configuration
  // literally IS "5 qualifying coffees -> 1 free" (buyQuantity 5, rewardQuantity 1), falling back to the
  // most-recently-updated candidate in whichever pool is non-empty. The chosen program's OWN configuration is
  // always what gets shown — nothing here hardcodes "5" or "1".
  private async pickProgram(): Promise<RewardProgramRecord | null> {
    const rows = await this.programsRepository.findMany({ take: 200 });
    const buyXGetY = rows.filter((r) => r.type === 'BUY_X_GET_Y');
    if (buyXGetY.length === 0) return null;
    const active = buyXGetY.filter((r) => r.isActive);
    const pool = active.length > 0 ? active : buyXGetY;
    const canonical = pool.find((r) => r.buyQuantity === 5 && r.rewardQuantity === 1);
    const chosen = canonical ?? [...pool].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
    return toRecord(chosen);
  }
}
