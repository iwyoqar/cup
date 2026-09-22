import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { clampPageSize } from '../../common/util/pagination';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard';
import { CurrentAdmin } from '../admin-auth/current-admin.decorator';
import { createPromotionSchema, updatePromotionSchema } from './promotions.dto';
import { PromotionsService } from './promotions.service';

interface AuthenticatedAdmin {
  id: string;
}

// Admin-only everywhere (spec's Security section) — a customer JWT structurally cannot pass this
// guard. No endpoint here accepts a caller-supplied customerId for eligibility; audience/
// redemption views are always computed from the promotion's own saved definition.
@UseGuards(AdminAuthGuard)
@Controller('admin/promotions')
export class PromotionsController {
  constructor(private readonly promotionsService: PromotionsService) {}

  @Get()
  list(@Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    return this.promotionsService.list({ cursor, limit: clampPageSize(limit) });
  }

  @Post()
  create(@Body() body: unknown, @CurrentAdmin() admin: AuthenticatedAdmin) {
    const parsed = createPromotionSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    return this.promotionsService.create(parsed.data, admin.id);
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    const result = await this.promotionsService.getById(id);
    if (!result) {
      throw new NotFoundException('Promotion not found.');
    }
    return result;
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: unknown, @CurrentAdmin() admin: AuthenticatedAdmin) {
    const parsed = updatePromotionSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    return this.promotionsService.update(id, parsed.data, admin.id);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.promotionsService.delete(id);
    return { success: true };
  }

  @Post(':id/activate')
  activate(@Param('id') id: string, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return this.promotionsService.setActive(id, true, admin.id);
  }

  @Post(':id/deactivate')
  deactivate(@Param('id') id: string, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return this.promotionsService.setActive(id, false, admin.id);
  }

  // Read-only preview — never creates redemptions, never sends anything, never mutates
  // customer/loyalty/order/segment data (spec's Audience Preview section).
  @Get(':id/audience')
  async audience(@Param('id') id: string, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    const result = await this.promotionsService.getAudiencePreview(id, { cursor, limit: clampPageSize(limit) });
    if (!result) {
      throw new NotFoundException('Promotion not found.');
    }
    return result;
  }

  @Get(':id/redemptions')
  async redemptions(@Param('id') id: string, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    const result = await this.promotionsService.getRedemptions(id, { cursor, limit: clampPageSize(limit) });
    if (!result) {
      throw new NotFoundException('Promotion not found.');
    }
    return result;
  }
}
