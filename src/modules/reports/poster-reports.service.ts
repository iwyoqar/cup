import { Injectable, Logger } from '@nestjs/common';
import { posterAnalyticsRevenueToCupUzs, posterReportAmountToCupUzs, posterReportRawUnits } from '../poster/poster-money';
import { PosterService } from '../poster/poster.service';
import { PosterCategoriesSalesRow, PosterEmployee, PosterPaymentsReportRaw, PosterProductsSalesRow, PosterTaxRow, PosterWaiterSalesRow } from '../poster/poster.types';

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

// Reports Phase D2 — Poster employee (waiter) sales, normalized. Revenue scale follows dash.getSpotsSales's verified
// whole-so'm behaviour (see posterAnalyticsRevenueToCupUzs). `receipts` is Poster's `clients`, documented as closed
// orders count. Poster profit / service-time fields are never read.
export interface PosterWaiterSales {
  employeeId: string;
  name: string;
  revenueMinor: number;
  receipts: number | null; // null if Poster omitted / sent a non-integer count — never guessed
}
export type PosterWaitersReference = { available: true; rows: PosterWaiterSales[] } | { available: false; reason: 'poster_unavailable' | 'malformed_response' };

export interface PosterEmployeeMeta {
  employeeId: string;
  name: string;
  roleName: string | null;
}

// Reports Phase E — Poster's configured taxes, normalized. No amounts: finance.getTaxes does not report any.
export interface PosterTaxConfig {
  taxId: string;
  name: string;
  ratePercent: number | null;
  typeLabel: string | null; // Poster's documented type code -> label; unknown codes stay null (never guessed)
  fiscal: boolean | null;
  rawDeleteFlag: string | null;
}
export type PosterTaxesReference = { available: true; taxes: PosterTaxConfig[] } | { available: false; reason: 'poster_unavailable' | 'malformed_response' };

const POSTER_TAX_TYPES: Record<string, string> = { '1': 'Sales tax', '2': 'Turnover tax', '3': 'VAT', '4': 'No tax' };

const idOf = (v: unknown): string => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '');

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
      // Phase H hardening: an unexpected shape (e.g. an empty array, a missing field) used to become NaN -> JSON null with
      // available: true, which crashed the Locations page. Anything not numeric is now "unavailable", never a fake figure.
      const revenue = posterAnalyticsRevenueToCupUzs((raw as unknown as Record<string, unknown> | null)?.revenue);
      const orders = posterAnalyticsRevenueToCupUzs((raw as unknown as Record<string, unknown> | null)?.clients);
      const middle = posterAnalyticsRevenueToCupUzs((raw as unknown as Record<string, unknown> | null)?.middle_invoice);
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw) || revenue === null || orders === null || middle === null) {
        this.logger.warn('Poster location reference malformed: dash.getSpotsSales returned no numeric revenue/clients/middle_invoice');
        return { available: false, scope, revenueMinor: 0, orders: 0, averageReceiptMinor: 0, note: UNAVAILABLE_NOTE };
      }
      return {
        available: true,
        scope,
        revenueMinor: revenue, // same Math.round as before (posterAnalyticsRevenueToCupUzs rounds a whole-so'm value)
        orders, // Poster's field name is misleading — documented meaning is order/receipt count
        averageReceiptMinor: middle,
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

  // One dash.getWaitersSales call (all branches — Poster documents no spot filter).
  async getWaitersSales(dateFromYmd: string, dateToYmd: string): Promise<PosterWaitersReference> {
    let raw: unknown;
    try {
      raw = await this.poster.getWaitersSales(dateFromYmd, dateToYmd);
    } catch (err) {
      this.logger.warn(`Poster waiters sales unavailable: ${err instanceof Error ? err.message : String(err)}`);
      return { available: false, reason: 'poster_unavailable' };
    }
    if (!Array.isArray(raw)) return this.malformedReference('dash.getWaitersSales response is not an array');
    const rows: PosterWaiterSales[] = [];
    for (const row of raw as PosterWaiterSalesRow[]) {
      const employeeId = idOf(row?.user_id);
      const revenueMinor = posterAnalyticsRevenueToCupUzs(row?.revenue);
      if (!employeeId || revenueMinor === null) return this.malformedReference('dash.getWaitersSales row missing user_id/revenue');
      const receiptsRaw = row.clients === undefined ? null : Number(row.clients);
      rows.push({ employeeId, name: typeof row.name === 'string' && row.name.trim() ? row.name : employeeId, revenueMinor, receipts: receiptsRaw !== null && Number.isInteger(receiptsRaw) && receiptsRaw >= 0 ? receiptsRaw : null });
    }
    return { available: true, rows };
  }

  // One access.getEmployees call. Metadata is optional: any failure returns null and the report still works.
  async getEmployees(): Promise<Map<string, PosterEmployeeMeta> | null> {
    try {
      const raw = await this.poster.getEmployees();
      if (!Array.isArray(raw)) return null;
      const out = new Map<string, PosterEmployeeMeta>();
      for (const e of raw as PosterEmployee[]) {
        const employeeId = idOf(e?.user_id);
        if (employeeId) out.set(employeeId, { employeeId, name: typeof e.name === 'string' ? e.name : employeeId, roleName: typeof e.role_name === 'string' && e.role_name ? e.role_name : null });
      }
      return out;
    } catch (err) {
      this.logger.warn(`Poster employees list unavailable: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  // One finance.getTaxes call.
  async getTaxes(): Promise<PosterTaxesReference> {
    let raw: unknown;
    try {
      raw = await this.poster.getTaxes();
    } catch (err) {
      this.logger.warn(`Poster taxes unavailable: ${err instanceof Error ? err.message : String(err)}`);
      return { available: false, reason: 'poster_unavailable' };
    }
    if (!Array.isArray(raw)) return this.malformedReference('finance.getTaxes response is not an array');
    const taxes: PosterTaxConfig[] = [];
    for (const t of raw as PosterTaxRow[]) {
      const taxId = idOf(t?.tax_id);
      if (!taxId) return this.malformedReference('finance.getTaxes row missing tax_id');
      const rate = t.tax_value === undefined || t.tax_value === '' ? null : Number(t.tax_value);
      const fiscal = idOf(t.fiscal);
      taxes.push({
        taxId,
        name: typeof t.tax_name === 'string' && t.tax_name ? t.tax_name : taxId,
        ratePercent: rate !== null && Number.isFinite(rate) ? rate : null,
        typeLabel: POSTER_TAX_TYPES[idOf(t.type)] ?? null,
        fiscal: fiscal === '1' ? true : fiscal === '0' ? false : null,
        rawDeleteFlag: idOf(t.delete) || null,
      });
    }
    return { available: true, taxes };
  }

  private malformedReference(detail: string): { available: false; reason: 'malformed_response' } {
    this.logger.warn(`Poster sales reference malformed: ${detail}`);
    return { available: false, reason: 'malformed_response' };
  }

  private malformed(detail: string): PosterPaymentsBreakdown {
    this.logger.warn(`Poster payments report malformed: ${detail}`);
    return { available: false, reason: 'malformed_response' };
  }
}
