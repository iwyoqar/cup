import { Injectable, Logger } from '@nestjs/common';
import { PosterService } from '../poster/poster.service';
import { PosterTransactionLine } from '../poster/poster.types';

// Phase 22 — the ONE seam through which a reward redemption mutates a live Poster POS order. Full audit: docs/PHASE-22-AUDIT.md.
//
// VERIFIED SAFE, live, 2026-09-22 (docs/PHASE-22-AUDIT.md §15): REST `transactions.addTransactionProduct` with `price: 0`, against a real disposable
// unpaid test order (transaction_id 46, spot 1, tablet 1, product 35 "Американо 250 мл"):
//   - reached the order the cashier had open on the physical register — confirmed by the owner watching the register screen, not inferred;
//   - the line appeared LIVE (no manual refresh) at price 0/free, matching a REST re-read of the same order;
//   - the order's own `sum` stayed unchanged (the free line contributed 0), and no other line/field was touched.
// This is the mechanism `applyToOrder()` below uses. `orders.addProduct` (no price argument) and `orders.setOrderBonus` (documented as a POINTS PAYMENT,
// not a discount) remain deliberately unused — see the two bullets that used to justify §6/§9's "no mechanism selected" status; they are superseded by
// this file's real implementation, not deleted from history (still in docs/PHASE-22-AUDIT.md).
//
// The widget can only ever CLAIM which order is open (`orders.getActive().order.id`, a millisecond timestamp — the POS JS API's `order.id`/`dateStart`).
// This service never trusts that claim by itself: it independently re-derives the REST `transaction_id` by listing currently-open transactions
// (`PosterService.getOpenTransactions`, status=1) for the account and matching `date_start` against the claimed id — verified live to appear within
// one 20 s poll (effectively immediate). A miss is refused, never guessed. `spot_id`/`spot_tablet_id` for the mutation itself come ONLY from the
// caller's already-verified signed request context (`PosContext`), never from the transaction lookup or the widget body.
export interface PosterRewardMutationOutcome {
  kind: 'blocked' | 'confirmed' | 'rejected' | 'ambiguous';
  reason: string;
}

// A generous but bounded window: open orders are a same-day, same-shift phenomenon; "yesterday through today" absorbs a
// near-midnight order without ever scanning an unbounded history, matching the pattern already used by the Phase 19/20 reconciliation code.
function openOrderSearchWindow(): { dateFrom: string; dateTo: string } {
  const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
  const now = new Date();
  const yesterday = new Date(now.getTime() - 86_400_000);
  return { dateFrom: ymd(yesterday), dateTo: ymd(now) };
}

// Two product lines are "the same existing line" if they carry the same product/modification and the same price — never by array position, since
// addTransactionProduct appends. Used only to confirm nothing PRE-EXISTING changed; it says nothing about the newly-added line itself.
function lineKey(line: PosterTransactionLine): string {
  return `${line.product_id}:${line.modification_id ?? ''}:${line.product_price}`;
}

@Injectable()
export class PosterRewardMutationService {
  private readonly logger = new Logger(PosterRewardMutationService.name);

  constructor(private readonly poster: PosterService) {}

  isSupported(): { supported: true } | { supported: false; reason: string } {
    return { supported: true };
  }

  // Mutate-then-verify, never verify-then-trust: a positive REST response from addTransactionProduct is NOT by itself treated as success — the order is
  // re-read afterward and the zero-priced line's actual presence (and the absence of any unrelated change) is what decides `confirmed` vs `ambiguous`.
  async applyToOrder(args: {
    posterAccount: string;
    posterSpotId: string | null;
    posterTabletId: string | null;
    posterOrderId: string; // the widget's claim: orders.getActive().order.id, a millisecond timestamp
    posterProductId: string;
  }): Promise<PosterRewardMutationOutcome> {
    if (!args.posterSpotId || !args.posterTabletId) {
      // Should be unreachable — the signature guard always populates these — but a missing verified spot/tablet is exactly the kind of thing this
      // method must refuse to guess past, not default to spot 1 or similar.
      return { kind: 'ambiguous', reason: 'No verified spot/tablet in the request context; refusing to guess which register to mutate.' };
    }
    const spotId = Number(args.posterSpotId);
    const spotTabletId = Number(args.posterTabletId);
    if (!Number.isInteger(spotId) || !Number.isInteger(spotTabletId)) {
      return { kind: 'ambiguous', reason: `Non-numeric verified spot/tablet (${args.posterSpotId}/${args.posterTabletId}).` };
    }

    // ---- 1. Independently resolve the widget's claimed order to a REST transaction_id. Never trust a transaction_id the caller might have supplied.
    let openTransactions;
    try {
      const { dateFrom, dateTo } = openOrderSearchWindow();
      openTransactions = await this.poster.getOpenTransactions(dateFrom, dateTo);
    } catch (err) {
      return { kind: 'ambiguous', reason: `Could not list open transactions to resolve the current order: ${errMessage(err)}` };
    }
    const match = openTransactions.find((t) => t.date_start === args.posterOrderId && t.spot_id === String(spotId));
    if (!match) {
      // The order the widget says is open could not be independently confirmed open on this spot right now — the order may have just closed, the
      // widget's context may be stale, or the claim may simply be wrong. Refused, not guessed.
      return { kind: 'ambiguous', reason: `Could not independently confirm posterOrderId ${args.posterOrderId} as a currently open order on spot ${spotId}.` };
    }
    const transactionId = Number(match.transaction_id);
    if (!Number.isInteger(transactionId)) {
      return { kind: 'ambiguous', reason: `Resolved transaction_id "${match.transaction_id}" is not a usable integer.` };
    }
    const beforeLines = match.products ?? [];
    const beforeSum = match.sum;

    // ---- 2. Mutate: add the reward product at price 0. This is the one call in this method that can change a real order.
    const productId = Number(args.posterProductId);
    if (!Number.isInteger(productId)) {
      return { kind: 'ambiguous', reason: `posterProductId "${args.posterProductId}" is not a usable integer.` };
    }
    const addResult = await this.poster.addTransactionProduct({ spot_id: spotId, spot_tablet_id: spotTabletId, transaction_id: transactionId, product_id: productId, price: 0 });
    if (addResult.kind === 'definite_failure') {
      return { kind: 'rejected', reason: addResult.reason };
    }
    if (addResult.kind === 'ambiguous_failure') {
      // Poster may or may not have applied the mutation. Never retried, never treated as success.
      return { kind: 'ambiguous', reason: addResult.reason };
    }

    // ---- 3. Verify: re-read the SAME order and confirm the zero-priced line genuinely exists, the total didn't move, and nothing pre-existing changed.
    let after;
    try {
      after = await this.poster.getTransactionById(String(transactionId));
    } catch (err) {
      // The mutation call itself succeeded, but we cannot confirm what it actually did — this is exactly the shape of "unknown", not "confirmed".
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
    const missingPreExistingLine = beforeKeys.some((k) => !afterKeys.includes(k));
    if (missingPreExistingLine) {
      // A pre-existing line changed or vanished. Even though the reward line itself looks right, this order is no longer provably "only" the
      // intended change — never mark this confirmed.
      this.logger.error(`Reward mutation verification found a changed pre-existing line on transaction ${transactionId} — treating as ambiguous, not confirmed.`);
      return { kind: 'ambiguous', reason: 'An existing order line changed unexpectedly during verification.' };
    }
    if (after.sum !== beforeSum) {
      this.logger.error(`Reward mutation verification found the order total moved (${beforeSum} -> ${after.sum}) on transaction ${transactionId} — treating as ambiguous, not confirmed.`);
      return { kind: 'ambiguous', reason: `Order total changed unexpectedly during verification (${beforeSum} -> ${after.sum}).` };
    }

    return { kind: 'confirmed', reason: `Verified: product ${productId} present at price 0 on transaction ${transactionId}; total unchanged (${after.sum}); no other line changed.` };
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
