import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { clampPageSize } from '../../common/util/pagination';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard';
import { CurrentAdmin } from '../admin-auth/current-admin.decorator';
import { adminListQuerySchema, updateReferralSettingsSchema } from './referrals.dto';
import { ReferralSettingsService } from './referral-settings.service';
import { ReferralsService } from './referrals.service';

interface AuthenticatedAdmin {
  id: string;
}

// Admin-only referral administration. AdminAuthGuard only: customer and staff tokens are signed with different keys/audience and cannot pass it.
// Deliberately NO route that creates, edits, qualifies, rewards or deletes a referral — every authoritative change happens server-side from the
// rules configured here. No response contains a Telegram id, chat id, phone number, Poster id or customer id.
@UseGuards(AdminAuthGuard)
@Controller('admin/referrals')
export class AdminReferralsController {
  constructor(
    private readonly referrals: ReferralsService,
    private readonly settings: ReferralSettingsService,
  ) {}

  @Get('settings')
  getSettings() {
    return this.settings.get();
  }

  @Patch('settings')
  updateSettings(@Body() body: unknown, @CurrentAdmin() admin: AuthenticatedAdmin) {
    const parsed = updateReferralSettingsSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.settings.update(parsed.data, admin.id);
  }

  @Get('summary')
  summary() {
    return this.referrals.adminSummary();
  }

  @Get()
  list(@Query() query: Record<string, string | undefined>) {
    const parsed = adminListQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const { limit, ...filters } = parsed.data;
    return this.referrals.adminList({ ...filters, limit: clampPageSize(limit) });
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    const detail = /^[A-Za-z0-9]{1,64}$/.test(id) ? await this.referrals.adminDetail(id) : null;
    if (!detail) throw new NotFoundException('Referral not found.');
    return detail;
  }
}
