import { Injectable, Logger } from '@nestjs/common';
import { CustomersRepository } from '../customers/customers.repository';
import { CustomersService } from '../customers/customers.service';
import { ReferralAttributionService } from '../referrals/referral-attribution.service';
import { AttributionOutcome } from '../referrals/referral.types';
import { TelegramAccountsRepository } from '../telegram-accounts/telegram-accounts.repository';
import { TelegramIdentityService, TrustedTelegramProfile } from '../telegram-accounts/telegram-identity.service';
import { normalizeTelegramPhone } from './telegram-phone.util';

export interface TelegramContact {
  phone_number: string;
  user_id?: number;
}

export type ContactHandlingResult =
  | { ok: true; customer: { id: string; phone: string | null } }
  | { ok: false; reason: 'mismatched_owner' };

// Pure business logic — no grammY/Telegram-Bot-API types beyond the trusted, already-extracted
// fields the Bot layer passes in. This is what TelegramBotService's handlers call into,
// keeping transport (grammY) and business rules (registration state, phone mandatoriness,
// contact ownership) cleanly separated per this phase's architecture requirement.
@Injectable()
export class TelegramRegistrationService {
  private readonly logger = new Logger(TelegramRegistrationService.name);

  constructor(
    private readonly telegramIdentityService: TelegramIdentityService,
    private readonly telegramAccountsRepository: TelegramAccountsRepository,
    private readonly customersRepository: CustomersRepository,
    private readonly customersService: CustomersService,
    private readonly referralAttribution: ReferralAttributionService,
  ) {}

  // /start: resolve-or-create is entirely delegated to the shared service (same logic Mini
  // App auth uses) — concurrency safety (two rapid /start taps) comes from there, not
  // anything new here. Registration state is derived from Customer.phone, per this phase's
  // explicit instruction not to add a new status field.
  //
  // Phase 14: `startPayload` is the raw text after "/start " (a Telegram deep-link payload). A `ref_<code>` payload records who invited this customer
  // (ReferralAttributionService — attribution only: no reward, no message, never throws). Any other payload, or none, changes nothing: /start behaves
  // exactly as before, so registration, the phone request and Mini App auth are untouched.
  async handleStart(
    profile: TrustedTelegramProfile,
    startPayload?: string,
  ): Promise<{ customer: { id: string; phone: string | null }; isRegistered: boolean; referral: AttributionOutcome }> {
    const { customer } = await this.telegramIdentityService.resolveOrCreateCustomer(profile);
    // Phase 26: TelegramAccount is a unique 1:1 mapping to Customer (both `customerId` and
    // `telegramUserId` are @unique), so a deactivated customer's SAME TelegramAccount row is what
    // resolveOrCreateCustomer finds again here — there is no schema-valid way to give this Telegram
    // identity a second, fresh Customer instead. Reactivation is therefore the only safe option
    // (never silent — logged), done here on /start specifically because that is the concrete
    // "customer tries to register again" moment, not on every unrelated Bot interaction.
    if (!customer.isActive) {
      await this.customersRepository.reactivate(customer.id);
      this.logger.warn(`Reactivated previously-deactivated customer ${customer.id} on /start.`);
    }
    const referral = startPayload ? await this.referralAttribution.attributeFromStart(customer, startPayload) : 'NONE';
    return { customer, isRegistered: Boolean(customer.phone), referral };
  }

  // The mandatory-phone-registration step. senderTelegramUserId is ctx.from.id — the person
  // who actually sent this message to the bot, trusted because it comes from Telegram's own
  // servers via the Bot API (see telegram-bot.service.ts's handler).
  async handleContact(senderTelegramUserId: string, contact: TelegramContact): Promise<ContactHandlingResult> {
    // SECURITY CHECK (explicit requirement): if Telegram tells us whose contact this is,
    // it MUST be the sender's own. A forwarded/shared contact card for someone else is
    // rejected outright — the phone is never saved.
    if (contact.user_id !== undefined && String(contact.user_id) !== senderTelegramUserId) {
      this.logger.warn(
        `Rejected a contact share: sender telegramUserId=${senderTelegramUserId} tried to submit a contact belonging to user_id=${contact.user_id}.`,
      );
      return { ok: false, reason: 'mismatched_owner' };
    }
    if (contact.user_id === undefined) {
      // Documented limitation, not invented verification (per this phase's explicit
      // instruction): Telegram's Bot API does not always populate Contact.user_id. For the
      // native request_contact button — the ONLY way this bot ever asks for a phone — the
      // official semantics are that user_id IS present and equals the sender's own id, so
      // this branch is expected to be rare/theoretical for this bot's own flow. CUP cannot
      // cryptographically verify ownership in this case and accepts the contact as-is,
      // consistent with "do not invent identity verification beyond what Telegram provides."
      this.logger.warn(
        `Contact from telegramUserId=${senderTelegramUserId} had no user_id field — accepting per documented Bot API semantics, ownership not cryptographically verified for this one contact.`,
      );
    }

    const account = await this.telegramAccountsRepository.findByTelegramUserId(senderTelegramUserId);
    if (!account) {
      // Structurally shouldn't happen: a contact message implies /start already ran and
      // created the TelegramAccount first. Defensive, not a normal path.
      throw new Error(`Contact received for telegramUserId=${senderTelegramUserId} with no TelegramAccount on file.`);
    }

    const normalizedPhone = normalizeTelegramPhone(contact.phone_number);
    const customer = await this.customersRepository.updatePhone(account.customer.id, normalizedPhone);
    // Phase 25: best-effort automatic Poster customer link (find-or-create by phone, never blocks or
    // fails registration — see CustomersService.linkToPoster). Telegram module never calls Poster
    // directly; this goes through CustomersService -> PosterClientsService -> PosterService.
    await this.customersService.linkToPoster(customer);
    // Phase 14: registration is complete — a pending referral moves ATTRIBUTED -> REGISTERED (conditional update; a no-op for everyone else, never throws).
    await this.referralAttribution.markRegistered(customer.id);
    return { ok: true, customer };
  }
}
