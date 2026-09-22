import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { clampPageSize } from '../../common/util/pagination';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard';
import { CurrentAdmin } from '../admin-auth/current-admin.decorator';
import { createCampaignSchema, updateCampaignSchema } from './campaigns.dto';
import { CampaignsService } from './campaigns.service';

interface AuthenticatedAdmin {
  id: string;
}

// Admin-only everywhere (spec's Security section) — a customer JWT structurally cannot pass this
// guard. No endpoint here accepts a caller-supplied customer/audience list; every audience is
// always derived from the campaign's own segmentId, never a frontend-supplied id list.
@UseGuards(AdminAuthGuard)
@Controller('admin/campaigns')
export class CampaignsController {
  constructor(private readonly campaignsService: CampaignsService) {}

  @Get()
  list(@Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    return this.campaignsService.list({ cursor, limit: clampPageSize(limit) });
  }

  @Post()
  create(@Body() body: unknown, @CurrentAdmin() admin: AuthenticatedAdmin) {
    const parsed = createCampaignSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    return this.campaignsService.create(parsed.data, admin.id);
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    const result = await this.campaignsService.getById(id);
    if (!result) {
      throw new NotFoundException('Campaign not found.');
    }
    return result;
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: unknown, @CurrentAdmin() admin: AuthenticatedAdmin) {
    const parsed = updateCampaignSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    return this.campaignsService.update(id, parsed.data, admin.id);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.campaignsService.delete(id);
    return { success: true };
  }

  // Read-only preview — never creates recipients, never sends (spec's Audience Preview
  // section).
  @Get(':id/audience')
  async audience(@Param('id') id: string, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    const result = await this.campaignsService.getAudiencePreview(id, { cursor, limit: clampPageSize(limit) });
    if (!result) {
      throw new NotFoundException('Campaign not found.');
    }
    return result;
  }

  // The one explicit, external-side-effect action in this controller (spec's Send Safety /
  // Send Confirmation sections) — the Admin UI must never call this from the campaign form
  // itself, only from a dedicated confirmation step.
  @Post(':id/send')
  send(@Param('id') id: string, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return this.campaignsService.send(id, admin.id);
  }

  @Get(':id/recipients')
  async recipients(@Param('id') id: string, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    const result = await this.campaignsService.getRecipients(id, { cursor, limit: clampPageSize(limit) });
    if (!result) {
      throw new NotFoundException('Campaign not found.');
    }
    return result;
  }
}
