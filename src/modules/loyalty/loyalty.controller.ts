import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { clampPageSize } from '../../common/util/pagination';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentCustomer } from '../auth/current-customer.decorator';
import { RewardProgramsService } from '../rewards/reward-programs.service';
import { LoyaltyService } from './loyalty.service';

interface AuthenticatedCustomer {
  id: string;
}

// Customer identity always comes from @CurrentCustomer() — never a query/body/path parameter
// (Part 10/15).
@UseGuards(AuthGuard)
@Controller('loyalty')
export class LoyaltyController {
  constructor(
    private readonly loyaltyService: LoyaltyService,
    private readonly rewardProgramsService: RewardProgramsService,
  ) {}

  @Get()
  getMyLoyalty(@CurrentCustomer() customer: AuthenticatedCustomer) {
    return this.loyaltyService.getAccountView(customer.id);
  }

  // Phase 8: a separate route rather than folding into GET /loyalty's own response shape —
  // keeps LoyaltyAccountView's existing consumers (Mini App LoyaltySection) unaffected by a
  // completely different, independently-evolving concept (spec: "Promotion vs Reward... keep
  // these concepts clear"). Still reads naturally as part of the /loyalty API surface, per the
  // spec's "prefer extending existing loyalty response if that keeps the API clean" preference.
  @Get('rewards')
  listMyRewards(@CurrentCustomer() customer: AuthenticatedCustomer) {
    return this.rewardProgramsService.listForCustomer(customer.id);
  }

  // Cursor-paginated, same convention as GET /orders (Part 10 explicitly asks for
  // consistency with the existing order-history implementation).
  @Get('transactions')
  listMyTransactions(
    @CurrentCustomer() customer: AuthenticatedCustomer,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.loyaltyService.listTransactions(customer.id, { cursor, limit: clampPageSize(limit) });
  }
}
