import { Injectable, Logger } from '@nestjs/common';
import { PosterService } from '../poster/poster.service';
import { PosterTransactionLine } from '../poster/poster.types';

// Phase 23 — the ONE seam through which a promotion redemption mutates a live Poster POS order. Mirrors poster-reward-mutation.service.ts's structure
// and verification discipline exactly; see docs/PHASE-23-PROMOTIONS.md for the full account. The short version:
//
//   - There is NO Poster API, documented or otherwise, to set an order-level or line-level DISCOUNT, or a PERCENTAGE off. `Order.discount` /
//     `products[].promotionPrice` are documented READ fields only — nothing sets them. So PERCENT_DISCOUNT and FIXED_DISCOUNT have no verified-safe
//     mutation and are NOT implemented — isSupported() says so honestly for those two benefit types, always.
//   - FREE_PRODUCT reuses the EXACT mechanism Phase 22 already verified live for rewards: REST `transactions.addTransactionProduct(price: 0)`, adding
//     the promotion's own benefitProduct. Same order-identity resolution, same mutate-then-verify discipline.
//   - LOYALTY_POINTS needs NO Poster order mutation at all — crediting points is a pure CUP-side action (PromotionRedemptionService already does this
//     via LoyaltyService, unchanged by Phase 23). This service still independently resolves the claimed order via REST first, so a redemption is still
//     tied to a real, currently-open order — it just never calls a Poster WRITE method, because there is nothing on the order for it to change.
export interface PosterPromotionMutationOutcome {
  kind: 'blocked' | 'confirmed' | 'rejected' | 'ambiguous';
  reason: string;
}

function openOrderSearchWindow(): { dateFrom: string; dateTo: string } {
  const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
  const now = new Date();
  const yesterday = new Date(now.getTime() - 86_400_000);
  return { dateFrom: ymd(yesterday), dateTo: ymd(now) };
}

function lineKey(line: PosterTransactionLine): string {
  return `${line.product_id}:${line.modification_id ?? ''}:${line.product_price}`;
}

@Injectable()
export class PosterPromotionMutationService {
  private readonly logger = new Logger(PosterPromotionMutationService.name);

  constructor(private readonly poster: PosterService) {}

  isSupported(benefitType: string): { supported: true } | { supported: false; reason: string } {
    if (benefitType === 'FREE_PRODUCT') return { supported: true };
    if (benefitType === 'LOYALTY_POINTS') return { supported: true };
    return {
      supported: false,
      reason: `No verified Poster mechanism exists to apply a "${benefitType}" promotion to a live register order — there is no documented way to set an order or line discount (docs/PHASE-23-PROMOTIONS.md).`,
    };
  }

  async applyToOrder(args: {
    posterSpotId: string | null;
    posterTabletId: string | null;
    posterOrderId: string;
    benefitType: string;
    benefitProductId: string | null; // Poster's own catalog id for FREE_PRODUCT; unused otherwise
  }): Promise<PosterPromotionMutationOutcome> {
    if (!args.posterSpotId || !args.posterTabletId) {
      return { kind: 'ambiguous', reason: 'No verified spot/tablet in the request context; refusing to guess which register to mutate.' };
    }
    const spotId = Number(args.posterSpotId);
    const spotTabletId = Number(args.posterTabletId);
    if (!Number.isInteger(spotId) || !Number.isInteger(spotTabletId)) {
      return { kind: 'ambiguous', reason: `Non-numeric verified spot/tablet (${args.posterSpotId}/${args.posterTabletId}).` };
    }

    // ---- 1. Independently resolve the widget's claimed order to a REST transaction_id — identical resolution logic to PosterRewardMutationService,
    // required for EVERY benefit type (even one that never mutates), so a redemption is always tied to a real, currently-open order.
    let openTransactions;
    try {
      const { dateFrom, dateTo } = openOrderSearchWindow();
      openTransactions = await this.poster.getOpenTransactions(dateFrom, dateTo);
    } catch (err) {
      return { kind: 'ambiguous', reason: `Could not list open transactions to resolve the current order: ${errMessage(err)}` };
    }
    const match = openTransactions.find((t) => t.date_start === args.posterOrderId && t.spot_id === String(spotId));
    if (!match) {
      return { kind: 'ambiguous', reason: `Could not independently confirm posterOrderId ${args.posterOrderId} as a currently open order on spot ${spotId}.` };
    }
    const transactionId = Number(match.transaction_id);
    if (!Number.isInteger(transactionId)) {
      return { kind: 'ambiguous', reason: `Resolved transaction_id "${match.transaction_id}" is not a usable integer.` };
    }

    // ---- 2. LOYALTY_POINTS: nothing on the order to change. The order's existence/openness was just proven above; that is this benefit type's whole
    // "mutation" — the actual points credit happens in PromotionRedemptionService, outside this class, exactly like every other CUP-side write.
    if (args.benefitType === 'LOYALTY_POINTS') {
      return { kind: 'confirmed', reason: `Verified order ${transactionId} is open; LOYALTY_POINTS needs no Poster order mutation.` };
    }

    // ---- 3. FREE_PRODUCT: same mutate-then-verify sequence as PosterRewardMutationService.
    if (args.benefitType !== 'FREE_PRODUCT') {
      // Should be unreachable — the caller checks isSupported() first — but never silently do nothing here either.
      this.logger.error(`applyToOrder() reached the mutation branch for unsupported benefitType "${args.benefitType}" — a caller skipped the required capability check.`);
      const support = this.isSupported(args.benefitType);
      return { kind: 'blocked', reason: support.supported ? 'unsupported benefit type' : support.reason };
    }
    const productId = Number(args.benefitProductId);
    if (!Number.isInteger(productId)) {
      return { kind: 'ambiguous', reason: `benefitProductId "${args.benefitProductId}" is not a usable integer.` };
    }
    const beforeLines = match.products ?? [];
    const beforeSum = match.sum;

    const addResult = await this.poster.addTransactionProduct({ spot_id: spotId, spot_tablet_id: spotTabletId, transaction_id: transactionId, product_id: productId, price: 0 });
    if (addResult.kind === 'definite_failure') {
      return { kind: 'rejected', reason: addResult.reason };
    }
    if (addResult.kind === 'ambiguous_failure') {
      return { kind: 'ambiguous', reason: addResult.reason };
    }

    let after;
    try {
      after = await this.poster.getTransactionById(String(transactionId));
    } catch (err) {
      return { kind: 'ambiguous', reason: `Mutation call succeeded but the order could not be re-read to verify it: ${errMessage(err)}` };
    }
    if (!after) {
      return { kind: 'ambiguous', reason: 'Mutation call succeeded but the order disappeared on re-read.' };
    }
    const afterLines = after.products ?? [];
    const newLine = afterLines.find((l) => l.product_id === String(productId) && l.product_price === '0');
    if (!newLine) {
      return { kind: 'ambiguous', reason: 'Mutation call succeeded but no matching zero-priced line was found on the verification read.' };
    }
    const beforeKeys = beforeLines.map(lineKey);
    const afterKeys = afterLines.map(lineKey);
    if (beforeKeys.some((k) => !afterKeys.includes(k))) {
      this.logger.error(`Promotion mutation verification found a changed pre-existing line on transaction ${transactionId} — treating as ambiguous, not confirmed.`);
      return { kind: 'ambiguous', reason: 'An existing order line changed unexpectedly during verification.' };
    }
    if (after.sum !== beforeSum) {
      this.logger.error(`Promotion mutation verification found the order total moved (${beforeSum} -> ${after.sum}) on transaction ${transactionId} — treating as ambiguous, not confirmed.`);
      return { kind: 'ambiguous', reason: `Order total changed unexpectedly during verification (${beforeSum} -> ${after.sum}).` };
    }

    return { kind: 'confirmed', reason: `Verified: product ${productId} present at price 0 on transaction ${transactionId}; total unchanged (${after.sum}); no other line changed.` };
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
