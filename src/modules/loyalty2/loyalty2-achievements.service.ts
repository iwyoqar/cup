import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { isUniqueConstraintViolation } from '../../common/util/prisma-errors';
import { CatalogRepository } from '../catalog/catalog.repository';
import { isAchievementConditionType } from './loyalty2-defaults';
import { Loyalty2Repository } from './loyalty2.repository';

export interface AchievementInput {
  code: string;
  name: string;
  description: string;
  icon: string;
  conditionType: string;
  conditionValue: number;
  conditionParam?: number | null;
  categoryId?: string | null;
  rewardPoints: number;
  isActive: boolean;
  sortOrder?: number;
}

export interface AchievementView {
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
  isActive: boolean;
  sortOrder: number;
}

const CODE = /^[A-Z][A-Z0-9_]{1,31}$/;

// Admin management of achievement definitions. Conditions are an ALLOWLIST (loyalty2-defaults.ts) validated server-side; the
// category a CATEGORY_UNITS condition counts is chosen here by an admin and checked against the catalog — never hardcoded.
// Achievements are deactivated, not deleted, so a customer's unlock history always resolves to a name.
@Injectable()
export class Loyalty2AchievementsService {
  constructor(
    private readonly repository: Loyalty2Repository,
    private readonly catalog: CatalogRepository,
  ) {}

  async list(): Promise<AchievementView[]> {
    return (await this.repository.findAchievements()).map(toView);
  }

  async create(input: AchievementInput): Promise<AchievementView> {
    const data = await this.validate(input, null);
    try {
      return toView(await this.repository.createAchievement({ ...data, code: input.code }));
    } catch (err) {
      if (isUniqueConstraintViolation(err)) throw new ConflictException(`An achievement with code "${input.code}" already exists.`);
      throw err;
    }
  }

  async update(id: string, input: Partial<AchievementInput>): Promise<AchievementView> {
    const existing = await this.repository.findAchievementById(id);
    if (!existing) throw new NotFoundException('Achievement not found.');
    // The code is an identifier, never edited.
    const merged: AchievementInput = {
      code: existing.code,
      name: input.name ?? existing.name,
      description: input.description ?? existing.description,
      icon: input.icon ?? existing.icon,
      conditionType: input.conditionType ?? existing.conditionType,
      conditionValue: input.conditionValue ?? existing.conditionValue,
      conditionParam: input.conditionParam !== undefined ? input.conditionParam : existing.conditionParam,
      categoryId: input.categoryId !== undefined ? input.categoryId : existing.categoryId,
      rewardPoints: input.rewardPoints ?? existing.rewardPoints,
      isActive: input.isActive ?? existing.isActive,
      sortOrder: input.sortOrder ?? existing.sortOrder,
    };
    const data = await this.validate(merged, existing.code);
    return toView(await this.repository.updateAchievement(id, data));
  }

  private async validate(input: AchievementInput, existingCode: string | null) {
    if (existingCode === null && (typeof input.code !== 'string' || !CODE.test(input.code))) throw new BadRequestException('code must be 2-32 chars: A-Z, 0-9, _ and start with a letter.');
    if (typeof input.name !== 'string' || input.name.trim().length < 1 || input.name.length > 60) throw new BadRequestException('name must be 1-60 characters.');
    if (typeof input.description !== 'string' || input.description.length > 200) throw new BadRequestException('description must be at most 200 characters.');
    if (typeof input.icon !== 'string' || input.icon.length < 1 || input.icon.length > 16) throw new BadRequestException('icon must be 1-16 characters.');
    if (!isAchievementConditionType(input.conditionType)) throw new BadRequestException('Unknown conditionType.');
    if (!Number.isInteger(input.conditionValue) || input.conditionValue < 1 || input.conditionValue > 1_000_000) throw new BadRequestException('conditionValue must be an integer between 1 and 1,000,000.');
    if (!Number.isInteger(input.rewardPoints) || input.rewardPoints < 0 || input.rewardPoints > 1_000_000) throw new BadRequestException('rewardPoints must be an integer between 0 and 1,000,000.');
    if (typeof input.isActive !== 'boolean') throw new BadRequestException('isActive must be a boolean.');

    let categoryId: string | null = null;
    let conditionParam: number | null = null;
    if (input.conditionType === 'CATEGORY_UNITS') {
      if (input.categoryId) {
        const category = await this.catalog.findCategoryById(input.categoryId);
        if (!category || !category.isActive) throw new BadRequestException('categoryId does not exist or is not active.');
        categoryId = input.categoryId;
      } else if (input.isActive) {
        throw new BadRequestException('A CATEGORY_UNITS achievement needs a category before it can be active.');
      }
    }
    if (input.conditionType === 'MORNING_PURCHASES') {
      const hour = input.conditionParam ?? 11;
      if (!Number.isInteger(hour) || hour < 1 || hour > 23) throw new BadRequestException('conditionParam (the cutoff hour) must be an integer 1-23.');
      conditionParam = hour;
    }
    return {
      name: input.name.trim(),
      description: input.description,
      icon: input.icon,
      conditionType: input.conditionType,
      conditionValue: input.conditionValue,
      conditionParam,
      categoryId,
      rewardPoints: input.rewardPoints,
      isActive: input.isActive,
      sortOrder: Number.isInteger(input.sortOrder) ? (input.sortOrder as number) : 0,
    };
  }
}

function toView(row: AchievementView): AchievementView {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    icon: row.icon,
    conditionType: row.conditionType,
    conditionValue: row.conditionValue,
    conditionParam: row.conditionParam,
    categoryId: row.categoryId,
    rewardPoints: row.rewardPoints,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
  };
}
