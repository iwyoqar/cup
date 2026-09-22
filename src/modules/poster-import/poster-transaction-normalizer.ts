import { PosterMoneyError, PosterNegativeAmountError, posterPriceToCupUzs } from '../poster/poster-money';
import { PosterTransaction, PosterTransactionLine } from '../poster/poster.types';

// Phase 11.2 — pure normalisation of a Poster transaction into CUP's canonical values. No I/O, no database, no
// guessing: a value is either converted exactly (money only through the Poster money adapter) or the result says why
// it could not be. Fields Poster leaves undocumented (application_id, order_source, auto_accept, processing_status)
// are never read here.

export interface NormalizedLine {
  lineIndex: number;
  posterProductId: string;
  quantity: number;
  posterProductPriceMinor: number;
  posterPayedSumMinor: number;
  hasModification: boolean;
}

export interface NormalizedTransaction {
  posterTransactionId: string;
  posterClientId: string | null; // null = no client on the receipt
  posterSpotId: number;
  posterStatus: string;
  posterPayType: string;
  occurredAt: Date;
  totalMinor: number;
  paidMinor: number;
  // Either every line converted cleanly, or the first reason it could not be.
  lines: NormalizedLine[] | null;
  lineProblem: 'NON_INTEGER_QUANTITY' | 'INVALID_AMOUNT' | null;
}

// Phase 19 — REFUND_UNVERIFIED: how Poster represents a refund / return of a closed sale is NOT verified (no deleted or negative receipt exists in the
// account to observe). The only reversal-like SHAPE that can be recognised without guessing is a negative amount or quantity; such a receipt is excluded
// from import (never turned into a negative sale) and reported under this reason.
export type NormalizeResult = { ok: true; transaction: NormalizedTransaction } | { ok: false; reason: 'INVALID_TRANSACTION' | 'REFUND_UNVERIFIED' };

const POSITIVE_INT = /^[1-9]\d*$/;

export function normalizePosterTransaction(raw: PosterTransaction): NormalizeResult {
  try {
    const id = String(raw.transaction_id ?? '').trim();
    if (!POSITIVE_INT.test(id)) return { ok: false, reason: 'INVALID_TRANSACTION' };

    const spot = Number(raw.spot_id);
    if (!Number.isInteger(spot) || spot <= 0) return { ok: false, reason: 'INVALID_TRANSACTION' };

    const closedAtMs = Number(raw.date_close);
    if (!Number.isFinite(closedAtMs) || closedAtMs <= 0) return { ok: false, reason: 'INVALID_TRANSACTION' };

    const clientRaw = String(raw.client_id ?? '0').trim();
    const client = clientRaw === '' || clientRaw === '0' ? null : clientRaw;
    if (client !== null && !POSITIVE_INT.test(client)) return { ok: false, reason: 'INVALID_TRANSACTION' };

    const totalMinor = posterPriceToCupUzs(raw.sum);
    const paidMinor = posterPriceToCupUzs(raw.payed_sum);

    const { lines, lineProblem, reversalLike } = normalizeLines(raw.products ?? []);
    if (reversalLike) return { ok: false, reason: 'REFUND_UNVERIFIED' };
    return {
      ok: true,
      transaction: {
        posterTransactionId: id,
        posterClientId: client,
        posterSpotId: spot,
        posterStatus: String(raw.status),
        posterPayType: String(raw.pay_type),
        occurredAt: new Date(closedAtMs),
        totalMinor,
        paidMinor,
        lines,
        lineProblem,
      },
    };
  } catch (err) {
    // A negative amount is a reversal-like receipt (refund semantics unverified) and is never imported as a sale; a fractional or empty amount is unreadable.
    if (err instanceof PosterNegativeAmountError) return { ok: false, reason: 'REFUND_UNVERIFIED' };
    if (err instanceof PosterMoneyError) return { ok: false, reason: 'INVALID_TRANSACTION' };
    throw err;
  }
}

function normalizeLines(rawLines: PosterTransactionLine[]): { lines: NormalizedLine[] | null; lineProblem: NormalizedTransaction['lineProblem']; reversalLike: boolean } {
  const lines: NormalizedLine[] = [];
  for (const [index, line] of rawLines.entries()) {
    const productId = String(line.product_id ?? '').trim();
    const quantity = Number(line.num);
    if (!POSITIVE_INT.test(productId)) return { lines: null, lineProblem: 'INVALID_AMOUNT', reversalLike: false };
    // CUP quantities are whole numbers; a fractional or non-positive quantity is never rounded. A NEGATIVE quantity is reversal-like.
    if (Number.isFinite(quantity) && quantity < 0) return { lines: null, lineProblem: 'INVALID_AMOUNT', reversalLike: true };
    if (!Number.isInteger(quantity)) return { lines: null, lineProblem: 'NON_INTEGER_QUANTITY', reversalLike: false };
    if (quantity <= 0) return { lines: null, lineProblem: 'INVALID_AMOUNT', reversalLike: false };
    try {
      const modification = String(line.modification_id ?? '0').trim();
      lines.push({
        lineIndex: index,
        posterProductId: productId,
        quantity,
        posterProductPriceMinor: posterPriceToCupUzs(line.product_price),
        posterPayedSumMinor: posterPriceToCupUzs(line.payed_sum),
        hasModification: modification !== '' && modification !== '0',
      });
    } catch (err) {
      if (err instanceof PosterNegativeAmountError) return { lines: null, lineProblem: 'INVALID_AMOUNT', reversalLike: true };
      if (err instanceof PosterMoneyError) return { lines: null, lineProblem: 'INVALID_AMOUNT', reversalLike: false };
      throw err;
    }
  }
  return { lines, lineProblem: null, reversalLike: false };
}
