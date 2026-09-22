import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard';
import { CurrentAdmin } from '../admin-auth/current-admin.decorator';
import { createAchievementSchema, replaceLevelsSchema, updateAchievementSchema, updateLoyalty2SettingsSchema } from './loyalty2.dto';
import { Loyalty2AchievementsService } from './loyalty2-achievements.service';
import { Loyalty2LevelsService } from './loyalty2-levels.service';
import { Loyalty2SettingsService } from './loyalty2-settings.service';

interface AuthenticatedAdmin {
  id: string;
}

// Admin-only configuration of Loyalty 2.0 (settings, levels, achievements). AdminAuthGuard only: customer and staff tokens are
// signed with different keys/audience and cannot pass it, and nothing here accepts a customer id.
@UseGuards(AdminAuthGuard)
@Controller('admin/loyalty2')
export class AdminLoyalty2Controller {
  constructor(
    private readonly settings: Loyalty2SettingsService,
    private readonly levels: Loyalty2LevelsService,
    private readonly achievements: Loyalty2AchievementsService,
  ) {}

  @Get('settings')
  getSettings() {
    return this.settings.get();
  }

  @Patch('settings')
  updateSettings(@Body() body: unknown, @CurrentAdmin() admin: AuthenticatedAdmin) {
    const parsed = updateLoyalty2SettingsSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.settings.update(parsed.data, admin.id);
  }

  @Get('levels')
  getLevels() {
    return this.levels.listForAdmin();
  }

  @Put('levels')
  replaceLevels(@Body() body: unknown) {
    const parsed = replaceLevelsSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.levels.replace(parsed.data.levels);
  }

  @Get('achievements')
  listAchievements() {
    return this.achievements.list();
  }

  @Post('achievements')
  createAchievement(@Body() body: unknown) {
    const parsed = createAchievementSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.achievements.create(parsed.data);
  }

  @Patch('achievements/:id')
  updateAchievement(@Param('id') id: string, @Body() body: unknown) {
    const parsed = updateAchievementSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.achievements.update(id, parsed.data);
  }
}
