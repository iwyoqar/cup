import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface ProductCostUpdate {
  id: string;
  hasRecipe: boolean;
  theoreticalCostMinor: number | null;
}

@Injectable()
export class FinanceCogsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // Every active product — the sync walks all of them each tick (bounded by the catalog's own
  // size, ~30 today) since menu.getProduct has no bulk form.
  findActiveProducts() {
    return this.prisma.product.findMany({ where: { isActive: true }, select: { id: true, posterProductId: true, name: true } });
  }

  async applyCostUpdates(updates: ProductCostUpdate[]): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction(
      updates.map((u) => this.prisma.product.update({ where: { id: u.id }, data: { hasRecipe: u.hasRecipe, theoreticalCostMinor: u.theoreticalCostMinor, costSyncedAt: now } })),
    );
  }

  // For the finance dashboard's "COGS data incomplete" flag — which active products, among the
  // ones actually sold in a period, have no recipe yet. Read separately per-period by the P&L
  // service (this just answers "does ANY active product still lack a recipe at all", a cheap
  // global check for the Overview banner).
  async countActiveWithoutRecipe(): Promise<number> {
    return this.prisma.product.count({ where: { isActive: true, hasRecipe: false } });
  }
}
