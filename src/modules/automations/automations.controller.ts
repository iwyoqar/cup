import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { clampPageSize } from '../../common/util/pagination';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard';
import { CurrentAdmin } from '../admin-auth/current-admin.decorator';
import { AutomationPreviewService } from './automation-preview.service';
import { AutomationSettingsService } from './automation-settings.service';
import { createAutomationSchema, updateAutomationSchema, updateCrmSettingsSchema } from './automations.dto';
import { AutomationsService } from './automations.service';

interface AuthenticatedAdmin {
  id: string;
}

// Admin-only CRM automation administration. AdminAuthGuard only: customer and staff tokens are signed with different keys/audience and cannot
// pass it. No endpoint takes a customer id or Telegram id, none returns internal customer / chat / Telegram identifiers, and there is deliberately
// no endpoint that forces a send — sending happens only from the runner, behind both safety gates.
@UseGuards(AdminAuthGuard)
@Controller('admin/crm')
export class AutomationsController {
  constructor(
    private readonly automations: AutomationsService,
    private readonly preview: AutomationPreviewService,
    private readonly settings: AutomationSettingsService,
  ) {}

  @Get('settings')
  getSettings() {
    return this.settings.getView();
  }

  @Patch('settings')
  updateSettings(@Body() body: unknown, @CurrentAdmin() admin: AuthenticatedAdmin) {
    const parsed = updateCrmSettingsSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.settings.update(parsed.data, admin.id);
  }

  @Get('automations/meta')
  meta() {
    return this.automations.meta();
  }

  @Get('automations')
  list(@Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    return this.automations.list({ cursor: cursor || undefined, limit: clampPageSize(limit) });
  }

  @Post('automations')
  create(@Body() body: unknown, @CurrentAdmin() admin: AuthenticatedAdmin) {
    const parsed = createAutomationSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.automations.create(parsed.data, admin.id);
  }

  @Get('automations/:id')
  get(@Param('id') id: string) {
    return this.automations.get(id);
  }

  @Patch('automations/:id')
  update(@Param('id') id: string, @Body() body: unknown, @CurrentAdmin() admin: AuthenticatedAdmin) {
    const parsed = updateAutomationSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.automations.update(id, parsed.data, admin.id);
  }

  @Post('automations/:id/activate')
  activate(@Param('id') id: string, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return this.automations.activate(id, admin.id);
  }

  @Post('automations/:id/pause')
  pause(@Param('id') id: string, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return this.automations.pause(id, admin.id);
  }

  @Post('automations/:id/archive')
  archive(@Param('id') id: string, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return this.automations.archive(id, admin.id);
  }

  // Dry run: reads only, never sends, never writes.
  @Post('automations/:id/preview')
  previewAutomation(@Param('id') id: string) {
    return this.preview.preview(id);
  }

  @Get('automations/:id/executions')
  executions(@Param('id') id: string, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    return this.automations.executions(id, { cursor: cursor || undefined, limit: clampPageSize(limit) });
  }
}
