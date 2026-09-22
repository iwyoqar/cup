import { BadRequestException, Body, Controller, ForbiddenException, Get, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard';
import { CurrentAdmin } from '../admin-auth/current-admin.decorator';
import { isAdminRole } from '../staff/staff-roles';
import { PosterImportHistoryService } from './poster-import-history.service';
import { PosterImportQualityService } from './poster-import-quality.service';
import { PosterSpotMappingService } from './poster-spot-mapping.service';
import { PosterTransactionImportService } from './poster-transaction-import.service';

// Deliberately tiny: no customerId, no branchId, no Poster ids in the request. Everything is derived from Poster's
// client_id / spot_id / product_id through the existing explicit mappings.
const importRequestSchema = z.object({
  since: z.string().optional(),
  until: z.string().optional(),
  limit: z.number().int().positive().optional(),
  // PREVIEW is the default: nothing is written unless dryRun is explicitly false AND confirm is explicitly true (+ the Phase 19 gates below).
  dryRun: z.boolean().optional(),
  confirm: z.boolean().optional(),
  // Phase 19 write gates: the operator's acknowledgement that refund semantics are unverified, and the importable count of the preview they reviewed.
  acknowledgeRefundPolicy: z.boolean().optional(),
  expectedImportable: z.number().int().nonnegative().optional(),
});

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const qualityQuerySchema = z
  .object({
    since: DATE.optional(),
    until: DATE.optional(),
    limit: z.coerce.number().int().min(1).max(1000).optional(),
    live: z.enum(['true', 'false']).optional(),
  })
  .strict();

const historyQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
    since: DATE.optional(),
    until: DATE.optional(),
    branchId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
    status: z.enum(['IMPORTED', 'UNRESOLVED']).optional(),
    source: z.enum(['POS']).optional(),
    customer: z.string().trim().min(1).max(60).optional(),
  })
  .strict();

const dayStart = (d: string): Date => {
  const date = new Date(`${d}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== d) throw new BadRequestException('Invalid date.');
  return date;
};

// Admin-only. Customer and staff tokens fail AdminAuthGuard outright (different signing keys). Everything except POST import-transactions is read-only, and a
// POST that is not an explicit, fully-gated write is a preview that writes nothing.
@UseGuards(AdminAuthGuard)
@Controller('admin/poster')
export class PosterImportController {
  constructor(
    private readonly importService: PosterTransactionImportService,
    private readonly mapping: PosterSpotMappingService,
    private readonly quality: PosterImportQualityService,
    private readonly history: PosterImportHistoryService,
  ) {}

  @Post('import-transactions')
  async importTransactions(@Body() body: unknown, @CurrentAdmin() admin: { id: string; role: string }) {
    if (!isAdminRole(admin.role)) throw new ForbiddenException('Admin role required.');
    const parsed = importRequestSchema.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException('Invalid import request.');

    const write = parsed.data.dryRun === false;
    if (write && parsed.data.confirm !== true) {
      throw new BadRequestException('Writing imported transactions requires { "dryRun": false, "confirm": true }.');
    }
    return this.importService.run({
      since: parsed.data.since,
      until: parsed.data.until,
      limit: parsed.data.limit,
      write,
      acknowledgeRefundPolicy: parsed.data.acknowledgeRefundPolicy,
      expectedImportable: parsed.data.expectedImportable,
      actor: admin.id,
    });
  }

  // Poster spots vs CUP branches (read-only Poster call: access.getSpots).
  @Get('spot-mapping')
  spotMapping(@CurrentAdmin() admin: { role: string }) {
    if (!isAdminRole(admin.role)) throw new ForbiddenException('Admin role required.');
    return this.mapping.report();
  }

  @Get('import-data-quality')
  dataQuality(@Query() query: Record<string, string | undefined>, @CurrentAdmin() admin: { role: string }) {
    if (!isAdminRole(admin.role)) throw new ForbiddenException('Admin role required.');
    const parsed = qualityQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid data-quality query.');
    return this.quality.report({ since: parsed.data.since, until: parsed.data.until, limit: parsed.data.limit, live: parsed.data.live !== 'false' });
  }

  @Get('import-history')
  importHistory(@Query() query: Record<string, string | undefined>, @CurrentAdmin() admin: { role: string }) {
    if (!isAdminRole(admin.role)) throw new ForbiddenException('Admin role required.');
    const parsed = historyQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid import-history query.');
    const q = parsed.data;
    const since = q.since ? dayStart(q.since) : undefined;
    const until = q.until ? new Date(dayStart(q.until).getTime() + 24 * 3600 * 1000) : undefined;
    if (since && until && since.getTime() >= until.getTime()) throw new BadRequestException('since must not be after until.');
    return this.history.list({ since, until, branchId: q.branchId, status: q.status, source: q.source, customerQuery: q.customer }, q.page, q.pageSize);
  }
}
