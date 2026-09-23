import { BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, Post, Query, UseGuards } from '@nestjs/common';
import { clampPageSize } from '../../common/util/pagination';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard';
import { CurrentAdmin } from '../admin-auth/current-admin.decorator';
import { isAdminRole } from '../staff/staff-roles';
import { AdminCustomersService } from './admin-customers.service';

// Admin-only — AdminAuthGuard everywhere in this controller (Part 12). A customer JWT
// structurally cannot pass this guard: it was never signed with ADMIN_JWT_SECRET. No endpoint
// here accepts a customerId "ownership" filter from the caller — search is by name/phone/
// username text only, and the :id param is simply which admin-visible profile to open, not an
// identity claim.
@UseGuards(AdminAuthGuard)
@Controller('admin/customers')
export class AdminCustomersController {
  constructor(private readonly adminCustomersService: AdminCustomersService) {}

  @Get()
  list(@Query('search') search?: string, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    return this.adminCustomersService.listCustomers({ search, cursor, limit: clampPageSize(limit) });
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    const result = await this.adminCustomersService.getCustomer360(id);
    if (!result) {
      throw new NotFoundException('Customer not found.');
    }
    return result;
  }

  // Phase 11.4: bounded, cursor-paginated unified activity (CUP orders, POS purchases; `filter=all` adds loyalty and reward
  // events). Default 10, max 20; the cursor is opaque. The :id is an admin-selected resource, never an identity claim.
  @Get(':id/activity')
  async activity(@Param('id') id: string, @Query('cursor') cursor?: string, @Query('limit') limit?: string, @Query('filter') filter?: string) {
    if (filter !== undefined && filter !== 'purchases' && filter !== 'all') {
      throw new BadRequestException('filter must be "purchases" or "all".');
    }
    const result = await this.adminCustomersService.getCustomerActivity(id, { cursor: cursor || undefined, limit: clampPageSize(limit), filter: filter ?? 'purchases' });
    if (!result) {
      throw new NotFoundException('Customer not found.');
    }
    return result;
  }

  // Phase 11: never automatic and never an arbitrary edit — requires an explicit { confirm: true }.
  @Post(':id/loyalty-code/regenerate')
  async regenerateCode(@Param('id') id: string, @Body() body: { confirm?: unknown }, @CurrentAdmin() admin: { id: string; role: string }) {
    if (!isAdminRole(admin.role)) {
      throw new ForbiddenException('Admin role required.');
    }
    if (body?.confirm !== true) {
      throw new BadRequestException('Regenerating a customer code invalidates their QR — send { "confirm": true } to proceed.');
    }
    const result = await this.adminCustomersService.regenerateLoyaltyCode(id, admin.id);
    if (!result) {
      throw new NotFoundException('Customer not found.');
    }
    return result;
  }

  // Phase 26: soft delete only (Customer.isActive = false) — never a hard delete, never touches
  // related history. Never automatic: requires an explicit { confirm: true }, same convention as
  // loyalty-code/regenerate above. Admin role required (not just any authenticated admin session).
  @Post(':id/deactivate')
  async deactivate(@Param('id') id: string, @Body() body: { confirm?: unknown }, @CurrentAdmin() admin: { id: string; role: string }) {
    if (!isAdminRole(admin.role)) {
      throw new ForbiddenException('Admin role required.');
    }
    if (body?.confirm !== true) {
      throw new BadRequestException('Deactivating a customer removes them from the active customer list — send { "confirm": true } to proceed.');
    }
    const result = await this.adminCustomersService.deactivateCustomer(id, admin.id);
    if (!result) {
      throw new NotFoundException('Customer not found.');
    }
    return result;
  }
}
