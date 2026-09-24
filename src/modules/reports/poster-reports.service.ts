import { Injectable, Logger } from '@nestjs/common';
import { posterReportAmountToCupUzs, posterReportRawUnits } from '../poster/poster-money';
import { PosterService } from '../poster/poster.service';
import { PosterPaymentsReportRaw } from '../poster/poster.types';

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

  private malformed(detail: string): PosterPaymentsBreakdown {
    this.logger.warn(`Poster payments report malformed: ${detail}`);
    return { available: false, reason: 'malformed_response' };
  }
}
