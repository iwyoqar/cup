import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard';
import { parseBusinessDate } from '../analytics/analytics-period';
import { ReportsLocationsService } from './reports-locations.service';
import { ReportsService } from './reports.service';

// Same query convention as /admin/analytics/overview (Part 3 of the Phase A spec): `period` (today | yesterday |
// last7 | last30 | custom, default today), `startDate`/`endDate` (YYYY-MM-DD business dates, custom only), optional
// `branchId`. Overview and Sales are two routes over the identical computation — see reports.service.ts.
const dateField = z.string().refine((v) => parseBusinessDate(v) !== null, 'Dates must be valid YYYY-MM-DD.');

const overviewQuerySchema = z.object({
  period: z.enum(['today', 'yesterday', 'last7', 'last30', 'custom']).default('today'),
  startDate: dateField.optional(),
  endDate: dateField.optional(),
  branchId: z.string().min(1).max(64).optional(),
});

// Read-only. Admin session only, same as Analytics/Finance.
@UseGuards(AdminAuthGuard)
@Controller('admin/reports')
export class ReportsController {
  constructor(
    private readonly reportsService: ReportsService,
    private readonly reportsLocationsService: ReportsLocationsService,
  ) {}

  @Get('overview')
  overview(@Query() query: unknown) {
    const parsed = overviewQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid reports query.');
    return this.reportsService.getOverview(parsed.data);
  }

  @Get('sales')
  sales(@Query() query: unknown) {
    const parsed = overviewQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid reports query.');
    return this.reportsService.getOverview(parsed.data);
  }

  @Get('locations')
  locations(@Query() query: unknown) {
    const parsed = overviewQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid reports query.');
    return this.reportsLocationsService.getLocations(parsed.data);
  }
}
