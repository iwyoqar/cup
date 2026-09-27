import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import { isUniqueConstraintViolation } from '../../common/util/prisma-errors';
import { SubscriptionAuditService, SUBSCRIPTION_AUDIT } from './subscription-audit.service';
import { mappingCreateSchema, mappingUpdateSchema, planCreateSchema, planUpdateSchema } from './subscriptions.dto';
import { SubscriptionsRepository } from './subscriptions.repository';
import { planView } from './subscriptions.service';

// The owner's two launch plans. Written ONCE, only into an empty subscription_plans table (first boot after the migration) — from then
// on plans are configured in Admin → Subscriptions → Plans (plans are never deleted, only deactivated, so the table never becomes empty
// again). No product mapping is seeded: which CUP/Poster products are eligible, and whether each is 1 or 2 portions, is an explicit admin
// decision (never guessed from product names).
const DEFAULT_PLANS = [
  { name: '15 Coffee', description: null, priceMinor: 270_000, durationDays: 15, totalPortions: 15, dailyPortionLimit: 3, cooldownMinutes: 60, isActive: true, sortOrder: 10 },
  { name: '30 Coffee', description: null, priceMinor: 450_000, durationDays: 30, totalPortions: 30, dailyPortionLimit: 3, cooldownMinutes: 60, isActive: true, sortOrder: 20 },
];

@Injectable()
export class SubscriptionPlansService implements OnModuleInit {
  private readonly logger = new Logger(SubscriptionPlansService.name);

  constructor(
    private readonly repository: SubscriptionsRepository,
    private readonly audit: SubscriptionAuditService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      if ((await this.repository.countPlans()) > 0) return;
      for (const p of DEFAULT_PLANS) await this.repository.createPlan(p, 'system:default-plans');
      this.logger.log(`Seeded ${DEFAULT_PLANS.length} default subscription plans.`);
    } catch (err) {
      // A missing table (migration not yet applied) must never stop the backend from booting.
      this.logger.warn(`Default subscription plans not seeded: ${err instanceof Error ? err.message.split('\n')[0] : 'error'}`);
    }
  }

  async list() {
    return (await this.repository.listPlans(false)).map(planView);
  }

  async create(body: unknown, adminId: string) {
    const parsed = planCreateSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const d = parsed.data;
    const plan = await this.repository.createPlan({ ...d, description: d.description ?? null, isActive: d.isActive ?? true, sortOrder: d.sortOrder ?? 0 }, adminId);
    await this.audit.record({ type: 'ADMIN', id: adminId }, SUBSCRIPTION_AUDIT.PLAN_CHANGED, `CREATED:${plan.name}`, null);
    return planView(plan);
  }

  // Editing a plan only affects FUTURE purchases: every existing subscription carries its own snapshot of the terms it was bought with.
  async update(id: string, body: unknown, adminId: string) {
    const parsed = planUpdateSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    if (!(await this.repository.findPlan(id))) throw new NotFoundException('Plan not found.');
    const plan = await this.repository.updatePlan(id, parsed.data as z.infer<typeof planUpdateSchema>, adminId);
    await this.audit.record({ type: 'ADMIN', id: adminId }, SUBSCRIPTION_AUDIT.PLAN_CHANGED, `UPDATED:${plan.name}`, null);
    return planView(plan);
  }

  async listMappings() {
    const rows = await this.repository.listProductMappings(false);
    return rows.map((r) => ({
      id: r.id,
      productId: r.productId,
      productName: r.product.name,
      categoryName: r.product.category.name,
      posterProductId: r.product.posterProductId,
      productActive: r.product.isActive,
      priceMinor: r.product.priceMinor,
      theoreticalCostMinor: r.product.hasRecipe ? r.product.theoreticalCostMinor : null,
      portionCost: r.portionCost,
      isActive: r.isActive,
      usable: r.isActive && r.product.isActive,
      sortOrder: r.sortOrder,
    }));
  }

  async createMapping(body: unknown, adminId: string) {
    const parsed = mappingCreateSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const product = await this.repository.findProduct(parsed.data.productId);
    if (!product) throw new NotFoundException('Product not found.');
    try {
      await this.repository.createMapping({ productId: product.id, portionCost: parsed.data.portionCost, isActive: parsed.data.isActive ?? true, sortOrder: parsed.data.sortOrder ?? 0 }, adminId);
    } catch (err) {
      if (isUniqueConstraintViolation(err)) throw new ConflictException('This product is already mapped — edit the existing mapping.');
      throw err;
    }
    await this.audit.record({ type: 'ADMIN', id: adminId }, SUBSCRIPTION_AUDIT.PRODUCTS_CHANGED, `ADDED:${product.posterProductId}x${parsed.data.portionCost}`, null);
    return this.listMappings();
  }

  async updateMapping(id: string, body: unknown, adminId: string) {
    const parsed = mappingUpdateSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const existing = await this.repository.findMapping(id);
    if (!existing) throw new NotFoundException('Mapping not found.');
    await this.repository.updateMapping(id, parsed.data, adminId);
    await this.audit.record({ type: 'ADMIN', id: adminId }, SUBSCRIPTION_AUDIT.PRODUCTS_CHANGED, `UPDATED:${id}`, null);
    return this.listMappings();
  }
}
