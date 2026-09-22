import { BadRequestException, Body, Controller, Get, Patch, Query, UseGuards } from '@nestjs/common';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard';
import { CurrentAdmin } from '../admin-auth/current-admin.decorator';
import { candidatesQuerySchema, overviewQuerySchema, updateGrowthSettingsSchema } from './growth-intelligence.dto';
import { GrowthIntelligenceService } from './growth-intelligence.service';
import { GrowthSettingsService } from './growth-settings.service';

interface AuthenticatedAdmin {
  id: string;
}

// Admin-only, READ-ONLY analytics (the only write is the threshold configuration). AdminAuthGuard only: customer and staff tokens are signed with
// different keys/audience and cannot pass it. No route sends anything, creates a segment / automation, or changes a customer. No response carries a
// customer id, Telegram id, phone number or Poster id — customers appear by display name only.
@UseGuards(AdminAuthGuard)
@Controller('admin/growth')
export class GrowthIntelligenceController {
  constructor(
    private readonly growth: GrowthIntelligenceService,
    private readonly settings: GrowthSettingsService,
  ) {}

  @Get('settings')
  getSettings() {
    return this.settings.get();
  }

  @Patch('settings')
  updateSettings(@Body() body: unknown, @CurrentAdmin() admin: AuthenticatedAdmin) {
    const parsed = updateGrowthSettingsSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.settings.update(parsed.data, admin.id);
  }

  @Get('branches')
  branches() {
    return this.growth.listBranches();
  }

  @Get('overview')
  overview(@Query() query: Record<string, string | undefined>) {
    const parsed = overviewQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const { period, from, to, branchId } = parsed.data;
    return this.growth.overview({
      branchId: branchId ?? null,
      period: period === 'custom' ? { from, to } : period ? { days: Number(period) } : undefined,
    });
  }

  // Deterministic candidate feeds for a FUTURE CRM trigger (Phase 13). Read-only: nothing is queued or sent.
  @Get('candidates')
  candidates(@Query() query: Record<string, string | undefined>) {
    const parsed = candidatesQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const limit = Math.min(100, Math.max(1, Number(parsed.data.limit ?? 20)));
    return this.growth.candidates(parsed.data.type, { cursor: parsed.data.cursor, limit });
  }
}
