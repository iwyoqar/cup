import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard';
import { parseBusinessDate } from '../analytics/analytics-period';
import { BranchIntelligenceService } from './branch-intelligence.service';

// Same query convention as Analytics V1 (period = today | yesterday | last7 | last30 | custom, business-local YYYY-MM-DD dates) plus an optional branchId.
// .strict(): an unknown parameter (in particular any customer parameter) is a 400.
const dateField = z.string().refine((v) => parseBusinessDate(v) !== null, 'Dates must be valid YYYY-MM-DD.');
const querySchema = z
  .object({
    period: z.enum(['today', 'yesterday', 'last7', 'last30', 'custom']).default('today'),
    startDate: dateField.optional(),
    endDate: dateField.optional(),
    branchId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
  })
  .strict();

// Read-only and Admin-only: customer and staff tokens are signed with different keys / audience and cannot pass AdminAuthGuard. No route writes anything,
// sends anything or calls Poster / Telegram. No response carries a customer id, phone, Telegram id or Poster id.
@UseGuards(AdminAuthGuard)
@Controller('admin/branch-intelligence')
export class BranchIntelligenceController {
  constructor(private readonly branchIntelligence: BranchIntelligenceService) {}

  @Get('overview')
  overview(@Query() query: Record<string, string | undefined>) {
    const parsed = querySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid branch intelligence query.');
    return this.branchIntelligence.getOverview(parsed.data);
  }
}
