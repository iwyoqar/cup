import { BadRequestException, Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard';
import { CurrentAdmin } from '../admin-auth/current-admin.decorator';
import { updateLoyaltySettingsSchema } from './loyalty-settings.dto';
import { LoyaltySettingsService } from './loyalty-settings.service';

interface AuthenticatedAdmin {
  id: string;
}

// Admin-only — AdminAuthGuard, never the customer AuthGuard (Part 2/15). A customer JWT
// structurally cannot pass this guard: it was never signed with ADMIN_JWT_SECRET.
@UseGuards(AdminAuthGuard)
@Controller('admin/settings/loyalty')
export class AdminLoyaltySettingsController {
  constructor(private readonly loyaltySettingsService: LoyaltySettingsService) {}

  @Get()
  get() {
    return this.loyaltySettingsService.get();
  }

  @Patch()
  async update(@Body() body: unknown, @CurrentAdmin() admin: AuthenticatedAdmin) {
    const parsed = updateLoyaltySettingsSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    // Server-side validation happens inside the service regardless of what the Admin
    // frontend already checked (Part 11: "Do not trust Admin frontend validation alone").
    return this.loyaltySettingsService.update(parsed.data, admin.id);
  }
}
