// Poster money adapter (Phase 10.1, corrected Phase 22.1) — the ONE place where Poster's monetary
// representation is translated to/from CUP's. Nothing outside src/modules/poster's boundary
// callers (catalog sync and transaction import on the way in, order creation on the way out) may
// know how Poster writes money, and no other code may carry its own /100, *100 or similar
// multiplier — verified (2026-09-22) against every frontend formatter (Mini App, Admin, Staff,
// POS widget): none of them divides or multiplies, so this constant is the single source of truth.
//
// CUP canonical unit: WHOLE UZS integers, everywhere — Product.priceMinor, Order.totalMinor,
// OrderItem.*PriceMinor, PosterImportedTransaction(Item).*Minor, cart totals, loyalty amounts,
// fixed promotion discounts, admin fields, and the frontend formatter. (The "Minor" suffix in
// field names is historical; the value is whole UZS, and 24000 means "24 000 so'm".)
//
// Poster wire unit: integer "kopecks"/tiyin (Poster's minor unit, 100 = 1 so'm). Documented by
// Poster's own API docs — menu.getProducts "price ... в копейках" and
// incomingOrders.createIncomingOrder products[].price "Цена товара в копейках".
//
// Phase 10.1 (2026-09-19) read this as "one Poster wire unit IS one CUP so'm" (factor 1) from a
// single live observation against what was, at the time, a placeholder/test catalog (Cappuccino
// raw "300"). That observation was itself evidence of the /100 rule (the same comment recorded
// Poster's own UI rendering 300 as "3.00"), but the factor-1 reading was applied anyway and was
// never re-checked against a real menu.
//
// Phase 22.1 (2026-09-22) re-verified against the NOW-real catalog and caught the mismatch: Poster
// Management shows "Капучино 250 мл — 24,000.00 СУМ"; the live menu.getProducts value for that
// product (id 37) is raw "2400000"; dash.getTransaction for real closed receipts returns the exact
// same raw `sum`/`payed_sum` scale as menu prices (e.g. transaction 35: raw sum "29300000"), so
// product price and transaction/line-item money are ONE representation, not two. 2,400,000 / 100 =
// 24,000 — exactly Poster's own displayed price. The factor is 100, not 1; every raw value
// observed so far (old test data included: 300, 1200, 2700, ...) divides evenly.
export const POSTER_PRICE_UNITS_PER_CUP_UZS = 100;

export class PosterMoneyError extends Error {}

// A negative amount is the only reversal-like shape Poster could plausibly send (Phase 19: refund semantics are UNVERIFIED, so it is excluded, never imported as a negative sale).
export class PosterNegativeAmountError extends PosterMoneyError {}

// Poster -> CUP. `raw` is exactly what Poster sent (a numeric string such as "300", or a number).
export function posterPriceToCupUzs(raw: string | number): number {
  if (typeof raw === 'string' && raw.trim() === '') {
    // Number('') === 0 would silently turn a missing price into a free product.
    throw new PosterMoneyError('empty price value');
  }
  const posterUnits = Number(raw);
  if (!Number.isInteger(posterUnits)) {
    // A fractional value means the wire-unit assumption above is wrong in a way that must be
    // surfaced, never silently truncated into an Int column.
    throw new PosterMoneyError(`non-integer price value: ${raw}`);
  }
  if (posterUnits < 0) {
    throw new PosterNegativeAmountError(`negative price value: ${raw}`);
  }
  const uzs = posterUnits / POSTER_PRICE_UNITS_PER_CUP_UZS;
  if (!Number.isInteger(uzs)) {
    throw new PosterMoneyError(`price ${raw} is not a whole number of so'm`);
  }
  return uzs;
}

// CUP -> Poster. Used for the only monetary value CUP ever sends Poster: the explicit price of a
// free reward line (0). Every other order line deliberately omits `price`, so Poster prices it
// from its own catalog.
export function cupUzsToPosterPrice(uzs: number): number {
  if (!Number.isInteger(uzs) || uzs < 0) {
    throw new PosterMoneyError(`invalid CUP amount: ${uzs}`);
  }
  return uzs * POSTER_PRICE_UNITS_PER_CUP_UZS;
}

// Reports Phase B2 — Poster REPORT aggregates (dash.getPaymentsReport) -> CUP whole UZS. Same documented kopeck
// wire unit as above, but an aggregate is a sum Poster computed itself and is not guaranteed to be a whole number
// of so'm, so it is rounded (half away from zero, in integer arithmetic) instead of rejected. Returns null for
// anything that is not an integer amount, so the caller can refuse a malformed report rather than show a guess.
// NOT for dash.getSpotsSales — see poster.types.ts's PosterSpotsSales comment for why that endpoint is not /100.
export function posterReportAmountToCupUzs(raw: unknown): number | null {
  const units = posterReportRawUnits(raw);
  if (units === null) return null;
  const sign = units < 0 ? -1 : 1;
  const abs = Math.abs(units);
  const whole = Math.floor(abs / POSTER_PRICE_UNITS_PER_CUP_UZS);
  const rest = abs - whole * POSTER_PRICE_UNITS_PER_CUP_UZS;
  return sign * (rest * 2 >= POSTER_PRICE_UNITS_PER_CUP_UZS ? whole + 1 : whole);
}

// The raw integer Poster sent (number or numeric string), or null if it is not an integer. Used for exact
// comparisons on Poster's own scale before any rounding happens.
export function posterReportRawUnits(raw: unknown): number | null {
  if (typeof raw === 'string' && raw.trim() === '') return null;
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}
