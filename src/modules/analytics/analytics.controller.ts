import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard';
import { parseBusinessDate } from './analytics-period';
import { AnalyticsService } from './analytics.service';

// Query convention: `period` (today | yesterday | last7 | last30 | custom, default today), `startDate`/`endDate`
// (YYYY-MM-DD business dates, custom only), optional `branchId`. No customerId (or any customer parameter) is accepted.
const dateField = z.string().refine((v) => parseBusinessDate(v) !== null, 'Dates must be valid YYYY-MM-DD.');

const overviewQuerySchema = z.object({
  period: z.enum(['today', 'yesterday', 'last7', 'last30', 'custom']).default('today'),
  startDate: dateField.optional(),
  endDate: dateField.optional(),
  branchId: z.string().min(1).max(64).optional(),
});

// Read-only. Admin session only — customer and staff tokens fail AdminAuthGuard (different signing keys).
@UseGuards(AdminAuthGuard)
@Controller('admin/analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('overview')
  overview(@Query() query: unknown) {
    const parsed = overviewQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid analytics query.');
    return this.analyticsService.getOverview(parsed.data);
  }
}
