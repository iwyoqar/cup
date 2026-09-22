import { Injectable, Logger } from '@nestjs/common';
import { isUniqueConstraintViolation } from '../../common/util/prisma-errors';
import { Loyalty2Repository } from '../loyalty2/loyalty2.repository';
import { parseStartPayload } from './referral-code';
import { ReferralSettingsService } from './referral-settings.service';
import { AttributionOutcome } from './referral.types';
import { ReferralsRepository } from './referrals.repository';

// Phase 14 — /start ref_<code> attribution. It stores WHO invited this customer, nothing else: no reward, no message, no Poster call. Attribution is
// FIRST-VALID-WINS and is protected by the database (Referral.referredCustomerId is unique), so a repeated /start, a second code or a concurrent
// attempt can never change or duplicate it. Every rule is deterministic and explainable; nothing is inferred from IP or device data.
//
// A row is written ONLY for a valid attribution. A rejected attempt (bad code, self-referral, customer already bought, ...) writes nothing.
@Injectable()
export class ReferralAttributionService {
  private readonly logger = new Logger(ReferralAttributionService.name);

  constructor(
    private readonly repository: ReferralsRepository,
    private readonly settings: ReferralSettingsService,
    private readonly purchases: Loyalty2Repository,
  ) {}

  // `payload` is the raw text after "/start ". Never throws: a problem here must never break registration or the phone request.
  async attributeFromStart(customer: { id: string; phone: string | null }, payload: unknown): Promise<AttributionOutcome> {
    const parsed = parseStartPayload(payload);
    if (parsed.kind === 'NONE') return 'NONE';
    try {
      const outcome = await this.attribute(customer, parsed.code);
      // Outcome only — never the code, the customer, the payload or any Telegram identifier.
      this.logger.log(`Referral /start outcome=${outcome}`);
      return outcome;
    } catch (err) {
      this.logger.error(`Referral attribution failed: ${err instanceof Error ? err.message : String(err)}`);
      return 'NONE';
    }
  }

  private async attribute(customer: { id: string; phone: string | null }, code: string | null): Promise<AttributionOutcome> {
    if (!(await this.settings.isEnabled())) return 'DISABLED';
    if (!code) return 'INVALID_CODE';

    const owner = await this.repository.findCodeOwner(code);
    if (!owner) return 'INVALID_CODE';
    if (owner.customerId === customer.id) return 'SELF_REFERRAL';

    // First valid attribution wins — including repeated /start with the same or a different code.
    if (await this.repository.findByReferred(customer.id)) return 'ALREADY_ATTRIBUTED';

    // Only a customer who has not bought anything yet can be "referred": a prior qualifying purchase (CUP or imported POS) means they are not new,
    // and rewards are never retroactive.
    if ((await this.purchases.purchaseTotals(customer.id)).count > 0) return 'ALREADY_PURCHASED';

    // A -> B while B -> A already exists would let two accounts reward each other.
    if (await this.repository.existsReferral(customer.id, owner.customerId)) return 'CIRCULAR';

    const now = new Date();
    const registered = Boolean(customer.phone);
    try {
      await this.repository.createReferral({
        referrerCustomerId: owner.customerId,
        referredCustomerId: customer.id,
        status: registered ? 'REGISTERED' : 'ATTRIBUTED',
        referralCode: code,
        attributedAt: now,
        registeredAt: registered ? now : null,
      });
      return 'ATTRIBUTED';
    } catch (err) {
      // Lost a race for the same friend (two /start at once, or two different codes): the winner's row stands.
      if (isUniqueConstraintViolation(err)) return 'ALREADY_ATTRIBUTED';
      throw err;
    }
  }

  // Called when a customer's phone has just been saved (registration complete): ATTRIBUTED -> REGISTERED. Conditional update — a no-op for anyone
  // without an attribution and for every other status. Never throws.
  async markRegistered(customerId: string): Promise<void> {
    try {
      await this.repository.markRegistered(customerId, new Date());
    } catch (err) {
      this.logger.error(`Referral markRegistered failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
