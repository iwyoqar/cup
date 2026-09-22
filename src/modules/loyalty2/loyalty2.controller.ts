import { BadRequestException, Body, Controller, Get, HttpCode, Logger, Put, Query, UseGuards } from '@nestjs/common';
import { clampPageSize } from '../../common/util/pagination';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentCustomer } from '../auth/current-customer.decorator';
import { setBirthdaySchema } from './loyalty2.dto';
import { Loyalty2BirthdayService } from './loyalty2-birthday.service';
import { Loyalty2HistoryService } from './loyalty2-history.service';
import { Loyalty2ProfileService } from './loyalty2-profile.service';
import { Loyalty2SyncService } from './loyalty2-sync.service';

interface AuthenticatedCustomer {
  id: string;
}

// Customer-facing, read-only Loyalty 2.0 (the only write is the customer setting their OWN birthday once). Identity always
// comes from @CurrentCustomer() — never a query/body/path parameter. Customer JWT only: an admin or staff token cannot pass
// AuthGuard (different signing keys/audience). The existing GET /loyalty, /loyalty/rewards and /loyalty/transactions stay in
// LoyaltyController untouched.
@UseGuards(AuthGuard)
@Controller('loyalty')
export class Loyalty2Controller {
  private readonly logger = new Logger(Loyalty2Controller.name);

  constructor(
    private readonly profile: Loyalty2ProfileService,
    private readonly sync: Loyalty2SyncService,
    private readonly history: Loyalty2HistoryService,
    private readonly birthday: Loyalty2BirthdayService,
  ) {}

  // Brings this customer's Loyalty 2.0 state up to date (idempotent; a no-op while the program is off), then returns it.
  @Get('overview')
  async overview(@CurrentCustomer() customer: AuthenticatedCustomer) {
    try {
      await this.sync.syncCustomer(customer.id);
    } catch (err) {
      // A sync problem must never hide the customer's profile; the next view (or the background job) retries it.
      this.logger.error(`Loyalty 2.0 sync failed on overview: ${err instanceof Error ? err.message : String(err)}`);
    }
    return this.profile.getProfile(customer.id);
  }

  @Get('history')
  getHistory(@CurrentCustomer() customer: AuthenticatedCustomer, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    return this.history.getHistory(customer.id, { cursor: cursor || undefined, limit: clampPageSize(limit) });
  }

  @Put('birthday')
  @HttpCode(204)
  async setBirthday(@CurrentCustomer() customer: AuthenticatedCustomer, @Body() body: unknown): Promise<void> {
    const parsed = setBirthdaySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('birthDate must be YYYY-MM-DD.');
    await this.birthday.setOwnBirthday(customer.id, parsed.data.birthDate);
  }
}
