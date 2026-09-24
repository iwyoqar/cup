import { Injectable, Logger } from '@nestjs/common';
import { PosterService } from '../poster/poster.service';

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
}
