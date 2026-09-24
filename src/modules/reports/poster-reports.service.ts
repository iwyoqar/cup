import { Injectable, Logger } from '@nestjs/common';
import { posterAnalyticsRevenueToCupUzs, posterReportAmountToCupUzs, posterReportRawUnits } from '../poster/poster-money';
import { PosterService } from '../poster/poster.service';
import { PosterCategoriesSalesRow, PosterPaymentsReportRaw, PosterProductsSalesRow } from '../poster/poster.types';

// Reports Phase B1 — Poster's OWN sales report, exposed as a SEPARATE "reference" figure for comparison only. Never
// the canonical CUP revenue source (that stays AnalyticsRepository/BranchIntelligenceRepository), and never merged
// or added into a CUP total (Poster gross already includes CUP-originated sales, so CUP + Poster would double
// count). A Poster read failure never breaks the Reports page — it degrades to `available: false`.
export interface PosterLocationReference {
  available: boolean;
  scope: 'all_locations_combined' | 'branch';
  revenueMinor: number;
  orders: number;
  averageReceiptMinor: number;
  note: string;
}

// Reports Phase B2 — Poster's payment-method totals, normalized. Everything Poster-specific (field names, kopeck
// wire unit, numeric-string values) stops here; ReportsPaymentsService and the Admin only ever see this shape.
export interface PosterPaymentMethodAmount {
  paymentId: string; // Poster's own field id, e.g. "cash" for payed_cash_sum — kept so a name is never the only key
  name: string;
  amountMinor: number; // whole UZS
  rawAmount: number; // exactly what Poster sent, on Poster's own scale (for verification only)
}

export type PosterPaymentsBreakdown =
  | {
      available: true;
      methods: PosterPaymentMethodAmount[]; // every payed_*_sum Poster returned in `total`, zero amounts included
      totalMinor: number; // Poster's own payed_sum_sum
      rawTotal: number;
      rawMethodsSum: number; // exact sum of the methods on Poster's scale — compared with rawTotal, never rounded
    }
  | { available: false; reason: 'poster_unavailable' | 'malformed_response' };

// Display names for the fields Poster DOCUMENTS (en/web/dash/getPaymentsReport.md). An undocumented payed_*_sum key
// the real account returns is shown under its own id rather than guessed at.
const PAYMENT_METHOD_NAMES: Record<string, string> = {
  cash: 'Cash',
  card: 'Card',
  third_party: 'Third-party',
  cert_in: 'Gift certificate',
  cert_out: 'Gift certificate (counted as discount)',
  bonus: 'Points',
  incust: 'inCust',
};
const PAYMENT_FIELD = /^payed_([a-z0-9_]+)_sum$/;
const TOTAL_FIELD = 'payed_sum_sum';

// Reports Phase C1/C2 — Poster's own per-product / per-category sales, normalized. REFERENCE ONLY: Poster's figures
// cover every sale Poster saw (CUP-originated incoming orders included), so they are compared with CUP's canonical
// figures, never added to them. Poster profit fields are never read.
export interface PosterSalesReferenceRow {
  posterId: string; // Poster product_id / category_id, as a string
  name: string;
  quantity: number; // Poster's `count` — may be fractional for weight-sold products; rounded to 3 decimals
  revenueMinor: number; // whole UZS
}

export type PosterSalesReference = { available: true; rows: PosterSalesReferenceRow[] } | { available: false; reason: 'poster_unavailable' | 'malformed_response' };

function parseQuantity(raw: unknown): number | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  if (typeof raw === 'string' && raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null;
}

const UNAVAILABLE_NOTE = 'Poster reference could not be read for this period.';

@Injectable()
export class PosterReportsService {
  private readonly logger = new Logger(PosterReportsService.name);

  constructor(private readonly poster: PosterService) {}

  // dateFromYmd/dateToYmd: Poster's documented Ymd format (business-date range, dashes stripped — same conversion
  // poster-transaction-import.service.ts's resolveWindow already uses). `spotId` scopes to one branch; omitted,
  // Poster combines every location into one total (see poster.service.ts — never called once per branch).
  async getReference(dateFromYmd: string, dateToYmd: string, spotId?: string): Promise<PosterLocationReference> {
    const scope: PosterLocationReference['scope'] = spotId ? 'branch' : 'all_locations_combined';
    try {
      const raw = await this.poster.getSpotsSales(dateFromYmd, dateToYmd, spotId);
      return {
        available: true,
        scope,
        revenueMinor: Math.round(raw.revenue),
        orders: Math.round(raw.clients), // Poster's field name is misleading — documented meaning is order/receipt count
        averageReceiptMinor: Math.round(raw.middle_invoice),
        note:
          scope === 'branch'
            ? "Poster's own report for this location. Poster's day boundaries are not verified against CUP's UTC+5 business day — treat as a reference, not an exact match."
            : "Poster's own report for all locations combined — Poster does not provide a per-location breakdown in a single call, so this figure is not split by branch.",
      };
    } catch (err) {
      this.logger.warn(`Poster location reference unavailable: ${err instanceof Error ? err.message : String(err)}`);
      return { available: false, scope, revenueMinor: 0, orders: 0, averageReceiptMinor: 0, note: UNAVAILABLE_NOTE };
    }
  }

  // One dash.getPaymentsReport call for the whole range (and, optionally, one Poster spot). Reads `total` only — `days`
  // silently switches to monthly buckets past 65 days. Any read failure → poster_unavailable; any shape CUP cannot
  // read with certainty (missing `total`, missing payed_sum_sum, a non-integer amount) → malformed_response. Neither
  // is ever turned into zeros.
  async getPaymentsBreakdown(dateFromYmd: string, dateToYmd: string, spotId?: string): Promise<PosterPaymentsBreakdown> {
    let raw: unknown;
    try {
      raw = await this.poster.getPaymentsReport(dateFromYmd, dateToYmd, spotId);
    } catch (err) {
      this.logger.warn(`Poster payments report unavailable: ${err instanceof Error ? err.message : String(err)}`);
      return { available: false, reason: 'poster_unavailable' };
    }

    const report = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as PosterPaymentsReportRaw) : undefined;
    const total = report?.total;
    // Poster explicitly listing NO payment days, with no usable `total`, is a real empty period — not a malformed one.
    const totalIsEmpty = total === undefined || (Array.isArray(total) && total.length === 0) || (typeof total === 'object' && total !== null && Object.keys(total).length === 0);
    if (report && Array.isArray(report.days) && report.days.length === 0 && totalIsEmpty) {
      return { available: true, methods: [], totalMinor: 0, rawTotal: 0, rawMethodsSum: 0 };
    }
    if (!total || typeof total !== 'object' || Array.isArray(total)) return this.malformed('missing "total" object');

    const rawTotal = posterReportRawUnits(total[TOTAL_FIELD]);
    const totalMinor = posterReportAmountToCupUzs(total[TOTAL_FIELD]);
    if (rawTotal === null || totalMinor === null) return this.malformed(`"${TOTAL_FIELD}" is not an integer amount`);

    const methods: PosterPaymentMethodAmount[] = [];
    let rawMethodsSum = 0;
    for (const [key, value] of Object.entries(total)) {
      if (key === TOTAL_FIELD) continue;
      const match = PAYMENT_FIELD.exec(key);
      if (!match) continue;
      const rawAmount = posterReportRawUnits(value);
      const amountMinor = posterReportAmountToCupUzs(value);
      if (rawAmount === null || amountMinor === null) return this.malformed(`"${key}" is not an integer amount`);
      const paymentId = match[1];
      methods.push({ paymentId, name: PAYMENT_METHOD_NAMES[paymentId] ?? paymentId.replace(/_/g, ' '), amountMinor, rawAmount });
      rawMethodsSum += rawAmount;
    }

    return { available: true, methods, totalMinor, rawTotal, rawMethodsSum };
  }

  // One dash.getProductsSales call. Rows for the same product_id (one per modification) are summed into one product.
  // Revenue = Poster's payed_sum (paid, after discount — the same meaning CUP's POS import stores per line), kopecks.
  async getProductsSalesReference(dateFromYmd: string, dateToYmd: string, spotId?: string): Promise<PosterSalesReference> {
    let raw: unknown;
    try {
      raw = await this.poster.getProductsSales(dateFromYmd, dateToYmd, spotId);
    } catch (err) {
      this.logger.warn(`Poster products sales unavailable: ${err instanceof Error ? err.message : String(err)}`);
      return { available: false, reason: 'poster_unavailable' };
    }
    if (!Array.isArray(raw)) return this.malformedReference('dash.getProductsSales response is not an array');
    const byId = new Map<string, PosterSalesReferenceRow>();
    for (const row of raw as PosterProductsSalesRow[]) {
      const posterId = row && (typeof row.product_id === 'string' || typeof row.product_id === 'number') ? String(row.product_id).trim() : '';
      const quantity = parseQuantity(row?.count);
      const revenueMinor = posterReportAmountToCupUzs(row?.payed_sum);
      if (!posterId || quantity === null || revenueMinor === null) return this.malformedReference('dash.getProductsSales row missing product_id/count/payed_sum');
      const existing = byId.get(posterId);
      if (existing) {
        existing.quantity = Math.round((existing.quantity + quantity) * 1000) / 1000;
        existing.revenueMinor += revenueMinor;
      } else {
        byId.set(posterId, { posterId, name: typeof row.product_name === 'string' ? row.product_name : posterId, quantity, revenueMinor });
      }
    }
    return { available: true, rows: [...byId.values()] };
  }

  // One dash.getCategoriesSales call. `revenue` scale: see posterAnalyticsRevenueToCupUzs (poster-money.ts).
  async getCategoriesSalesReference(dateFromYmd: string, dateToYmd: string, spotId?: string): Promise<PosterSalesReference> {
    let raw: unknown;
    try {
      raw = await this.poster.getCategoriesSales(dateFromYmd, dateToYmd, spotId);
    } catch (err) {
      this.logger.warn(`Poster categories sales unavailable: ${err instanceof Error ? err.message : String(err)}`);
      return { available: false, reason: 'poster_unavailable' };
    }
    if (!Array.isArray(raw)) return this.malformedReference('dash.getCategoriesSales response is not an array');
    const rows: PosterSalesReferenceRow[] = [];
    for (const row of raw as PosterCategoriesSalesRow[]) {
      const posterId = row && (typeof row.category_id === 'string' || typeof row.category_id === 'number') ? String(row.category_id).trim() : '';
      const quantity = parseQuantity(row?.count);
      const revenueMinor = posterAnalyticsRevenueToCupUzs(row?.revenue);
      if (!posterId || quantity === null || revenueMinor === null) return this.malformedReference('dash.getCategoriesSales row missing category_id/count/revenue');
      rows.push({ posterId, name: typeof row.category_name === 'string' ? row.category_name : posterId, quantity, revenueMinor });
    }
    return { available: true, rows };
  }

  private malformedReference(detail: string): PosterSalesReference {
    this.logger.warn(`Poster sales reference malformed: ${detail}`);
    return { available: false, reason: 'malformed_response' };
  }

  private malformed(detail: string): PosterPaymentsBreakdown {
    this.logger.warn(`Poster payments report malformed: ${detail}`);
    return { available: false, reason: 'malformed_response' };
  }
}
