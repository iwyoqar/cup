import { Injectable, Logger } from '@nestjs/common';
import { cupUzsToPosterPrice } from '../poster/poster-money';
import { PosterService } from '../poster/poster.service';
import { PosterTransactionLine } from '../poster/poster.types';

// Coffee Subscription — real Poster order purchase. The SAME seam Phase 22 verified live (docs/PHASE-22-AUDIT.md §15) for adding a
// zero-priced reward line to an open order — REST `transactions.addTransactionProduct`, order resolved independently via
// `getOpenTransactions` + `date_start` matching (never trusting the widget's claimed order id), mutate-then-verify by re-reading the
// order afterward — but at the plan's REAL price instead of 0.
//
// NOT YET LIVE-VERIFIED (unlike the price-0 case): no non-zero-price `addTransactionProduct` call, and no order carrying an
// API-added line, has ever been observed actually closing/getting paid in this project (PHASE-22-AUDIT.md §15's own closing
// paragraph explicitly flags this as untested — the one live test order was deliberately never closed). This service reuses every
// proven building block (order resolution, the mutate-then-verify discipline, the definite/ambiguous/rejected outcome shape) but
// ships behind its own flag (POS_SUBSCRIPTION_POSTER_PURCHASE_ENABLED) so a supervised live test — one disposable low-value real
// order — can happen before production use, exactly like Phase 22's own rollout.
export interface PosterOrderMutationOutcome {
  kind: 'blocked' | 'confirmed' | 'rejected' | 'ambiguous';
  reason: string;
  mutationAttempted?: boolean; // false = Poster was provably NOT changed (order unresolved, client mismatch); absent = treat as attempted
  code?: 'ORDER_NOT_CONFIRMED' | 'CLIENT_MISMATCH' | 'INVALID_CONTEXT';
  transactionId?: string; // the REST transaction_id the claimed order resolved to (set once resolved, even on an ambiguous outcome)
  transactionProductId?: string; // Poster's own id of the added line
}

// Same generous-but-bounded window as PosterRewardMutationService (open orders are same-day/same-shift; never an unbounded scan).
function openOrderSearchWindow(): { dateFrom: string; dateTo: string } {
  const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
  const now = new Date();
  const yesterday = new Date(now.getTime() - 86_400_000);
  return { dateFrom: ymd(yesterday), dateTo: ymd(now) };
}

// Same "is this the same pre-existing line" key as the reward mutation — never by array position, since addTransactionProduct appends.
function lineKey(line: PosterTransactionLine): string {
  return `${line.product_id}:${line.modification_id ?? ''}:${line.product_price}`;
}

@Injectable()
export class PosterOrderMutationService {
  private readonly logger = new Logger(PosterOrderMutationService.name);

  constructor(private readonly poster: PosterService) {}

  // Mutate-then-verify, never verify-then-trust: a positive REST response is not itself treated as success. The order is re-read
  // afterward and the new line's actual presence (at the expected price, with the total moved by exactly that price and nothing
  // pre-existing changed) is what decides `confirmed` vs `ambiguous`.
  async applyToOrder(args: {
    posterAccount: string;
    posterSpotId: string | null;
    posterTabletId: string | null;
    posterOrderId: string; // the widget's claim: orders.getActive().order.id, a millisecond timestamp
    posterProductId: string;
    priceMinor: number; // whole so'm (CUP's canonical unit) — converted to Poster's kopeck/tiyin wire unit here
    // The resolved open order's client must be this Poster client (or, if allowNoClient, carry no client at all) — checked BEFORE
    // the mutation, so a purchase can never land on another customer's order.
    expectedClient: { posterClientId: string | null; allowNoClient: boolean };
  }): Promise<PosterOrderMutationOutcome> {
    if (!args.posterSpotId || !args.posterTabletId) {
      return { kind: 'ambiguous', reason: 'No verified spot/tablet in the request context; refusing to guess which register to mutate.', mutationAttempted: false, code: 'INVALID_CONTEXT' };
    }
    const spotId = Number(args.posterSpotId);
    const spotTabletId = Number(args.posterTabletId);
    if (!Number.isInteger(spotId) || !Number.isInteger(spotTabletId)) {
      return { kind: 'ambiguous', reason: `Non-numeric verified spot/tablet (${args.posterSpotId}/${args.posterTabletId}).`, mutationAttempted: false, code: 'INVALID_CONTEXT' };
    }

    // ---- 1. Independently resolve the widget's claimed order to a REST transaction_id.
    let openTransactions;
    try {
      const { dateFrom, dateTo } = openOrderSearchWindow();
      openTransactions = await this.poster.getOpenTransactions(dateFrom, dateTo);
    } catch (err) {
      return { kind: 'ambiguous', reason: `Could not list open transactions to resolve the current order: ${errMessage(err)}`, mutationAttempted: false, code: 'ORDER_NOT_CONFIRMED' };
    }
    const match = openTransactions.find((t) => t.date_start === args.posterOrderId && t.spot_id === String(spotId));
    if (!match) {
      return { kind: 'ambiguous', reason: `Could not independently confirm posterOrderId ${args.posterOrderId} as a currently open order on spot ${spotId}.`, mutationAttempted: false, code: 'ORDER_NOT_CONFIRMED' };
    }
    const transactionId = Number(match.transaction_id);
    if (!Number.isInteger(transactionId)) {
      return { kind: 'ambiguous', reason: `Resolved transaction_id "${match.transaction_id}" is not a usable integer.`, mutationAttempted: false, code: 'ORDER_NOT_CONFIRMED' };
    }
    const resolvedTransactionId = String(transactionId);
    const orderClient = String(match.client_id ?? '0').trim();
    const hasClient = orderClient !== '' && orderClient !== '0';
    const clientOk = hasClient ? args.expectedClient.posterClientId !== null && orderClient === args.expectedClient.posterClientId : args.expectedClient.allowNoClient;
    if (!clientOk) {
      return { kind: 'rejected', reason: 'The open order belongs to a different Poster client than the customer purchasing the subscription — nothing was changed.', mutationAttempted: false, code: 'CLIENT_MISMATCH', transactionId: resolvedTransactionId };
    }
    const beforeLines = match.products ?? [];
    const beforeSum = Number(match.sum);

    // ---- 2. Mutate: add the subscription's mapped product at its real price. This is the one call that can change a real order.
    const productId = Number(args.posterProductId);
    if (!Number.isInteger(productId)) {
      return { kind: 'ambiguous', reason: `posterProductId "${args.posterProductId}" is not a usable integer.`, mutationAttempted: false, code: 'INVALID_CONTEXT', transactionId: resolvedTransactionId };
    }
    const priceInPosterUnits = cupUzsToPosterPrice(args.priceMinor);
    const addResult = await this.poster.addTransactionProduct({ spot_id: spotId, spot_tablet_id: spotTabletId, transaction_id: transactionId, product_id: productId, price: priceInPosterUnits });
    if (addResult.kind === 'definite_failure') {
      return { kind: 'rejected', reason: addResult.reason, mutationAttempted: true, transactionId: resolvedTransactionId };
    }
    if (addResult.kind === 'ambiguous_failure') {
      return { kind: 'ambiguous', reason: addResult.reason, mutationAttempted: true, transactionId: resolvedTransactionId };
    }

    const transactionProductId = String(addResult.transactionProductId);
    const done = { mutationAttempted: true, transactionId: resolvedTransactionId, transactionProductId };

    // ---- 3. Verify: re-read the SAME order and confirm the new line genuinely exists at the expected price, the total moved by
    // EXACTLY that price (not "unchanged" — this is the one structural difference from the reward mutation's price-0 invariant),
    // and nothing pre-existing changed.
    let after;
    try {
      after = await this.poster.getTransactionById(String(transactionId));
    } catch (err) {
      return { kind: 'ambiguous', reason: `Mutation call succeeded but the order could not be re-read to verify it: ${errMessage(err)}`, ...done };
    }
    if (!after) {
      return { kind: 'ambiguous', reason: 'Mutation call succeeded but the order disappeared on re-read.', ...done };
    }
    const afterLines = after.products ?? [];
    const newLine = afterLines.find((l) => l.product_id === String(productId) && l.product_price === String(priceInPosterUnits));
    if (!newLine) {
      return { kind: 'ambiguous', reason: 'Mutation call succeeded but no matching line at the expected price was found on the verification read.', ...done };
    }
    const beforeKeys = beforeLines.map(lineKey);
    const afterKeys = afterLines.map(lineKey);
    const missingPreExistingLine = beforeKeys.some((k) => !afterKeys.includes(k));
    if (missingPreExistingLine) {
      this.logger.error(`Subscription order-purchase verification found a changed pre-existing line on transaction ${transactionId} — treating as ambiguous, not confirmed.`);
      return { kind: 'ambiguous', reason: 'An existing order line changed unexpectedly during verification.', ...done };
    }
    const expectedAfterSum = beforeSum + priceInPosterUnits;
    if (Number(after.sum) !== expectedAfterSum) {
      this.logger.error(`Subscription order-purchase verification found the order total moved unexpectedly (${beforeSum} -> ${after.sum}, expected ${expectedAfterSum}) on transaction ${transactionId} — treating as ambiguous, not confirmed.`);
      return { kind: 'ambiguous', reason: `Order total did not move by the expected amount during verification (${beforeSum} -> ${after.sum}, expected ${expectedAfterSum}).`, ...done };
    }

    return { kind: 'confirmed', reason: `Verified: product ${productId} present at price ${priceInPosterUnits} on transaction ${transactionId}; total moved by exactly that amount; no other line changed.`, ...done };
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
