import { Injectable } from '@nestjs/common';
import { OrderStatus } from '../../common/enums/order-status';
import { maskPhone } from '../../common/util/mask-phone';
import { CustomerMetricsService } from '../customer-metrics/customer-metrics.service';
import { LoyaltyCodeService } from '../customers/loyalty-code.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { AutomationsService } from '../automations/automations.service';
import { ReferralsService } from '../referrals/referrals.service';
import { GrowthIntelligenceService } from '../growth-intelligence/growth-intelligence.service';
import { Loyalty2ProfileResult, Loyalty2ProfileService } from '../loyalty2/loyalty2-profile.service';
import { PosPurchaseSummary, PosterImportedActivityService } from '../poster-import/poster-imported-activity.service';
import { PromotionsService } from '../promotions/promotions.service';
import { RewardProgramsService } from '../rewards/reward-programs.service';
import { SegmentsService } from '../segments/segments.service';
import { StaffRepository } from '../staff/staff.repository';
import { AdminCustomersRepository } from './admin-customers.repository';
import { CustomerActivityItem, CustomerActivityPage, CustomerActivityService } from './customer-activity.service';
import { CustomerActivityRepository } from './customer-activity.repository';
import { combineSources, pickFavoriteBranchId } from './customer-summary';

export interface AdminCustomerListItem {
  id: string;
  displayName: string | null;
  phone: string | null;
  username: string | null;
  orderCount: number;
  totalSpentMinor: number;
  lastOrderAt: string | null;
  // Phase 15 (additive, compact): unified (CUP + POS) lifecycle / RFM indicator for the row — null lifecycle = no qualifying purchase yet.
  growth: { lifecycleState: string | null; rfmScore: string | null; lastPurchaseAt: string | null; daysSinceLastPurchase: number | null; lifetimeRevenue: number; lifetimePurchases: number };
}

export interface AdminCustomerListPage {
  items: AdminCustomerListItem[];
  nextCursor: string | null;
}

export interface AdminCustomerRecentOrder {
  id: string;
  status: OrderStatus;
  totalMinor: number;
  branch: { id: string; name: string } | null;
  createdAt: string;
}

// Phase 11.4: every field that existed before is kept (`metrics`, `activity`, `favoriteBranch`, `recentOrders`,
// `recentPosPurchases` still mean CUP-only / POS-only exactly as before); the unified profile is the ADDITIVE
// `summary` / `promotions` / `segments` / `rewardHistory` / `recentActivity` fields and `loyalty.recent`. `profile.phone` is now
// masked (the full number is not needed to read a profile; the Customers list, which is searched by phone, is unchanged).
export interface AdminCustomer360 {
  profile: { displayName: string | null; phone: string | null; username: string | null };
  metrics: {
    orderCount: number;
    totalSpentMinor: number;
    averageOrderMinor: number;
    firstOrderAt: string | null;
    lastOrderAt: string | null;
  };
  loyalty: {
    balance: number;
    lifetimeEarned: number;
    lifetimeSpent: number;
    // Newest few ledger rows (read-only, from the existing LoyaltyService.listTransactions).
    recent: { type: string; points: number; balanceAfter: number; description: string | null; at: string }[];
  };
  favoriteBranch: { id: string; name: string } | null; // CUP orders only (legacy)
  recentOrders: AdminCustomerRecentOrder[];
  // Phase 11: the public identity code (what the customer's QR/barcode encodes) and whether a Poster
  // client is linked. The raw Poster client id is deliberately not exposed.
  identity: { loyaltyCode: string | null; posterLinked: boolean };
  // Phase 11.2: ADDITIVE. The existing `metrics` above still mean CUP orders only.
  activity: {
    cupOrderCount: number;
    cupOrderTotalMinor: number;
    importedPosOrderCount: number;
    importedPosOrderTotalMinor: number;
    combinedOrderCount: number;
    combinedSpendMinor: number;
  };
  recentPosPurchases: PosPurchaseSummary[];
  // Reward progress per active program — the SAME RewardProgressService figures the customer sees (unified CUP + POS).
  rewards: { programName: string; threshold: number; qualifyingCount: number; availableRewards: number }[];
  // Phase 11.4 (additive) -------------------------------------------------------------------------------------------
  // The single server-side unified summary (qualifying CUP orders + IMPORTED POS purchases, Analytics V1 rules).
  summary: {
    totalPurchases: number;
    totalRevenueMinor: number;
    averageCheckMinor: number;
    firstPurchaseAt: string | null;
    lastPurchaseAt: string | null;
    cupOrderCount: number;
    cupRevenueMinor: number;
    posPurchaseCount: number;
    posRevenueMinor: number;
    favoriteBranch: { name: string } | null; // across CUP + POS
    activeRewardCount: number;
    loyaltyBalance: number;
    promotionCount: number;
  };
  rewardHistory: { programName: string; productName: string | null; quantity: number; redeemedAt: string }[];
  promotions: { name: string; description: string | null; benefit: { type: string; value: number | null; productName: string | null; quantity: number | null }; endsAt: string | null; remainingUses: number | null }[];
  segments: { name: string; description: string | null }[];
  recentActivity: CustomerActivityItem[];
  // Phase 12 (additive): Loyalty 2.0 membership — level, XP, cashback wallet, achievements, streak, lifetime spend. Read-only
  // (Customer 360 never triggers a sync); `{ enabled: false }` while the program is switched off.
  membership: Loyalty2ProfileResult;
  // Phase 13 (additive): recent CRM automation activity for this customer (display-only; no ids, no technical errors).
  crmActivity: { automationName: string; triggerType: string; status: string; reason: string | null; at: string }[];
  // Phase 14 (additive): the customer's referral footprint. Read-only (never creates a code); the people they invited appear only as counts.
  referral: Awaited<ReturnType<ReferralsService['getCustomerSummary']>>;
  // Phase 15 (additive): descriptive Growth Intelligence — lifecycle, RFM, purchase counters, signals and opportunities (deterministic; never a prediction).
  growth: Awaited<ReturnType<GrowthIntelligenceService['getCustomerBlock']>>;
}

const RECENT_ORDERS_LIMIT = 5;
const RECENT_LOYALTY_LIMIT = 5;
const REWARD_HISTORY_LIMIT = 5;
const RECENT_ACTIVITY_LIMIT = 10;

@Injectable()
export class AdminCustomersService {
  constructor(
    private readonly repository: AdminCustomersRepository,
    private readonly loyaltyService: LoyaltyService,
    private readonly customerMetricsService: CustomerMetricsService,
    private readonly loyaltyCodeService: LoyaltyCodeService,
    private readonly staffRepository: StaffRepository,
    private readonly posterImportedActivityService: PosterImportedActivityService,
    private readonly rewardProgramsService: RewardProgramsService,
    private readonly promotionsService: PromotionsService,
    private readonly segmentsService: SegmentsService,
    private readonly activityService: CustomerActivityService,
    private readonly activityRepository: CustomerActivityRepository,
    private readonly loyalty2ProfileService: Loyalty2ProfileService,
    private readonly automationsService: AutomationsService,
    private readonly referralsService: ReferralsService,
    private readonly growthService: GrowthIntelligenceService,
  ) {}

  async listCustomers(options: { search?: string; cursor?: string; limit: number }): Promise<AdminCustomerListPage> {
    const { customers, metricsByCustomerId } = await this.repository.findManyWithMetrics({
      search: options.search,
      cursor: options.cursor,
      take: options.limit + 1,
    });
    const hasMore = customers.length > options.limit;
    const pageRows = hasMore ? customers.slice(0, options.limit) : customers;
    // ONE aggregate query for the whole page (never one per row).
    const indicators = await this.growthService.getListIndicators(pageRows.map((c) => c.id));

    return {
      items: pageRows.map((customer) => {
        const metrics = metricsByCustomerId.get(customer.id);
        return {
          id: customer.id,
          displayName: customer.displayName,
          phone: customer.phone,
          username: customer.telegramAccount?.username ?? null,
          orderCount: metrics?.orderCount ?? 0,
          totalSpentMinor: metrics?.totalSpentMinor ?? 0,
          lastOrderAt: metrics?.lastOrderAt ? metrics.lastOrderAt.toISOString() : null,
          growth: indicators.get(customer.id)!,
        };
      }),
      nextCursor: hasMore ? pageRows[pageRows.length - 1].id : null,
    };
  }

  // Returns null when the customer doesn't exist — the controller maps that to a 404. Every block below is derived from
  // the canonical existing services/tables (no cache, no snapshot, no Poster call); the fetches are independent and issued
  // together, each one bounded (aggregates, top-N lists, fixed-size joins) — nothing scales with the customer's history.
  async getCustomer360(customerId: string): Promise<AdminCustomer360 | null> {
    const customer = await this.repository.findCustomerById(customerId);
    if (!customer) {
      return null;
    }

    const [cup, pos, recentOrders, loyaltySnapshot, loyaltyPage, rewardPrograms, redemptions, promotions, segments, feed, membership, crmActivity, referral, growth] = await Promise.all([
      this.customerMetricsService.getSummaryForCustomer(customerId),
      this.posterImportedActivityService.getForCustomer(customerId),
      this.customerMetricsService.getRecentOrdersForCustomer(customerId, RECENT_ORDERS_LIMIT),
      this.loyaltyService.getAccountSnapshot(customerId),
      this.loyaltyService.listTransactions(customerId, { limit: RECENT_LOYALTY_LIMIT }),
      this.rewardProgramsService.listForCustomer(customerId),
      this.activityRepository.rewardRedemptions(customerId, null, REWARD_HISTORY_LIMIT),
      this.promotionsService.listForCustomer(customerId),
      this.segmentsService.listMatchingForCustomer(customerId),
      this.activityService.getFeed(customerId, { limit: RECENT_ACTIVITY_LIMIT, filter: 'all' }),
      this.loyalty2ProfileService.getProfile(customerId),
      this.automationsService.recentForCustomer(customerId),
      this.referralsService.getCustomerSummary(customerId),
      this.growthService.getCustomerBlock(customerId),
    ]);

    const loyalty = loyaltySnapshot ?? { balance: 0, lifetimeEarned: 0, lifetimeSpent: 0 };
    const branchName = (id: string | null) => (id ? (cup.branchNameById[id] ?? null) : null);
    const cupFavoriteId = pickFavoriteBranchId(cup.branches);
    const unified = combineSources(
      { count: cup.metrics.orderCount, totalMinor: cup.metrics.totalSpentMinor, firstAt: cup.metrics.firstOrderAt, lastAt: cup.metrics.lastOrderAt, branches: cup.branches },
      { count: pos.count, totalMinor: pos.totalMinor, firstAt: pos.firstAt, lastAt: pos.lastAt, branches: pos.branches },
    );
    const unifiedFavoriteName = branchName(unified.favoriteBranchId);
    const rewards = rewardPrograms.map((r) => ({ programName: r.program.name, threshold: r.threshold, qualifyingCount: r.qualifyingCount, availableRewards: r.availableRewards }));

    return {
      profile: {
        displayName: customer.displayName,
        phone: maskPhone(customer.phone),
        username: customer.telegramAccount?.username ?? null,
      },
      metrics: {
        orderCount: cup.metrics.orderCount,
        totalSpentMinor: cup.metrics.totalSpentMinor,
        averageOrderMinor: cup.metrics.averageOrderMinor,
        firstOrderAt: cup.metrics.firstOrderAt ? cup.metrics.firstOrderAt.toISOString() : null,
        lastOrderAt: cup.metrics.lastOrderAt ? cup.metrics.lastOrderAt.toISOString() : null,
      },
      loyalty: {
        ...loyalty,
        recent: loyaltyPage.items.map((t) => ({ type: t.type, points: t.points, balanceAfter: t.balanceAfter, description: t.description, at: t.createdAt })),
      },
      favoriteBranch: cupFavoriteId && branchName(cupFavoriteId) ? { id: cupFavoriteId, name: branchName(cupFavoriteId) as string } : null,
      identity: { loyaltyCode: customer.loyaltyCode, posterLinked: customer.posterClientId !== null },
      activity: {
        cupOrderCount: cup.metrics.orderCount,
        cupOrderTotalMinor: cup.metrics.totalSpentMinor,
        importedPosOrderCount: pos.count,
        importedPosOrderTotalMinor: pos.totalMinor,
        combinedOrderCount: unified.totalPurchases,
        combinedSpendMinor: unified.totalRevenueMinor,
      },
      recentPosPurchases: pos.recent,
      rewards,
      recentOrders: recentOrders.map((order) => ({
        id: order.id,
        status: order.status as OrderStatus,
        totalMinor: order.totalMinor,
        branch: order.branch ? { id: order.branch.id, name: order.branch.name } : null,
        createdAt: order.createdAt.toISOString(),
      })),
      summary: {
        totalPurchases: unified.totalPurchases,
        totalRevenueMinor: unified.totalRevenueMinor,
        averageCheckMinor: unified.averageCheckMinor,
        firstPurchaseAt: unified.firstPurchaseAt ? unified.firstPurchaseAt.toISOString() : null,
        lastPurchaseAt: unified.lastPurchaseAt ? unified.lastPurchaseAt.toISOString() : null,
        cupOrderCount: unified.cupOrderCount,
        cupRevenueMinor: unified.cupRevenueMinor,
        posPurchaseCount: unified.posPurchaseCount,
        posRevenueMinor: unified.posRevenueMinor,
        favoriteBranch: unifiedFavoriteName ? { name: unifiedFavoriteName } : null,
        activeRewardCount: rewards.reduce((sum, r) => sum + r.availableRewards, 0),
        loyaltyBalance: loyalty.balance,
        promotionCount: promotions.length,
      },
      rewardHistory: redemptions.map((r) => ({ programName: r.rewardProgram.name, productName: r.rewardProductName, quantity: r.rewardQuantity, redeemedAt: r.redeemedAt.toISOString() })),
      promotions: promotions.map((p) => ({
        name: p.name,
        description: p.description,
        benefit: { type: p.benefit.type, value: p.benefit.value, productName: p.benefit.product ? p.benefit.product.name : null, quantity: p.benefit.quantity },
        endsAt: p.endsAt,
        remainingUses: p.remainingUses,
      })),
      segments,
      recentActivity: feed.items,
      membership,
      crmActivity,
      referral,
      growth,
    };
  }

  // Phase 11.4: cursor-paginated unified activity for ONE customer (the :id is an Admin-selected resource, never an
  // identity claim). Returns null when the customer doesn't exist.
  async getCustomerActivity(customerId: string, options: { cursor?: string; limit: number; filter: 'purchases' | 'all' }): Promise<CustomerActivityPage | null> {
    const customer = await this.repository.findCustomerById(customerId);
    if (!customer) {
      return null;
    }
    return this.activityService.getFeed(customerId, options);
  }

  // Phase 11: explicit, admin-triggered replacement of the public code. The old code (and any QR already
  // shown or printed) stops resolving immediately. Audited (who/when/which customer — never the codes).
  async regenerateLoyaltyCode(customerId: string, adminId: string): Promise<{ loyaltyCode: string } | null> {
    const customer = await this.repository.findCustomerById(customerId);
    if (!customer) {
      return null;
    }
    const loyaltyCode = await this.loyaltyCodeService.regenerate(customerId);
    await this.staffRepository.recordEvent({ actorType: 'ADMIN', actorId: adminId, action: 'CODE_REGENERATED', result: 'OK', customerId });
    return { loyaltyCode };
  }
}
