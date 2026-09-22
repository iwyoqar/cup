import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentCustomer } from '../auth/current-customer.decorator';
import { PromotionsService } from './promotions.service';

interface AuthenticatedCustomer {
  id: string;
}

// Customer-facing — the existing customer AuthGuard, never AdminAuthGuard (spec's Security
// section: separate guards, structurally incompatible tokens). customerId always comes from the
// validated session via @CurrentCustomer(), never from a query/body parameter — a customer
// cannot request another customer's eligible promotions.
@UseGuards(AuthGuard)
@Controller('promotions')
export class CustomerPromotionsController {
  constructor(private readonly promotionsService: PromotionsService) {}

  @Get()
  list(@CurrentCustomer() customer: AuthenticatedCustomer) {
    return this.promotionsService.listForCustomer(customer.id);
  }
}
