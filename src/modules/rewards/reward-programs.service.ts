import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '../../common/config/config.service';
import { isForeignKeyConstraintViolation } from '../../common/util/prisma-errors';
import { CatalogRepository } from '../catalog/catalog.repository';
import { RewardProgramType } from './reward-program-allowlist';
import {
  CustomerRewardProgramView,
  RewardProgramListItem,
  RewardProgramListPage,
  RewardProgramRecord,
  RewardProgramView,
} from './reward-program.types';
import { RewardProgressService } from './reward-progress.service';
import { RewardRedemptionsRepository } from './reward-redemptions.repository';
import { CreateRewardProgramInput, UpdateRewardProgramInput } from './reward-programs.dto';
import { RewardProgramLockedError, RewardProgramNotFoundError } from './reward-programs.errors';
import { RewardProgramsRepository, SaveRewardProgramData } from './reward-programs.repository';

interface RewardProgramRow {
  id: string;
  name: string;
  description: string | null;
  type: string;
  qualifyingCategoryId: string;
  qualifyingCategory: { id: string; name: string; isActive: boolean };
  buyQuantity: number;
  rewardQuantity: number;
  isActive: boolean;
  startsAt: Date;
  endsAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class RewardProgramsService {
  constructor(
    private readonly repository: RewardProgramsRepository,
    private readonly redemptionsRepository: RewardRedemptionsRepository,
    private readonly catalogRepository: CatalogRepository,
    private readonly progressService: RewardProgressService,
    private readonly config: ConfigService,
  ) {}

  async list(options: { cursor?: string; limit: number }): Promise<RewardProgramListPage> {
    const rows = await this.repository.findMany({ cursor: options.cursor, take: options.limit + 1 });
    const hasMore = rows.length > options.limit;
    const pageRows = hasMore ? rows.slice(0, options.limit) : rows;
    return {
      items: pageRows.map(toListItem),
      nextCursor: hasMore ? pageRows[pageRows.length - 1].id : null,
    };
  }

  async getById(id: string): Promise<RewardProgramView | null> {
    const row = await this.repository.findById(id);
    if (!row) {
      return null;
    }
    const redemptionCount = await this.redemptionsRepository.countForProgram(id);
    return toView(row, redemptionCount);
  }

  async create(input: CreateRewardProgramInput, adminId: string): Promise<RewardProgramView> {
    const dates = this.validateDates(input.startsAt, input.endsAt ?? null);
    await this.assertCategoryExists(input.qualifyingCategoryId);

    const data: SaveRewardProgramData = {
      name: input.name,
      description: input.description ?? null,
      type: input.type,
      qualifyingCategoryId: input.qualifyingCategoryId,
      buyQuantity: input.buyQuantity,
      rewardQuantity: input.rewardQuantity,
      isActive: input.isActive ?? false,
      startsAt: dates.startsAt,
      endsAt: dates.endsAt,
    };
    const created = await this.repository.create({ ...data, createdBy: adminId });
    return toView(created, 0);
  }

  async update(id: string, input: UpdateRewardProgramInput, adminId: string): Promise<RewardProgramView> {
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new RewardProgramNotFoundError();
    }

    const redemptionCount = await this.redemptionsRepository.countForProgram(id);
    const changesReward = input.qualifyingCategoryId !== undefined || input.buyQuantity !== undefined || input.rewardQuantity !== undefined;
    if (redemptionCount > 0 && changesReward) {
      // spec: "Do NOT silently rewrite history" — same benefit-locking rule Phase 7 applies to
      // Promotion once redemptions exist. Name/description/dates/active state remain editable.
      throw new RewardProgramLockedError();
    }

    let dates: { startsAt: Date; endsAt: Date | null } | null = null;
    if (input.startsAt !== undefined || input.endsAt !== undefined) {
      dates = this.validateDates(
        input.startsAt ?? existing.startsAt.toISOString(),
        input.endsAt !== undefined ? input.endsAt : (existing.endsAt?.toISOString() ?? null),
      );
    }
    if (input.qualifyingCategoryId !== undefined) {
      await this.assertCategoryExists(input.qualifyingCategoryId);
    }
    if (input.buyQuantity !== undefined && input.buyQuantity <= 0) {
      throw new BadRequestException('buyQuantity must be a positive integer.');
    }
    if (input.rewardQuantity !== undefined && input.rewardQuantity <= 0) {
      throw new BadRequestException('rewardQuantity must be a positive integer.');
    }

    const updated = await this.repository.update(id, {
      name: input.name,
      description: input.description,
      qualifyingCategoryId: input.qualifyingCategoryId,
      buyQuantity: input.buyQuantity,
      rewardQuantity: input.rewardQuantity,
      startsAt: dates?.startsAt,
      endsAt: dates ? dates.endsAt : undefined,
      isActive: input.isActive,
      updatedBy: adminId,
    });
    return toView(updated, redemptionCount);
  }

  async setActive(id: string, isActive: boolean, adminId: string): Promise<RewardProgramView> {
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new RewardProgramNotFoundError();
    }
    const updated = await this.repository.update(id, { isActive, updatedBy: adminId });
    const redemptionCount = await this.redemptionsRepository.countForProgram(id);
    return toView(updated, redemptionCount);
  }

  async delete(id: string): Promise<void> {
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new RewardProgramNotFoundError();
    }
    try {
      await this.repository.delete(id);
    } catch (err) {
      if (isForeignKeyConstraintViolation(err)) {
        throw new ConflictException('This reward program has redemption history and cannot be deleted.');
      }
      throw err;
    }
  }

  async getRedemptions(id: string, options: { cursor?: string; limit: number }) {
    const program = await this.repository.findById(id);
    if (!program) {
      return null;
    }
    const rows = await this.redemptionsRepository.list(id, { cursor: options.cursor, take: options.limit + 1 });
    const hasMore = rows.length > options.limit;
    const pageRows = hasMore ? rows.slice(0, options.limit) : rows;
    return {
      items: pageRows.map((row) => ({
        customerId: row.customerId,
        displayName: row.customer.displayName,
        phone: row.customer.phone,
        redemptionIndex: row.redemptionIndex,
        rewardProduct: row.rewardProductId ? { id: row.rewardProductId, name: row.rewardProductName ?? '' } : null,
        rewardQuantity: row.rewardQuantity,
        orderId: row.orderId,
        redeemedAt: row.redeemedAt.toISOString(),
      })),
      nextCursor: hasMore ? pageRows[pageRows.length - 1].id : null,
    };
  }

  // Customer-facing GET /loyalty/rewards (via LoyaltyController — see rewards.module.ts's
  // comment on why the route lives there). Bounded by "how many reward programs are
  // concurrently active" (spec's own tradeoff already accepted for Promotions' equivalent).
  async listForCustomer(customerId: string): Promise<CustomerRewardProgramView[]> {
    const programs = await this.repository.findActiveWithinValidity(new Date());
    const results: CustomerRewardProgramView[] = [];
    for (const row of programs) {
      const record = toRecord(row);
      const progress = await this.progressService.getProgress(record, customerId);
      results.push({
        programId: row.id,
        program: { name: row.name },
        threshold: row.buyQuantity,
        qualifyingCount: progress.qualifyingCount,
        availableRewards: progress.availableRewards,
        isActive: row.isActive,
        redeemable: this.config.env.REWARD_CHECKOUT_ENABLED,
        qualifyingCategoryId: row.qualifyingCategoryId,
      });
    }
    return results;
  }

  // Phase 16 (read-only): redemption history summary for the Staff profile — no ids.
  async redemptionSummaryForCustomer(customerId: string, take: number) {
    const { total, recent } = await this.redemptionsRepository.summaryForCustomer(customerId, take);
    return { total, recent: recent.map((r) => ({ programName: r.rewardProgram.name, productName: r.rewardProductName, quantity: r.rewardQuantity, redeemedAt: r.redeemedAt.toISOString() })) };
  }

  // Phase 15 (read-only): which of the given customers currently have rewards available in ANY active program — the bulk counterpart of listForCustomer
  // (same active-within-validity programs, same RewardProgressService math). No program active -> no query beyond the program list.
  async availableRewardsForCustomers(customerIds: string[]): Promise<Map<string, { programId: string; programName: string; earned: number; available: number }[]>> {
    const out = new Map<string, { programId: string; programName: string; earned: number; available: number }[]>();
    const programs = await this.repository.findActiveWithinValidity(new Date());
    for (const row of programs) {
      const available = await this.progressService.getAvailableForCustomers(toRecord(row), customerIds);
      for (const [customerId, v] of available) {
        const list = out.get(customerId) ?? [];
        list.push({ programId: row.id, programName: row.name, earned: v.earned, available: v.available });
        out.set(customerId, list);
      }
    }
    return out;
  }

  private async assertCategoryExists(categoryId: string): Promise<void> {
    const category = await this.catalogRepository.findCategoryById(categoryId);
    if (!category || !category.isActive) {
      throw new BadRequestException(`Category "${categoryId}" does not exist or is not active.`);
    }
  }

  private validateDates(startsAtRaw: string, endsAtRaw: string | null): { startsAt: Date; endsAt: Date | null } {
    const startsAt = new Date(startsAtRaw);
    if (Number.isNaN(startsAt.getTime())) {
      throw new BadRequestException('startsAt must be a valid date.');
    }
    let endsAt: Date | null = null;
    if (endsAtRaw !== null) {
      endsAt = new Date(endsAtRaw);
      if (Number.isNaN(endsAt.getTime())) {
        throw new BadRequestException('endsAt must be a valid date.');
      }
      if (endsAt <= startsAt) {
        throw new BadRequestException('endsAt must be after startsAt.');
      }
    }
    return { startsAt, endsAt };
  }
}

export function toRecord(row: RewardProgramRow): RewardProgramRecord {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    qualifyingCategoryId: row.qualifyingCategoryId,
    qualifyingCategory: row.qualifyingCategory,
    buyQuantity: row.buyQuantity,
    rewardQuantity: row.rewardQuantity,
    isActive: row.isActive,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
  };
}

function toListItem(row: RewardProgramRow): RewardProgramListItem {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type as RewardProgramType,
    qualifyingCategory: { id: row.qualifyingCategory.id, name: row.qualifyingCategory.name },
    buyQuantity: row.buyQuantity,
    rewardQuantity: row.rewardQuantity,
    isActive: row.isActive,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt ? row.endsAt.toISOString() : null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toView(row: RewardProgramRow, redemptionCount: number): RewardProgramView {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type as RewardProgramType,
    qualifyingCategory: { id: row.qualifyingCategory.id, name: row.qualifyingCategory.name },
    buyQuantity: row.buyQuantity,
    rewardQuantity: row.rewardQuantity,
    isActive: row.isActive,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt ? row.endsAt.toISOString() : null,
    redemptionCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
