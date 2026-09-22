import { BadRequestException, Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { CurrentCustomer } from './current-customer.decorator';
import { AuthGuard } from './auth.guard';
import { AuthService, PublicCustomerProfile } from './auth.service';
import { telegramAuthSchema } from './telegram-auth.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('telegram')
  async telegramAuth(@Body() body: unknown) {
    const parsed = telegramAuthSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('initData is required.');
    }
    return this.authService.authenticateTelegram(parsed.data.initData);
  }

  // Simple protected endpoint (per this phase's spec) — proves the guard/decorator work end
  // to end and will be useful for Mini App development. Identity comes only from the
  // validated session token; there is no customerId parameter to spoof.
  @UseGuards(AuthGuard)
  @Get('me')
  me(@CurrentCustomer() customer: { id: string }): Promise<PublicCustomerProfile> {
    return this.authService.getPublicProfile(customer.id);
  }
}
