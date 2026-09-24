import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard';
import { parseBusinessDate } from '../analytics/analytics-period';
import { ReportsLocationsService } from './reports-locations.service';
import { ReportsPaymentsService } from './reports-payments.service';
import { ReportsCategoriesService } from './reports-categories.service';
import { ReportsProductsService } from './reports-products.service';
import { ReportsAbcService } from './reports-abc.service';
import { ReportsCampaignsService } from './reports-campaigns.service';
import { ReportsCustomersService } from './reports-customers.service';
import { ReportsEmployeesService } from './reports-employees.service';
import { ReportsLoyaltyService } from './reports-loyalty.service';
import { ReportsPromotionsService } from './reports-promotions.service';
import { ReportsReferralsService } from './reports-referrals.service';
import { ReportsTaxesService } from './reports-taxes.service';
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

// Reports Phase D-G. Same period contract everywhere. Reports whose data has no reliable branch attribution (Employees,
// Loyalty, Campaigns, Referrals) do not accept branchId at all — a 400, never a silently ignored filter.
const periodOnlySchema = overviewQuerySchema.omit({ branchId: true });
const direction = z.enum(['asc', 'desc']);
const pageFields = { page: z.coerce.number().int().min(1).max(100_000).default(1), limit: z.coerce.number().int().min(1).max(200).default(50) };
const idField = z.string().min(1).max(64);

const customersQuerySchema = overviewQuerySchema.extend({
  search: z.string().max(100).optional(),
  sortBy: z.enum(['revenue', 'purchases', 'units', 'averageCheck', 'lastPurchase', 'firstPurchase']).default('revenue'),
  sortDirection: direction.default('desc'),
  ...pageFields,
});
const employeesQuerySchema = periodOnlySchema.extend({ sortBy: z.enum(['revenue', 'receipts', 'averageReceipt', 'employeeName']).default('revenue'), sortDirection: direction.default('desc') });
const loyaltyQuerySchema = periodOnlySchema.extend({ search: z.string().max(100).optional(), ...pageFields });
const promotionsQuerySchema = overviewQuerySchema.extend({ promotionId: idField.optional(), sortBy: z.enum(['redemptions', 'customers', 'lastRedemption']).default('redemptions'), sortDirection: direction.default('desc') });
const campaignsQuerySchema = periodOnlySchema.extend({ campaignId: idField.optional(), sortBy: z.enum(['recipients', 'successfulSends', 'failedSends', 'lastActivity']).default('lastActivity'), sortDirection: direction.default('desc') });
const referralsQuerySchema = periodOnlySchema.extend({
  referrerCustomerId: idField.optional(),
  sortBy: z.enum(['referrals', 'qualified', 'rewards', 'qualifyingAmount']).default('qualified'),
  sortDirection: direction.default('desc'),
  ...pageFields,
});
const abcQuerySchema = overviewQuerySchema.extend({ source: z.enum(['all', 'cup', 'pos']).default('all'), categoryId: idField.optional() });

function parseQuery<T extends z.ZodTypeAny>(schema: T, query: unknown, branchSupported = true): z.infer<T> {
  if (!branchSupported && query && typeof query === 'object' && 'branchId' in query) throw new BadRequestException('Branch filter is not supported for this report.');
  const parsed = schema.safeParse(query);
  if (!parsed.success) throw new BadRequestException('Invalid reports query.');
  return parsed.data;
}

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
    private readonly reportsCustomersService: ReportsCustomersService,
    private readonly reportsEmployeesService: ReportsEmployeesService,
    private readonly reportsTaxesService: ReportsTaxesService,
    private readonly reportsLoyaltyService: ReportsLoyaltyService,
    private readonly reportsPromotionsService: ReportsPromotionsService,
    private readonly reportsCampaignsService: ReportsCampaignsService,
    private readonly reportsReferralsService: ReportsReferralsService,
    private readonly reportsAbcService: ReportsAbcService,
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

  @Get('customers')
  customers(@Query() query: unknown) {
    return this.reportsCustomersService.getCustomers(parseQuery(customersQuerySchema, query));
  }

  @Get('employees')
  employees(@Query() query: unknown) {
    return this.reportsEmployeesService.getEmployees(parseQuery(employeesQuerySchema, query, false));
  }

  @Get('taxes')
  taxes(@Query() query: unknown) {
    return this.reportsTaxesService.getTaxes(parseQuery(overviewQuerySchema, query));
  }

  @Get('loyalty')
  loyalty(@Query() query: unknown) {
    return this.reportsLoyaltyService.getLoyalty(parseQuery(loyaltyQuerySchema, query, false));
  }

  @Get('promotions')
  promotions(@Query() query: unknown) {
    return this.reportsPromotionsService.getPromotions(parseQuery(promotionsQuerySchema, query));
  }

  @Get('campaigns')
  campaigns(@Query() query: unknown) {
    return this.reportsCampaignsService.getCampaigns(parseQuery(campaignsQuerySchema, query, false));
  }

  @Get('referrals')
  referrals(@Query() query: unknown) {
    return this.reportsReferralsService.getReferrals(parseQuery(referralsQuerySchema, query, false));
  }

  @Get('abc-analysis')
  abcAnalysis(@Query() query: unknown) {
    return this.reportsAbcService.getAbc(parseQuery(abcQuerySchema, query));
  }
}
