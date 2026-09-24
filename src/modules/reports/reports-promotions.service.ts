import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ConfigService } from '../../common/config/config.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AnalyticsPeriod, resolveAnalyticsRange } from '../analytics/analytics-period';

export type PromotionSortBy = 'redemptions' | 'customers' | 'lastRedemption';

export interface PromotionsReportQuery {
  period: AnalyticsPeriod;
  startDate?: string;
  endDate?: string;
  branchId?: string;
  promotionId?: string;
  sortBy: PromotionSortBy;
  sortDirection: 'asc' | 'desc';
}

export type PromotionCurrentStatus = 'ACTIVE' | 'INACTIVE' | 'SCHEDULED' | 'EXPIRED';

export interface ReportsPromotionRow {
  promotionId: string;
  promotionName: string;
  benefitType: string; // the model's own type (PERCENT_DISCOUNT | FIXED_DISCOUNT | FREE_PRODUCT | LOYALTY_POINTS)
  benefitValue: number | null; // CONFIGURED value (percent / so'm / points) — never an actual discount amount
  benefitProductName: string | null;
  benefitQuantity: number | null;
  status: PromotionCurrentStatus; // current state, independent of the period
  startsAt: string;
  endsAt: string | null;
  redemptions: number; // period
  uniqueCustomers: number; // period
  linkedOrders: number; // period, distinct non-null orderId
  firstRedemptionAt: string | null;
  lastRedemptionAt: string | null;
}

export interface ReportsPromotionRedemption {
  redemptionId: string;
  redeemedAt: string;
  promotionId: string;
  promotionName: string;
  customerId: string;
  customerName: string | null;
  orderId: string | null;
  branchName: string | null; // only via the linked Order.branchId
  benefitType: string;
  benefitValue: number | null; // snapshot of the configured benefit recorded on the redemption
  benefitProductName: string | null;
}

export interface ReportsPromotionsOverview {
  period: { key: AnalyticsPeriod; startDate: string; endDate: string; timezoneOffsetMinutes: number };
  branch: { id: string; name: string } | null;
  filters: { branches: { id: string; name: string }[]; promotions: { id: string; name: string }[] };
  summary: { activePromotions: number; promotionsUsed: number; totalRedemptions: number; uniqueCustomers: number; ordersWithPromotion: number; activeWithZeroRedemptions: number; redemptionsWithoutOrder: number };
  promotions: ReportsPromotionRow[];
  recentRedemptions: ReportsPromotionRedemption[];
  discountValueTracked: false;
  notes: string[];
}

const RECENT_LIMIT = 20;

// Mirrors PromotionEligibilityService.checkPromotionLevel (private): inactive flag, then not-started, then expired.
function currentStatus(p: { isActive: boolean; startsAt: Date; endsAt: Date | null }, now: Date): PromotionCurrentStatus {
  if (!p.isActive) return 'INACTIVE';
  if (now < p.startsAt) return 'SCHEDULED';
  if (p.endsAt && now > p.endsAt) return 'EXPIRED';
  return 'ACTIVE';
}

// Reports Phase F2 — Promotions. PromotionRedemption is the only usage source: a row exists only for a redemption the
// engine actually recorded (the model has no status; attempts live in PromotionRedemptionAttempt and never count).
// Discount AMOUNT is not persisted anywhere, so none is computed — only the configured benefit snapshot stored on the
// redemption is shown. No revenue is attributed to a promotion. Branch = the linked Order's branchId only; with a branch
// selected, redemptions without an order are excluded (and counted in the note).
@Injectable()
export class ReportsPromotionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async getPromotions(query: PromotionsReportQuery, now: Date = new Date()): Promise<ReportsPromotionsOverview> {
    const offset = this.config.env.BUSINESS_TIMEZONE_OFFSET_MINUTES;
    const range = resolveAnalyticsRange(query, now, offset);

    const [branches, promotions] = await Promise.all([
      this.prisma.branch.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      this.prisma.promotion.findMany({ select: { id: true, name: true, benefitType: true, benefitValue: true, benefitQuantity: true, benefitProduct: { select: { name: true } }, isActive: true, startsAt: true, endsAt: true }, orderBy: { name: 'asc' } }),
    ]);
    const branch = query.branchId ? await this.prisma.branch.findUnique({ where: { id: query.branchId }, select: { id: true, name: true } }) : null;
    if (query.branchId && !branch) throw new BadRequestException('Unknown branch.');
    if (query.promotionId && !promotions.some((p) => p.id === query.promotionId)) throw new BadRequestException('Unknown promotion.');

    const where: Prisma.PromotionRedemptionWhereInput = {
      redeemedAt: { gte: range.from, lt: range.to },
      ...(query.promotionId ? { promotionId: query.promotionId } : {}),
      ...(branch ? { order: { branchId: branch.id } } : {}),
    };
    const [perPromotion, customerPairs, orderPairs, customersAll, ordersAll, recent, withoutOrderAll] = await Promise.all([
      this.prisma.promotionRedemption.groupBy({ by: ['promotionId'], where, _count: { _all: true }, _min: { redeemedAt: true }, _max: { redeemedAt: true } }),
      this.prisma.promotionRedemption.groupBy({ by: ['promotionId', 'customerId'], where }),
      this.prisma.promotionRedemption.groupBy({ by: ['promotionId', 'orderId'], where: { ...where, orderId: { not: null } } }),
      this.prisma.promotionRedemption.groupBy({ by: ['customerId'], where }),
      this.prisma.promotionRedemption.groupBy({ by: ['orderId'], where: { ...where, orderId: { not: null } } }),
      this.prisma.promotionRedemption.findMany({
        where,
        orderBy: [{ redeemedAt: 'desc' }, { id: 'asc' }],
        take: RECENT_LIMIT,
        select: { id: true, redeemedAt: true, promotionId: true, customerId: true, orderId: true, benefitType: true, benefitValue: true, benefitProductName: true, promotion: { select: { name: true } }, customer: { select: { displayName: true } }, order: { select: { branch: { select: { name: true } } } } },
      }),
      // Redemptions in the period with no linked order: excluded by a branch filter, so they are counted for the note.
      branch ? this.prisma.promotionRedemption.count({ where: { redeemedAt: { gte: range.from, lt: range.to }, orderId: null, ...(query.promotionId ? { promotionId: query.promotionId } : {}) } }) : Promise.resolve(0),
    ]);

    const countBy = <T extends { promotionId: string }>(rows: T[]) => rows.reduce((m, r) => m.set(r.promotionId, (m.get(r.promotionId) ?? 0) + 1), new Map<string, number>());
    const customersBy = countBy(customerPairs);
    const ordersBy = countBy(orderPairs);
    const usage = new Map(perPromotion.map((p) => [p.promotionId, p]));

    const scoped = query.promotionId ? promotions.filter((p) => p.id === query.promotionId) : promotions;
    const rows: ReportsPromotionRow[] = scoped.map((p) => {
      const u = usage.get(p.id);
      return {
        promotionId: p.id,
        promotionName: p.name,
        benefitType: p.benefitType,
        benefitValue: p.benefitValue,
        benefitProductName: p.benefitProduct?.name ?? null,
        benefitQuantity: p.benefitQuantity,
        status: currentStatus(p, now),
        startsAt: p.startsAt.toISOString(),
        endsAt: p.endsAt ? p.endsAt.toISOString() : null,
        redemptions: u?._count._all ?? 0,
        uniqueCustomers: customersBy.get(p.id) ?? 0,
        linkedOrders: ordersBy.get(p.id) ?? 0,
        firstRedemptionAt: u?._min.redeemedAt ? u._min.redeemedAt.toISOString() : null,
        lastRedemptionAt: u?._max.redeemedAt ? u._max.redeemedAt.toISOString() : null,
      };
    });

    const active = rows.filter((r) => r.status === 'ACTIVE');
    const notes = [
      'Usage comes from recorded promotion redemptions only (eligibility checks and redemption attempts are never counted).',
      'Discount value is not tracked: redemptions store the configured benefit, not the discount actually applied to an order.',
      'Promotion status is the current state; redemption figures are for the selected period.',
    ];
    if (branch) notes.push(`Branch filter uses the redemption's linked order. ${withoutOrderAll} redemption(s) in this period have no linked order and cannot be attributed to a branch, so they are excluded.`);

    return {
      period: { key: query.period, startDate: range.startDate, endDate: range.endDate, timezoneOffsetMinutes: offset },
      branch,
      filters: { branches, promotions: promotions.map((p) => ({ id: p.id, name: p.name })) },
      summary: {
        activePromotions: promotions.filter((p) => currentStatus(p, now) === 'ACTIVE').length,
        promotionsUsed: perPromotion.length,
        totalRedemptions: perPromotion.reduce((s, p) => s + p._count._all, 0),
        uniqueCustomers: customersAll.length,
        ordersWithPromotion: ordersAll.length,
        activeWithZeroRedemptions: active.filter((r) => r.redemptions === 0).length,
        redemptionsWithoutOrder: withoutOrderAll,
      },
      promotions: sortPromotions(rows, query.sortBy, query.sortDirection),
      recentRedemptions: recent.map((r) => ({
        redemptionId: r.id,
        redeemedAt: r.redeemedAt.toISOString(),
        promotionId: r.promotionId,
        promotionName: r.promotion.name,
        customerId: r.customerId,
        customerName: r.customer.displayName,
        orderId: r.orderId,
        branchName: r.order?.branch?.name ?? null,
        benefitType: r.benefitType,
        benefitValue: r.benefitValue,
        benefitProductName: r.benefitProductName,
      })),
      discountValueTracked: false,
      notes,
    };
  }
}

// Default: redemptions desc, then lastRedemption desc, then promotionId asc. Never labelled "best".
function sortPromotions(rows: ReportsPromotionRow[], by: PromotionSortBy, direction: 'asc' | 'desc'): ReportsPromotionRow[] {
  const sign = direction === 'asc' ? 1 : -1;
  const last = (r: ReportsPromotionRow) => (r.lastRedemptionAt ? Date.parse(r.lastRedemptionAt) : -Infinity);
  const value = (r: ReportsPromotionRow) => (by === 'redemptions' ? r.redemptions : by === 'customers' ? r.uniqueCustomers : last(r));
  return [...rows].sort((a, b) => (value(a) - value(b)) * sign || last(b) - last(a) || (a.promotionId < b.promotionId ? -1 : a.promotionId > b.promotionId ? 1 : 0));
}
