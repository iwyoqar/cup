import { Injectable } from '@nestjs/common';
import { isUniqueConstraintViolation } from '../../common/util/prisma-errors';
import { Db, PrismaService } from '../../common/prisma/prisma.service';
import { RedemptionAttemptStatus, RedemptionFailureReason } from './pos-widget-reward-redemption.types';

export interface CreateAttemptData {
  attemptId: string;
  customerId: string;
  rewardProgramId: string;
  rewardProductId: string | null;
  rewardProductName: string | null;
  posterAccount: string;
  posterSpotId: string | null;
  posterTabletId: string | null;
  posterOrderId: string;
  employeeIdentifier: string | null;
}

// Statuses a NEW attempt for the same (customer, program) must not be allowed to start alongside — REDEEMED and FAILED are terminal; everything else is
// still "in flight or unresolved" (UNKNOWN is explicitly never auto-retried, so a second attempt while one is UNKNOWN would risk a duplicate Poster
// mutation once one exists — see docs/PHASE-22-AUDIT.md §25).
const UNRESOLVED_STATUSES: RedemptionAttemptStatus[] = ['REQUESTED', 'VALIDATING', 'POSTER_MUTATING', 'POSTER_CONFIRMED', 'UNKNOWN'];

@Injectable()
export class PosWidgetRewardRedemptionRepository {
  constructor(private readonly prisma: PrismaService) {}

  // Idempotent create: attemptId is the widget's idempotency key. A duplicate POST with the SAME key hits the unique constraint and this returns the
  // EXISTING row (`created: false`) instead of throwing — the caller must not re-run validation or touch Poster again in that case. Must be called inside
  // the SAME transaction as the unresolved-attempt check (see findUnresolvedForCustomerProgramTx) for the concurrency guard to mean anything.
  async createRequestedTx(tx: Db, data: CreateAttemptData): Promise<{ created: boolean; row: RewardAttemptRow }> {
    try {
      const row = await tx.rewardRedemptionAttempt.create({ data: { ...data, status: 'REQUESTED' satisfies RedemptionAttemptStatus } });
      return { created: true, row };
    } catch (err) {
      if (isUniqueConstraintViolation(err)) {
        const existing = await tx.rewardRedemptionAttempt.findUnique({ where: { attemptId: data.attemptId } });
        if (existing) return { created: false, row: existing };
      }
      throw err;
    }
  }

  findUnresolvedForCustomerProgramTx(tx: Db, customerId: string, rewardProgramId: string) {
    return tx.rewardRedemptionAttempt.findFirst({ where: { customerId, rewardProgramId, status: { in: UNRESOLVED_STATUSES } } });
  }

  // Phase 22.2 — ONE POSTER ORDER = MAXIMUM ONE REWARD REDEMPTION. Two checks, both scoped by posterOrderId alone (not customer/program — a second
  // reward PROGRAM redeeming onto the same order is refused just the same as a second attempt at the same program): has this order already had a
  // successful redemption, and is another attempt for this same order already in flight right now. Both are read inside the SAME short "claim"
  // transaction as findUnresolvedForCustomerProgramTx/createRequestedTx, so — exactly like that existing guard — a second request can only ever see
  // this check's result AFTER the first request's claim has actually committed (SQLite serializes writers), never a stale read racing an uncommitted one.
  findRedeemedForPosterOrderTx(tx: Db, posterOrderId: string) {
    return tx.rewardRedemptionAttempt.findFirst({ where: { posterOrderId, status: 'REDEEMED' satisfies RedemptionAttemptStatus } });
  }

  findUnresolvedForPosterOrderTx(tx: Db, posterOrderId: string, excludeAttemptRowId: string) {
    return tx.rewardRedemptionAttempt.findFirst({ where: { posterOrderId, id: { not: excludeAttemptRowId }, status: { in: UNRESOLVED_STATUSES } } });
  }

  findByAttemptId(attemptId: string) {
    return this.prisma.rewardRedemptionAttempt.findUnique({ where: { attemptId } });
  }

  markFailedTx(tx: Db, id: string, failureReason: RedemptionFailureReason) {
    return tx.rewardRedemptionAttempt.update({ where: { id }, data: { status: 'FAILED' satisfies RedemptionAttemptStatus, failureReason } });
  }

  // Phase 22.2 — the "claim" transition: validation (eligibility, concurrency) has passed and the attempt is about to call Poster. This closes the SHORT
  // validation transaction; the actual Poster mutation (real network calls, possibly slow) happens entirely OUTSIDE any transaction, exactly like
  // markRedeemedTx/markFailedTx/markUnknownTx below are then applied in a SEPARATE short transaction once the mutation result is known. See
  // pos-widget-reward-redemption.service.ts's class comment for why nothing slower than a DB write may ever run inside prisma.runTransaction here.
  markMutatingTx(tx: Db, id: string) {
    return tx.rewardRedemptionAttempt.update({ where: { id }, data: { status: 'POSTER_MUTATING' satisfies RedemptionAttemptStatus } });
  }

  // Only ever called AFTER RewardRedemptionService.createRedemptionRecord has committed in the SAME short transaction. `posterOrderId` is written into
  // `redeemedForPosterOrderId` here — the DB-level backstop for Phase 22.2's one-per-order rule (see the model comment in schema.prisma). If the
  // application-level check above were somehow bypassed, THIS write is what would actually fail (unique constraint), not silently succeed twice.
  markRedeemedTx(tx: Db, id: string, redemptionId: string, posterOrderId: string) {
    return tx.rewardRedemptionAttempt.update({ where: { id }, data: { status: 'REDEEMED' satisfies RedemptionAttemptStatus, redemptionId, confirmedAt: new Date(), redeemedForPosterOrderId: posterOrderId } });
  }

  markUnknownTx(tx: Db, id: string, failureReason: RedemptionFailureReason | null) {
    return tx.rewardRedemptionAttempt.update({ where: { id }, data: { status: 'UNKNOWN' satisfies RedemptionAttemptStatus, failureReason } });
  }
}

interface RewardAttemptRow {
  id: string;
  attemptId: string;
  status: string;
  failureReason: string | null;
  rewardProductName: string | null;
}
