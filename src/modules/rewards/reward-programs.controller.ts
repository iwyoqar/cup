import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { clampPageSize } from '../../common/util/pagination';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard';
import { CurrentAdmin } from '../admin-auth/current-admin.decorator';
import { createRewardProgramSchema, updateRewardProgramSchema } from './reward-programs.dto';
import { RewardProgramsService } from './reward-programs.service';

interface AuthenticatedAdmin {
  id: string;
}

// Admin-only everywhere — a customer JWT structurally cannot pass this guard.
@UseGuards(AdminAuthGuard)
@Controller('admin/reward-programs')
export class RewardProgramsController {
  constructor(private readonly rewardProgramsService: RewardProgramsService) {}

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
