import { Injectable } from '@nestjs/common';
import { ConfigService } from '../../common/config/config.service';
import { CustomersRepository } from '../customers/customers.repository';
import { TelegramAccountsRepository } from '../telegram-accounts/telegram-accounts.repository';
import { resolveOrCreateTelegramCustomer } from '../telegram-accounts/telegram-identity.service';
import { InvalidSessionError } from './auth.errors';
import { SessionService } from './session.service';
import { verifyTelegramInitData } from './telegram-init-data';

export interface PublicCustomerProfile {
  id: string;
  displayName: string | null;
  phone: string | null;
  telegramUserId: string;
}

export interface AuthenticatedSession {
  sessionToken: string;
  customer: PublicCustomerProfile;
}

// Constructor signature deliberately unchanged since Phase 1.3 (4 params, same order) — see
// test/unit/auth.service.spec.ts, which constructs this directly with `new AuthService(...)`
// and must not be modified. Phase 1.6 moved the shared Customer+TelegramAccount resolution
// logic to telegram-accounts/telegram-identity.service.ts as a plain function specifically so
// it could be reused by the new Telegram Bot without adding a new constructor dependency here.
@Injectable()
export class AuthService {
  constructor(
    private readonly telegramAccountsRepository: TelegramAccountsRepository,
    private readonly customersRepository: CustomersRepository,
    private readonly sessionService: SessionService,
    private readonly config: ConfigService,
  ) {}

  async authenticateTelegram(rawInitData: string): Promise<AuthenticatedSession> {
    // The ONLY source of Telegram identity for Mini App auth: HMAC-verified initData. Never
    // trust a Telegram user id, username, or any profile field supplied any other way.
    const verified = verifyTelegramInitData(
      rawInitData,
      this.config.env.TELEGRAM_BOT_TOKEN,
      this.config.env.TELEGRAM_INIT_DATA_MAX_AGE_SECONDS,
    );

    // Mini App auth has no real chat context, so chatId is omitted entirely — never
    // overwrites a real chatId the Bot may have already recorded (see telegram-identity.service.ts).
    const { customer, telegramAccount } = await resolveOrCreateTelegramCustomer(this.telegramAccountsRepository, {
      telegramUserId: verified.telegramUserId,
      username: verified.username,
      firstName: verified.firstName,
      lastName: verified.lastName,
      languageCode: verified.languageCode,
    });
    const sessionToken = this.sessionService.issue(customer.id);

    return {
      sessionToken,
      customer: {
        id: customer.id,
        displayName: customer.displayName,
        phone: customer.phone,
        telegramUserId: telegramAccount.telegramUserId,
      },
    };
  }

  async getPublicProfile(customerId: string): Promise<PublicCustomerProfile> {
    const customer = await this.customersRepository.findById(customerId);
    if (!customer) {
      throw new InvalidSessionError('Session refers to an unknown customer.');
    }
    const telegramAccount = await this.telegramAccountsRepository.findByCustomerId(customerId);
    return {
      id: customer.id,
      displayName: customer.displayName,
      phone: customer.phone,
      telegramUserId: telegramAccount?.telegramUserId ?? '',
    };
  }
}
