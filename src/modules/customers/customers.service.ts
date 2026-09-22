import { Injectable, NotFoundException } from '@nestjs/common';
import { TelegramAccountsRepository } from '../telegram-accounts/telegram-accounts.repository';
import { CustomersRepository } from './customers.repository';
import { LoyaltyCodeService } from './loyalty-code.service';

export interface CustomerProfileView {
  displayName: string | null;
  phone: string | null;
  username: string | null;
}

// Phase 11: what the Mini App needs to render "Shaxsiy CUP". Deliberately just the public code — no
// customer id, Poster client id, phone, balance or token. The QR/barcode payload IS the public code,
// so anything that can read the QR learns nothing beyond a random identifier.
export interface CustomerIdentityView {
  publicCode: string;
  qrPayload: string;
}

@Injectable()
export class CustomersService {
  constructor(
    private readonly customersRepository: CustomersRepository,
    private readonly telegramAccountsRepository: TelegramAccountsRepository,
    private readonly loyaltyCodeService: LoyaltyCodeService,
  ) {}

  async getProfile(customerId: string): Promise<CustomerProfileView> {
    const customer = await this.customersRepository.findById(customerId);
    if (!customer) {
      throw new NotFoundException('Customer not found.');
    }
    const telegramAccount = await this.telegramAccountsRepository.findByCustomerId(customerId);
    return {
      displayName: customer.displayName,
      phone: customer.phone,
      username: telegramAccount?.username ?? null,
    };
  }

  async getIdentity(customerId: string): Promise<CustomerIdentityView> {
    // Issues a code on first use if this customer somehow has none (backfill normally already did).
    const publicCode = await this.loyaltyCodeService.ensureForCustomer(customerId);
    return { publicCode, qrPayload: publicCode };
  }
}
