import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { clampPageSize } from '../../common/util/pagination';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard';
import { CurrentAdmin } from '../admin-auth/current-admin.decorator';
import { parseBusinessDate } from '../analytics/analytics-period';
import { createRewardProgramSchema, updateRewardProgramSchema } from './reward-programs.dto';
import { RewardReportService } from './reward-report.service';
import { RewardProgramsService } from './reward-programs.service';

// Same query convention as /admin/analytics/overview and /admin/reports/*: period (today | yesterday | last7 |
// last30 | custom, default today), startDate/endDate (YYYY-MM-DD business dates, custom only).
const dateField = z.string().refine((v) => parseBusinessDate(v) !== null, 'Dates must be valid YYYY-MM-DD.');
const reportQuerySchema = z.object({
  period: z.enum(['today', 'yesterday', 'last7', 'last30', 'custom']).default('today'),
  startDate: dateField.optional(),
  endDate: dateField.optional(),
});

interface AuthenticatedAdmin {
  id: string;
}

// Admin-only everywhere — a customer JWT structurally cannot pass this guard.
@UseGuards(AdminAuthGuard)
@Controller('admin/reward-programs')
export class RewardProgramsController {
  constructor(
    private readonly rewardProgramsService: RewardProgramsService,
    private readonly rewardReportService: RewardReportService,
  ) {}

  // Declared before the `:id` route below so Nest matches this literal path first — otherwise
  // ":id" would swallow "reports" as if it were a program id.
  @Get('reports/5-plus-1')
  report(@Query() query: unknown) {
    const parsed = reportQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid reward report query.');
    return this.rewardReportService.getReport(parsed.data);
  }

  @Get()
  list(@Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    return this.rewardProgramsService.list({ cursor, limit: clampPageSize(limit) });
  }

  @Post()
  create(@Body() body: unknown, @CurrentAdmin() admin: AuthenticatedAdmin) {
    const parsed = createRewardProgramSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    return this.rewardProgramsService.create(parsed.data, admin.id);
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    const result = await this.rewardProgramsService.getById(id);
    if (!result) {
      throw new NotFoundException('Reward program not found.');
    }
    return result;
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: unknown, @CurrentAdmin() admin: AuthenticatedAdmin) {
    const parsed = updateRewardProgramSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    return this.rewardProgramsService.update(id, parsed.data, admin.id);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.rewardProgramsService.delete(id);
    return { success: true };
  }

  @Post(':id/activate')
  activate(@Param('id') id: string, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return this.rewardProgramsService.setActive(id, true, admin.id);
  }

  @Post(':id/deactivate')
  deactivate(@Param('id') id: string, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return this.rewardProgramsService.setActive(id, false, admin.id);
  }

  @Get(':id/redemptions')
  async redemptions(@Param('id') id: string, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    const result = await this.rewardProgramsService.getRedemptions(id, { cursor, limit: clampPageSize(limit) });
    if (!result) {
      throw new NotFoundException('Reward program not found.');
    }
    return result;
  }
}
