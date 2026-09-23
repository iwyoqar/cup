import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { isUniqueConstraintViolation } from '../../common/util/prisma-errors';
import { PosterClientsService } from '../poster/poster-clients.service';
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
  private readonly logger = new Logger(CustomersService.name);

  constructor(
    private readonly customersRepository: CustomersRepository,
    private readonly telegramAccountsRepository: TelegramAccountsRepository,
    private readonly loyaltyCodeService: LoyaltyCodeService,
    private readonly posterClients: PosterClientsService,
  ) {}

  // Phase 25 — automatic CUP -> Poster customer link, called once a Telegram customer has just
  // shared/re-shared their phone. Never throws: Poster being unreachable, ambiguous, or rejecting
  // creation must never fail Telegram registration (the phone is already saved by the caller before
  // this runs). Idempotent — a customer already linked makes zero Poster calls. `phone` must already
  // be normalized (the exact value just written to Customer.phone), matching rule "auto-link only on
  // normalized phone, nothing else unverified".
  async linkToPoster(customer: { id: string; phone: string | null; displayName: string | null; posterClientId: string | null }): Promise<void> {
    if (customer.posterClientId) return;
    if (!customer.phone) return;

    let outcome;
    try {
      outcome = await this.posterClients.findOrCreateByPhone(customer.phone, customer.displayName ?? customer.phone);
    } catch (err) {
      this.logger.warn(`Poster auto-link failed unexpectedly for customer ${customer.id}: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    if (outcome.kind === 'AMBIGUOUS') {
      this.logger.log(`Poster auto-link ambiguous for customer ${customer.id} — left for Staff Panel to resolve.`);
      return;
    }
    if (outcome.kind === 'FAILED') {
      this.logger.warn(`Poster auto-link failed for customer ${customer.id}: ${outcome.reason}`);
      return;
    }

    try {
      const changed = await this.customersRepository.setPosterClientIfMissing(customer.id, outcome.clientId);
      if (!changed) {
        this.logger.log(`Poster auto-link: customer ${customer.id} was already linked by the time of write, left as-is.`);
      }
    } catch (err) {
      if (isUniqueConstraintViolation(err)) {
        this.logger.warn(`Poster auto-link: client_id=${outcome.clientId} is already linked to a different CUP customer than ${customer.id} — left unlinked for Staff Panel.`);
        return;
      }
      throw err;
    }
  }

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
