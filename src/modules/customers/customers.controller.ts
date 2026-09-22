import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentCustomer } from '../auth/current-customer.decorator';
import { CustomersService } from './customers.service';

interface AuthenticatedCustomer {
  id: string;
}

// customerId always comes from the validated session via @CurrentCustomer() — never from a
// query/body/path parameter (spec section 2/9).
@UseGuards(AuthGuard)
@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get('me')
  getMyProfile(@CurrentCustomer() customer: AuthenticatedCustomer) {
    return this.customersService.getProfile(customer.id);
  }

  // Phase 11: the customer's own public identity code (for the QR/barcode in the Mini App).
  @Get('me/identity')
  getMyIdentity(@CurrentCustomer() customer: AuthenticatedCustomer) {
    return this.customersService.getIdentity(customer.id);
  }
}
