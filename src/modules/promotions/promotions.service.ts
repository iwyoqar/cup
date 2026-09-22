import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { isForeignKeyConstraintViolation } from '../../common/util/prisma-errors';
import { CatalogRepository } from '../catalog/catalog.repository';
import { SegmentsService } from '../segments/segments.service';
import { isPromotionBenefitType, PromotionBenefitType } from './promotion-benefit-allowlist';
import { PromotionAudienceService } from './promotion-audience.service';
import { PromotionEligibilityService } from './promotion-eligibility.service';
import { toBenefitView } from './promotion-view.util';
import {
  CustomerPromotionView,
  PromotionAudiencePreviewPage,
  PromotionListItem,
  PromotionListPage,
  PromotionRecord,
  PromotionRedemptionItem,
  PromotionRedemptionsPage,
  PromotionView,
} from './promotion.types';
import { PromotionRedemptionsRepository } from './promotion-redemptions.repository';
import { CreatePromotionInput, UpdatePromotionInput } from './promotions.dto';
import { PromotionBenefitLockedError, PromotionNotFoundError } from './promotions.errors';
import { PromotionsRepository, SavePromotionData } from './promotions.repository';

interface PromotionRow {
  id: string;
  name: string;
  description: string | null;
  segmentId: string | null;
  segment: { id: string; name: string } | null;
  benefitType: string;
  benefitValue: number | null;
  benefitProductId: string | null;
  benefitProduct: { id: string; name: string; isActive: boolean } | null;
  benefitQuantity: number | null;
  startsAt: Date;
  endsAt: Date | null;
  isActive: boolean;
  usageLimitPerCustomer: number | null;
  createdAt: Date;
  updatedAt: Date;
}

// Orchestrates the promotion lifecycle. Business-rule validation (benefit shape, dates, segment/
// product existence) lives here — the same "controller has no business logic, service owns the
// rules, repository owns Prisma access" split as every other module in this project.
@Injectable()
export class PromotionsService {
  constructor(
    private readonly repository: PromotionsRepository,
    private readonly redemptionsRepository: PromotionRedemptionsRepository,
    private readonly segmentsService: SegmentsService,
    private readonly catalogRepository: CatalogRepository,
    private readonly audienceService: PromotionAudienceService,
    private readonly eligibilityService: PromotionEligibilityService,
  ) {}

  async list(options: { cursor?: string; limit: number }): Promise<PromotionListPage> {
    const rows = await this.repository.findMany({ cursor: options.cursor, take: options.limit + 1 });
    const hasMore = rows.length > options.limit;
    const pageRows = hasMore ? rows.slice(0, options.limit) : rows;
    return {
      items: pageRows.map(toListItem),
      nextCursor: hasMore ? pageRows[pageRows.length - 1].id : null,
    };
  }

  async getById(id: string): Promise<PromotionView | null> {
    const row = await this.repository.findById(id);
    if (!row) {
      return null;
    }
    const redemptionCount = await this.redemptionsRepository.countForPromotion(id);
    return toView(row, redemptionCount);
  }

  async create(input: CreatePromotionInput, adminId: string): Promise<PromotionView> {
    const dates = this.validateDates(input.startsAt, input.endsAt ?? null);
    if (input.segmentId) {
      await this.assertSegmentExists(input.segmentId);
    }
    const benefit = await this.validateBenefit({
      benefitType: input.benefitType,
      benefitValue: input.benefitValue,
      benefitProductId: input.benefitProductId,
      benefitQuantity: input.benefitQuantity,
    });

    const data: SavePromotionData = {
      name: input.name,
      description: input.description ?? null,
      segmentId: input.segmentId ?? null,
      ...benefit,
      startsAt: dates.startsAt,
      endsAt: dates.endsAt,
      isActive: input.isActive ?? false,
      usageLimitPerCustomer: input.usageLimitPerCustomer ?? null,
    };
    const created = await this.repository.create({ ...data, createdBy: adminId });
    return toView(created, 0);
  }

  async update(id: string, input: UpdatePromotionInput, adminId: string): Promise<PromotionView> {
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new PromotionNotFoundError();
    }

    const redemptionCount = await this.redemptionsRepository.countForPromotion(id);
    const changesBenefit =
      input.benefitType !== undefined ||
      input.benefitValue !== undefined ||
      input.benefitProductId !== undefined ||
      input.benefitQuantity !== undefined;
    if (redemptionCount > 0 && changesBenefit) {
      // spec: "Do NOT silently rewrite history" — once real redemptions exist, what the benefit
      // WAS is locked; every historical redemption already carries its own immutable snapshot
      // regardless, but this additionally stops the live definition from drifting away from what
      // admins/customers currently understand the promotion to mean.
      throw new PromotionBenefitLockedError();
    }

    let dates: { startsAt: Date; endsAt: Date | null } | null = null;
    if (input.startsAt !== undefined || input.endsAt !== undefined) {
      dates = this.validateDates(
        input.startsAt ?? existing.startsAt.toISOString(),
        input.endsAt !== undefined ? input.endsAt : existing.endsAt?.toISOString() ?? null,
      );
    }
    if (input.segmentId) {
      await this.assertSegmentExists(input.segmentId);
    }

    let benefit: Awaited<ReturnType<typeof this.validateBenefit>> | null = null;
    if (changesBenefit) {
      benefit = await this.validateBenefit({
        benefitType: input.benefitType ?? existing.benefitType,
        benefitValue: input.benefitValue !== undefined ? input.benefitValue : existing.benefitValue,
        benefitProductId: input.benefitProductId !== undefined ? input.benefitProductId : existing.benefitProductId,
        benefitQuantity: input.benefitQuantity !== undefined ? input.benefitQuantity : existing.benefitQuantity,
      });
    }

    const updated = await this.repository.update(id, {
      name: input.name,
      description: input.description,
      segmentId: input.segmentId,
      ...(benefit ?? {}),
      startsAt: dates?.startsAt,
      endsAt: dates ? dates.endsAt : undefined,
      isActive: input.isActive,
      usageLimitPerCustomer: input.usageLimitPerCustomer,
      updatedBy: adminId,
    });
    return toView(updated, redemptionCount);
  }

  async setActive(id: string, isActive: boolean, adminId: string): Promise<PromotionView> {
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new PromotionNotFoundError();
    }
    const updated = await this.repository.setActive(id, isActive, adminId);
    const redemptionCount = await this.redemptionsRepository.countForPromotion(id);
    return toView(updated, redemptionCount);
  }

  async delete(id: string): Promise<void> {
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new PromotionNotFoundError();
    }
    try {
      await this.repository.delete(id);
    } catch (err) {
      if (isForeignKeyConstraintViolation(err)) {
        throw new ConflictException('This promotion has redemption history and cannot be deleted.');
      }
      throw err;
    }
  }

  async getAudiencePreview(id: string, options: { cursor?: string; limit: number }): Promise<PromotionAudiencePreviewPage | null> {
    const promotion = await this.repository.findById(id);
    if (!promotion) {
      return null;
    }
    return this.audienceService.previewAudience(toRecord(promotion), options);
  }

  async getRedemptions(id: string, options: { cursor?: string; limit: number }): Promise<PromotionRedemptionsPage | null> {
    const promotion = await this.repository.findById(id);
    if (!promotion) {
      return null;
    }
    const rows = await this.redemptionsRepository.list(id, { cursor: options.cursor, take: options.limit + 1 });
    const hasMore = rows.length > options.limit;
    const pageRows = hasMore ? rows.slice(0, options.limit) : rows;
    return {
      items: pageRows.map(toRedemptionItem),
      nextCursor: hasMore ? pageRows[pageRows.length - 1].id : null,
    };
  }

  // Customer-facing GET /promotions (spec's Customer-Facing Promotions section): only promotions
  // the authenticated customer could actually use RIGHT NOW — active, within validity, eligible
  // (segment match + usage limit) for this specific customer. Never all promotions, never
  // another customer's data — customerId comes only from the authenticated session
  // (PromotionsController), never a caller-supplied id. Bounded by "how many promotions are
  // concurrently active," not by customer count — the founder is expected to run a small number
  // of these at once, so a per-promotion eligibility check here is not an N+1 concern.
  async listForCustomer(customerId: string): Promise<CustomerPromotionView[]> {
    const candidates = await this.repository.findActiveWithinValidity(new Date());
    const results: CustomerPromotionView[] = [];
    for (const row of candidates) {
      const record = toRecord(row);
      const eligibility = await this.eligibilityService.checkEligibility(record, customerId);
      if (!eligibility.eligible) {
        continue;
      }
      const remainingUses =
        row.usageLimitPerCustomer === null
          ? null
          : row.usageLimitPerCustomer - (await this.redemptionsRepository.countForCustomer(row.id, customerId));
      results.push({
        id: row.id,
        name: row.name,
        description: row.description,
        benefit: toBenefitView(row),
        startsAt: row.startsAt.toISOString(),
        endsAt: row.endsAt ? row.endsAt.toISOString() : null,
        remainingUses,
      });
    }
    return results;
  }

  private async assertSegmentExists(segmentId: string): Promise<void> {
    const segment = await this.segmentsService.getById(segmentId);
    if (!segment) {
      throw new BadRequestException(`Segment "${segmentId}" not found.`);
    }
  }

  // Full per-type allowlist enforcement (spec's explicit rules) plus the one DB-dependent check
  // a static schema can't express: a FREE_PRODUCT's product must actually exist and be active
  // at creation/edit time (it can still be deactivated LATER — that's an eligibility-time
  // concern, see promotion-eligibility.service.ts's isBenefitCurrentlyValid, not a create-time
  // rejection).
  private async validateBenefit(input: {
    benefitType: string;
    benefitValue: number | null | undefined;
    benefitProductId: string | null | undefined;
    benefitQuantity: number | null | undefined;
  }): Promise<{ benefitType: string; benefitValue: number | null; benefitProductId: string | null; benefitQuantity: number | null }> {
    if (!isPromotionBenefitType(input.benefitType)) {
      throw new BadRequestException(`Unknown benefit type "${input.benefitType}".`);
    }
    const type: PromotionBenefitType = input.benefitType;

    if (type === 'PERCENT_DISCOUNT') {
      const value = input.benefitValue;
      if (value === null || value === undefined || value <= 0 || value > 100) {
        throw new BadRequestException('PERCENT_DISCOUNT requires benefitValue between 1 and 100.');
      }
      return { benefitType: type, benefitValue: value, benefitProductId: null, benefitQuantity: null };
    }

    if (type === 'FIXED_DISCOUNT') {
      const value = input.benefitValue;
      if (value === null || value === undefined || value <= 0) {
        throw new BadRequestException('FIXED_DISCOUNT requires a positive benefitValue (minor units).');
      }
      return { benefitType: type, benefitValue: value, benefitProductId: null, benefitQuantity: null };
    }

    if (type === 'FREE_PRODUCT') {
      const productId = input.benefitProductId;
      const quantity = input.benefitQuantity;
      if (!productId) {
        throw new BadRequestException('FREE_PRODUCT requires benefitProductId.');
      }
      if (quantity === null || quantity === undefined || quantity < 1) {
        throw new BadRequestException('FREE_PRODUCT requires benefitQuantity >= 1.');
      }
      const product = await this.catalogRepository.findProductById(productId);
      if (!product || !product.isActive) {
        throw new BadRequestException(`Product "${productId}" does not exist or is not active.`);
      }
      return { benefitType: type, benefitValue: null, benefitProductId: productId, benefitQuantity: quantity };
    }

    // LOYALTY_POINTS
    const points = input.benefitValue;
    if (points === null || points === undefined || !Number.isInteger(points) || points <= 0) {
      throw new BadRequestException('LOYALTY_POINTS requires a positive integer benefitValue.');
    }
    return { benefitType: type, benefitValue: points, benefitProductId: null, benefitQuantity: null };
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

// Exported for Phase 23 (PosWidgetPromotionRedemptionService) — same reason reward-programs.service.ts exports its own toRecord.
export function toRecord(row: PromotionRow): PromotionRecord {
  return {
    id: row.id,
    name: row.name,
    segmentId: row.segmentId,
    benefitType: row.benefitType,
    benefitValue: row.benefitValue,
    benefitProductId: row.benefitProductId,
    benefitProduct: row.benefitProduct,
    benefitQuantity: row.benefitQuantity,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    isActive: row.isActive,
    usageLimitPerCustomer: row.usageLimitPerCustomer,
  };
}

function toListItem(row: PromotionRow): PromotionListItem {
  return {
    id: row.id,
    name: row.name,
    segment: row.segment,
    benefit: toBenefitView(row),
    isActive: row.isActive,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt ? row.endsAt.toISOString() : null,
    usageLimitPerCustomer: row.usageLimitPerCustomer,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toView(row: PromotionRow, redemptionCount: number): PromotionView {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    segment: row.segment,
    benefit: toBenefitView(row),
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt ? row.endsAt.toISOString() : null,
    isActive: row.isActive,
    usageLimitPerCustomer: row.usageLimitPerCustomer,
    redemptionCount,
    hasRedemptions: redemptionCount > 0,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

interface RedemptionRow {
  customerId: string;
  customer: { displayName: string | null; phone: string | null };
  usageIndex: number;
  benefitType: string;
  benefitValue: number | null;
  benefitProductId: string | null;
  benefitProductName: string | null;
  benefitQuantity: number | null;
  orderId: string | null;
  redeemedAt: Date;
}

function toRedemptionItem(row: RedemptionRow): PromotionRedemptionItem {
  return {
    customerId: row.customerId,
    displayName: row.customer.displayName,
    phone: row.customer.phone,
    usageIndex: row.usageIndex,
    benefit: {
      type: row.benefitType as PromotionBenefitType,
      value: row.benefitValue,
      product: row.benefitProductId ? { id: row.benefitProductId, name: row.benefitProductName ?? '' } : null,
      quantity: row.benefitQuantity,
    },
    orderId: row.orderId,
    redeemedAt: row.redeemedAt.toISOString(),
  };
}
