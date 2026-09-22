import { Injectable } from '@nestjs/common';
import { CatalogRepository } from '../catalog/catalog.repository';
import { RewardProgressService } from './reward-progress.service';
import { RewardEligibilityReason, RewardEligibilityResult, RewardProgramRecord } from './reward-program.types';

// The single source of truth for "can this customer redeem this product as their free reward
// right now" — reused by the cart-selection endpoint, checkout re-validation, and the customer
// progress view. Takes an already-loaded RewardProgramRecord, same pattern as
// PromotionEligibilityService.
@Injectable()
export class RewardEligibilityService {
  constructor(
    private readonly progressService: RewardProgressService,
    private readonly catalogRepository: CatalogRepository,
  ) {}

  async checkEligibility(program: RewardProgramRecord, customerId: string, productId: string): Promise<RewardEligibilityResult> {
    const staticReason = this.checkProgramLevel(program);
    if (staticReason) {
      return { eligible: false, reason: staticReason };
    }

    // spec: "customer selects inactive product" / "customer selects non-coffee product" — both
    // server-validated regardless of what the Admin/Mini App UI already restricted.
    const product = await this.catalogRepository.findProductById(productId);
    if (!product || !product.isActive) {
      return { eligible: false, reason: 'PRODUCT_INACTIVE' };
    }
    if (product.categoryId !== program.qualifyingCategoryId) {
      return { eligible: false, reason: 'PRODUCT_NOT_QUALIFYING' };
    }

    const progress = await this.progressService.getProgress(program, customerId);
    if (progress.availableRewards < 1) {
      return { eligible: false, reason: 'NO_REWARD_AVAILABLE' };
    }

    return { eligible: true, reason: null };
  }

  private checkProgramLevel(program: RewardProgramRecord): RewardEligibilityReason | null {
    if (!program.isActive) {
      return 'INACTIVE';
    }
    const now = new Date();
    if (now < program.startsAt) {
      return 'NOT_STARTED';
    }
    if (program.endsAt && now > program.endsAt) {
      return 'EXPIRED';
    }
    return null;
  }
}
