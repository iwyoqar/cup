import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { buildSearchWhere } from '../admin-customers/admin-customers.repository';
import { CUSTOMER_METRICS_ORDER_STATUSES } from '../customer-metrics/customer-metrics-order-statuses';

export interface Range {
  from: Date;
  to: Date;
}

const STATUSES = [...CUSTOMER_METRICS_ORDER_STATUSES];
const ID_CHUNK = 500;

// Reports Phase F1 — read-only grouped queries over the PERSISTED loyalty records. Nothing here re-derives points or
// cashback from orders: points come from LoyaltyTransaction/LoyaltyAccount, cashback from CashbackTransaction, rewards
// from RewardRedemption, achievements from CustomerAchievement, birthday rewards from BirthdayRewardClaim.
@Injectable()
export class ReportsLoyaltyRepository {
  constructor(private readonly prisma: PrismaService) {}

  async accountTotals(): Promise<{ accounts: number; balance: number }> {
    const r = await this.prisma.loyaltyAccount.aggregate({ _count: { _all: true }, _sum: { balance: true } });
    return { accounts: r._count._all, balance: r._sum.balance ?? 0 };
  }

  // Period points activity grouped by ledger type, positive and negative movements kept apart.
  async pointsByType(range: Range): Promise<{ type: string; positive: number; negative: number; rows: number }[]> {
    const where = { createdAt: { gte: range.from, lt: range.to } };
    const [pos, neg] = await Promise.all([
      this.prisma.loyaltyTransaction.groupBy({ by: ['type'], where: { ...where, points: { gt: 0 } }, _sum: { points: true }, _count: { _all: true } }),
      this.prisma.loyaltyTransaction.groupBy({ by: ['type'], where: { ...where, points: { lt: 0 } }, _sum: { points: true }, _count: { _all: true } }),
    ]);
    const out = new Map<string, { type: string; positive: number; negative: number; rows: number }>();
    const e = (t: string) => out.get(t) ?? out.set(t, { type: t, positive: 0, negative: 0, rows: 0 }).get(t)!;
    for (const r of pos) Object.assign(e(r.type), { positive: r._sum.points ?? 0, rows: e(r.type).rows + r._count._all });
    for (const r of neg) Object.assign(e(r.type), { negative: -(r._sum.points ?? 0), rows: e(r.type).rows + r._count._all });
    return [...out.values()].sort((a, b) => a.type.localeCompare(b.type));
  }

  async pointsCustomers(range: Range): Promise<number> {
    const rows = await this.prisma.loyaltyTransaction.groupBy({ by: ['loyaltyAccountId'], where: { createdAt: { gte: range.from, lt: range.to } } });
    return rows.length;
  }

  // Lifetime qualifying spend per customer — the SAME purchase definition Loyalty2Repository.purchaseTotals uses for the
  // level (canonical CUP statuses + IMPORTED POS), in two grouped queries. `ids` limits it to one page when given.
  async lifetimeSpend(ids?: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    const run = async (chunk?: string[]) => {
      const [cup, pos] = await Promise.all([
        this.prisma.order.groupBy({ by: ['customerId'], where: { status: { in: STATUSES }, ...(chunk ? { customerId: { in: chunk } } : {}) }, _sum: { totalMinor: true } }),
        this.prisma.posterImportedTransaction.groupBy({ by: ['customerId'], where: { status: 'IMPORTED', customerId: chunk ? { in: chunk } : { not: null } }, _sum: { totalMinor: true } }),
      ]);
      for (const r of cup) out.set(r.customerId, (out.get(r.customerId) ?? 0) + (r._sum.totalMinor ?? 0));
      for (const r of pos) if (r.customerId) out.set(r.customerId, (out.get(r.customerId) ?? 0) + (r._sum.totalMinor ?? 0));
    };
    if (!ids) await run();
    else for (let i = 0; i < ids.length; i += ID_CHUNK) await run(ids.slice(i, i + ID_CHUNK));
    return out;
  }

  async loyaltyCustomerIds(): Promise<string[]> {
    return (await this.prisma.loyaltyAccount.findMany({ select: { customerId: true } })).map((r) => r.customerId);
  }

  async redemptionsByProgram(range: Range): Promise<{ rewardProgramId: string; name: string; type: string; redemptions: number; customers: number }[]> {
    const where = { redeemedAt: { gte: range.from, lt: range.to } };
    const [counts, pairs] = await Promise.all([
      this.prisma.rewardRedemption.groupBy({ by: ['rewardProgramId'], where, _count: { _all: true } }),
      this.prisma.rewardRedemption.groupBy({ by: ['rewardProgramId', 'customerId'], where }),
    ]);
    const programs = await this.prisma.rewardProgram.findMany({ where: { id: { in: counts.map((c) => c.rewardProgramId) } }, select: { id: true, name: true, type: true } });
    const names = new Map(programs.map((p) => [p.id, p]));
    return counts.map((c) => ({
      rewardProgramId: c.rewardProgramId,
      name: names.get(c.rewardProgramId)?.name ?? c.rewardProgramId,
      type: names.get(c.rewardProgramId)?.type ?? '—',
      redemptions: c._count._all,
      customers: pairs.filter((p) => p.rewardProgramId === c.rewardProgramId).length,
    }));
  }

  async redemptionCustomers(range: Range): Promise<number> {
    return (await this.prisma.rewardRedemption.groupBy({ by: ['customerId'], where: { redeemedAt: { gte: range.from, lt: range.to } } })).length;
  }

  async cashbackByType(range?: Range, ids?: string[]): Promise<Map<string, number>> {
    const rows = await this.prisma.cashbackTransaction.groupBy({
      by: ['type'],
      where: { ...(range ? { createdAt: { gte: range.from, lt: range.to } } : {}), ...(ids ? { customerId: { in: ids } } : {}) },
      _sum: { amountMinor: true },
    });
    return new Map(rows.map((r) => [r.type, r._sum.amountMinor ?? 0]));
  }

  async cashbackCustomers(range: Range): Promise<number> {
    return (await this.prisma.cashbackTransaction.groupBy({ by: ['customerId'], where: { createdAt: { gte: range.from, lt: range.to } } })).length;
  }

  // Cashback wallet per customer = EARN - SPEND of its ledger (Loyalty2Repository.cashbackTotals's rule), for one page.
  async cashbackBalances(ids: string[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.cashbackTransaction.groupBy({ by: ['customerId', 'type'], where: { customerId: { in: ids } }, _sum: { amountMinor: true } });
    const out = new Map<string, number>();
    for (const r of rows) {
      const amt = r._sum.amountMinor ?? 0;
      const signed = r.type === 'EARN' ? amt : r.type === 'SPEND' ? -amt : 0;
      out.set(r.customerId, (out.get(r.customerId) ?? 0) + signed);
    }
    return out;
  }

  async achievementUnlocks(range: Range): Promise<{ achievementId: string; code: string; name: string; unlocks: number }[]> {
    const rows = await this.prisma.customerAchievement.groupBy({ by: ['achievementId'], where: { unlockedAt: { gte: range.from, lt: range.to } }, _count: { _all: true } });
    const defs = await this.prisma.achievement.findMany({ where: { id: { in: rows.map((r) => r.achievementId) } }, select: { id: true, code: true, name: true } });
    const byId = new Map(defs.map((d) => [d.id, d]));
    return rows.map((r) => ({ achievementId: r.achievementId, code: byId.get(r.achievementId)?.code ?? '', name: byId.get(r.achievementId)?.name ?? r.achievementId, unlocks: r._count._all }));
  }

  async achievementCustomers(range: Range): Promise<number> {
    return (await this.prisma.customerAchievement.groupBy({ by: ['customerId'], where: { unlockedAt: { gte: range.from, lt: range.to } } })).length;
  }

  async achievementCounts(ids: string[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.customerAchievement.groupBy({ by: ['customerId'], where: { customerId: { in: ids } }, _count: { _all: true } });
    return new Map(rows.map((r) => [r.customerId, r._count._all]));
  }

  async birthdayClaims(range: Range): Promise<{ claims: number; customers: number; points: number }> {
    const where = { claimedAt: { gte: range.from, lt: range.to } };
    const [agg, customers] = await Promise.all([
      this.prisma.birthdayRewardClaim.aggregate({ where, _count: { _all: true }, _sum: { points: true } }),
      this.prisma.birthdayRewardClaim.groupBy({ by: ['customerId'], where }),
    ]);
    return { claims: agg._count._all, customers: customers.length, points: agg._sum.points ?? 0 };
  }

  // Current-state customer table: loyalty accounts ordered by current points balance (then customerId), paginated.
  async accountPage(search: string | undefined, skip: number, take: number) {
    const where: Prisma.LoyaltyAccountWhereInput = search?.trim() ? { customer: buildSearchWhere(search) } : {};
    const [total, rows] = await Promise.all([
      this.prisma.loyaltyAccount.count({ where }),
      this.prisma.loyaltyAccount.findMany({
        where,
        orderBy: [{ balance: 'desc' }, { customerId: 'asc' }],
        skip,
        take,
        select: { customerId: true, balance: true, lifetimeEarned: true, customer: { select: { displayName: true, phone: true } } },
      }),
    ]);
    return { total, rows };
  }
}
