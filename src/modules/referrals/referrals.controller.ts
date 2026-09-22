import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { clampPageSize } from '../../common/util/pagination';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentCustomer } from '../auth/current-customer.decorator';
import { ReferralsService } from './referrals.service';

interface AuthenticatedCustomer {
  id: string;
}

// Customer-facing, READ-ONLY referral view. Identity always comes from @CurrentCustomer() — never a query/body/path parameter — and there is no
// write route at all: a customer cannot set a referrer, a status, a reward amount or a qualification. Customer JWT only: admin and staff tokens are
// signed with different keys/audience and cannot pass AuthGuard. Nothing here exposes internal ids, Telegram/Poster ids or another customer's data.
@UseGuards(AuthGuard)
@Controller('referrals')
export class ReferralsController {
  constructor(private readonly referrals: ReferralsService) {}

  @Get()
  overview(@CurrentCustomer() customer: AuthenticatedCustomer) {
    return this.referrals.getOverview(customer.id);
  }

  @Get('history')
  history(@CurrentCustomer() customer: AuthenticatedCustomer, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    return this.referrals.getHistory(customer.id, { cursor: cursor && /^[A-Za-z0-9]{1,64}$/.test(cursor) ? cursor : undefined, limit: clampPageSize(limit) });
  }
}
