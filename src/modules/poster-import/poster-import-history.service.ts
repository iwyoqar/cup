import { Injectable } from '@nestjs/common';
import { HistoryFilters, PosterImportReportRepository } from './poster-import-report.repository';

export const HISTORY_MAX_PAGE_SIZE = 50;

// Phase 19 — the import audit trail: a paginated, filterable read of poster_imported_transactions. Every row carries its own importedAt and status, which is
// what makes a confirmed import traceable without a separate run table. Never more than HISTORY_MAX_PAGE_SIZE rows per request.
@Injectable()
export class PosterImportHistoryService {
  constructor(private readonly repository: PosterImportReportRepository) {}

  async list(filters: HistoryFilters, page: number, pageSize: number) {
    const size = Math.min(Math.max(1, pageSize), HISTORY_MAX_PAGE_SIZE);
    const current = Math.max(1, page);
    const { total, rows } = await this.repository.history(filters, (current - 1) * size, size);
    return {
      page: current,
      pageSize: size,
      total,
      pages: Math.max(1, Math.ceil(total / size)),
      items: rows.map((r) => ({
        posterTransactionId: r.posterTransactionId,
        occurredAt: r.occurredAt.toISOString(),
        importedAt: r.importedAt.toISOString(),
        branchName: r.branch.name,
        posterSpotId: r.posterSpotId,
        customerName: r.customer?.displayName ?? null, // null = anonymous import (no Poster client, or one not linked to a CUP customer)
        totalMinor: r.totalMinor,
        paidMinor: r.paidMinor,
        status: r.status,
        unresolvedReason: r.unresolvedReason,
        source: r.source,
        lines: r._count.items,
      })),
    };
  }
}
