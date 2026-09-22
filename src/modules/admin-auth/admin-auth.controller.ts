import { BadRequestException, Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AdminAuthGuard } from './admin-auth.guard';
import { AdminAuthService } from './admin-auth.service';
import { adminLoginSchema } from './admin-login.dto';
import { CurrentAdmin } from './current-admin.decorator';

interface AuthenticatedAdmin {
  id: string;
}

@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly adminAuthService: AdminAuthService) {}

  @Post('login')
  async login(@Body() body: unknown) {
    const parsed = adminLoginSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('A valid email and password are required.');
    }
    return this.adminAuthService.login(parsed.data.email, parsed.data.password);
  }

  @UseGuards(AdminAuthGuard)
  @Get('me')
  me(@CurrentAdmin() admin: AuthenticatedAdmin) {
    return this.adminAuthService.getProfile(admin.id);
  }
}
