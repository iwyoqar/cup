import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { clampPageSize } from '../../common/util/pagination';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard';
import { CurrentAdmin } from '../admin-auth/current-admin.decorator';
import { createSegmentSchema, updateSegmentSchema } from './segments.dto';
import { SegmentsService } from './segments.service';

interface AuthenticatedAdmin {
  id: string;
}

// Admin-only everywhere (Part SECURITY) — a customer JWT structurally cannot pass this guard.
// No endpoint here accepts a customerId; segment matching is always computed for whichever
// customers currently satisfy the segment's own saved conditions, never a caller-supplied list.
@UseGuards(AdminAuthGuard)
@Controller('admin/segments')
export class SegmentsController {
  constructor(private readonly segmentsService: SegmentsService) {}

  @Get()
  list(@Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    return this.segmentsService.list({ cursor, limit: clampPageSize(limit) });
  }

  @Post()
  create(@Body() body: unknown, @CurrentAdmin() admin: AuthenticatedAdmin) {
    const parsed = createSegmentSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    return this.segmentsService.create(parsed.data, admin.id);
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    const result = await this.segmentsService.getById(id);
    if (!result) {
      throw new NotFoundException('Segment not found.');
    }
    return result;
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: unknown, @CurrentAdmin() admin: AuthenticatedAdmin) {
    const parsed = updateSegmentSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    const result = await this.segmentsService.update(id, parsed.data, admin.id);
    if (!result) {
      throw new NotFoundException('Segment not found.');
    }
    return result;
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    const deleted = await this.segmentsService.delete(id);
    if (!deleted) {
      throw new NotFoundException('Segment not found.');
    }
    return { success: true };
  }

  @Get(':id/customers')
  async matchingCustomers(@Param('id') id: string, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    const result = await this.segmentsService.getMatchingCustomers(id, { cursor, limit: clampPageSize(limit) });
    if (!result) {
      throw new NotFoundException('Segment not found.');
    }
    return result;
  }
}
