import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard';
import { parseBusinessDate } from '../analytics/analytics-period';
import { ReportsLocationsService } from './reports-locations.service';
import { ReportsPaymentsService } from './reports-payments.service';
import { ReportsCategoriesService } from './reports-categories.service';
import { ReportsProductsService } from './reports-products.service';
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

// Reports Phase C1/C2 — the same period/branch contract plus `source` (all | cup | pos); Products adds a category filter,
// a name search and a sort; Categories adds a sort. Unknown values are rejected (400), never silently defaulted.
const productsQuerySchema = overviewQuerySchema.extend({
  source: z.enum(['all', 'cup', 'pos']).default('all'),
  categoryId: z.string().min(1).max(64).optional(),
  search: z.string().max(100).optional(),
  sortBy: z.enum(['revenue', 'quantity', 'averagePrice', 'theoreticalGrossProfit', 'theoreticalCOGS']).default('revenue'),
  sortDirection: z.enum(['asc', 'desc']).default('desc'),
});

const categoriesQuerySchema = overviewQuerySchema.extend({
  source: z.enum(['all', 'cup', 'pos']).default('all'),
  sortBy: z.enum(['revenue', 'units', 'productCount', 'theoreticalCOGS', 'theoreticalGrossProfit']).default('revenue'),
  sortDirection: z.enum(['asc', 'desc']).default('desc'),
});

// Read-only. Admin session only, same as Analytics/Finance.
@UseGuards(AdminAuthGuard)
@Controller('admin/reports')
export class ReportsController {
  constructor(
    private readonly reportsService: ReportsService,
    private readonly reportsLocationsService: ReportsLocationsService,
    private readonly reportsPaymentsService: ReportsPaymentsService,
    private readonly reportsProductsService: ReportsProductsService,
    private readonly reportsCategoriesService: ReportsCategoriesService,
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

  // Reports Phase B2 — payment-method breakdown read from Poster (observational; never part of any revenue figure).
  @Get('payments')
  payments(@Query() query: unknown) {
    const parsed = overviewQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid reports query.');
    return this.reportsPaymentsService.getPayments(parsed.data);
  }

  @Get('products')
  products(@Query() query: unknown) {
    const parsed = productsQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid reports query.');
    return this.reportsProductsService.getProducts(parsed.data);
  }

  @Get('categories')
  categories(@Query() query: unknown) {
    const parsed = categoriesQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid reports query.');
    return this.reportsCategoriesService.getCategories(parsed.data);
  }
}
