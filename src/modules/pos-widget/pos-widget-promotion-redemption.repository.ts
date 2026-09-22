import { Injectable } from '@nestjs/common';
import { isUniqueConstraintViolation } from '../../common/util/prisma-errors';
import { Db, PrismaService } from '../../common/prisma/prisma.service';
import { PromotionRedemptionAttemptStatus, PromotionRedemptionFailureReason } from './pos-widget-promotion-redemption.types';

export interface CreatePromotionAttemptData {
  attemptId: string;
  customerId: string;
  promotionId: string;
  promotionName: string;
  benefitType: string;
  posterAccount: string;
  posterSpotId: string | null;
  posterTabletId: string | null;
  posterOrderId: string;
  employeeIdentifier: string | null;
}

// Mirrors pos-widget-reward-redemption.repository.ts's UNRESOLVED_STATUSES exactly, including the same "UNKNOWN blocks further attempts" rule — see
// that file's comment and D22-17/Phase 22.3 for why.
const UNRESOLVED_STATUSES: PromotionRedemptionAttemptStatus[] = ['REQUESTED', 'POSTER_MUTATING', 'UNKNOWN'];

@Injectable()
export class PosWidgetPromotionRedemptionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createRequestedTx(tx: Db, data: CreatePromotionAttemptData): Promise<{ created: boolean; row: PromotionAttemptRowLike }> {
    try {
      const row = await tx.promotionRedemptionAttempt.create({ data: { ...data, status: 'REQUESTED' satisfies PromotionRedemptionAttemptStatus } });
      return { created: true, row };
    } catch (err) {
      if (isUniqueConstraintViolation(err)) {
        const existing = await tx.promotionRedemptionAttempt.findUnique({ where: { attemptId: data.attemptId } });
        if (existing) return { created: false, row: existing };
      }
      throw err;
    }
  }

  findUnresolvedForCustomerPromotionTx(tx: Db, customerId: string, promotionId: string) {
    return tx.promotionRedemptionAttempt.findFirst({ where: { customerId, promotionId, status: { in: UNRESOLVED_STATUSES } } });
  }

  // Phase 23 — ONE POSTER ORDER = MAXIMUM ONE PROMOTION REDEMPTION, mirroring Phase 22.3's per-order guard exactly (a SEPARATE invariant from the
  // reward one — both a reward AND a promotion may each be redeemed once on the same order). Both checks run inside the SAME short "claim" transaction
  // as createRequestedTx/findUnresolvedForCustomerPromotionTx.
  findRedeemedForPosterOrderTx(tx: Db, posterOrderId: string) {
    return tx.promotionRedemptionAttempt.findFirst({ where: { posterOrderId, status: 'REDEEMED' satisfies PromotionRedemptionAttemptStatus } });
  }

  findUnresolvedForPosterOrderTx(tx: Db, posterOrderId: string, excludeAttemptRowId: string) {
    return tx.promotionRedemptionAttempt.findFirst({ where: { posterOrderId, id: { not: excludeAttemptRowId }, status: { in: UNRESOLVED_STATUSES } } });
  }

  findByAttemptId(attemptId: string) {
    return this.prisma.promotionRedemptionAttempt.findUnique({ where: { attemptId } });
  }

  markFailedTx(tx: Db, id: string, failureReason: PromotionRedemptionFailureReason) {
    return tx.promotionRedemptionAttempt.update({ where: { id }, data: { status: 'FAILED' satisfies PromotionRedemptionAttemptStatus, failureReason } });
  }

  markMutatingTx(tx: Db, id: string) {
    return tx.promotionRedemptionAttempt.update({ where: { id }, data: { status: 'POSTER_MUTATING' satisfies PromotionRedemptionAttemptStatus } });
  }

  markRedeemedTx(tx: Db, id: string, redemptionId: string, posterOrderId: string) {
    return tx.promotionRedemptionAttempt.update({ where: { id }, data: { status: 'REDEEMED' satisfies PromotionRedemptionAttemptStatus, redemptionId, confirmedAt: new Date(), redeemedForPosterOrderId: posterOrderId } });
  }

  markUnknownTx(tx: Db, id: string, failureReason: PromotionRedemptionFailureReason | null) {
    return tx.promotionRedemptionAttempt.update({ where: { id }, data: { status: 'UNKNOWN' satisfies PromotionRedemptionAttemptStatus, failureReason } });
  }
}

interface PromotionAttemptRowLike {
  id: string;
  attemptId: string;
  status: string;
  failureReason: string | null;
  promotionId: string;
  promotionName: string | null;
}
