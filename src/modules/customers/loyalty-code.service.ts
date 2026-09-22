import { Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { CustomersRepository } from './customers.repository';
import { generateLoyaltyCode, isLoyaltyCodeCollision, LOYALTY_CODE_MAX_ATTEMPTS } from './loyalty-code';

// Issues, backfills and (explicitly) regenerates the public customer identity code. This service
// only manages the CODE — it never touches loyalty balances, reward progress or orders.
@Injectable()
export class LoyaltyCodeService implements OnApplicationBootstrap {
  private readonly logger = new Logger(LoyaltyCodeService.name);

  constructor(private readonly customersRepository: CustomersRepository) {}

  // Existing customers (created before Phase 11) receive a code safely at startup. Idempotent:
  // customers that already have one are not selected, so restarts and concurrent instances are harmless.
  async onApplicationBootstrap(): Promise<void> {
    try {
      const issued = await this.backfillMissing();
      if (issued > 0) this.logger.log(`Issued a public identity code to ${issued} existing customer(s).`);
    } catch (err) {
      // Never block startup on this: lookups also issue codes lazily (ensureForCustomer).
      this.logger.error(`Identity code backfill failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async backfillMissing(): Promise<number> {
    const missing = await this.customersRepository.findIdsWithoutLoyaltyCode();
    let issued = 0;
    for (const { id } of missing) {
      await this.ensureForCustomer(id);
      issued += 1;
    }
    return issued;
  }

  // Returns the customer's code, issuing one first if they have none. Safe under races and collisions.
  async ensureForCustomer(customerId: string): Promise<string> {
    const existing = await this.customersRepository.findLoyaltyCodeById(customerId);
    if (!existing) throw new NotFoundException('Customer not found.');
    if (existing.loyaltyCode) return existing.loyaltyCode;

    for (let attempt = 1; attempt <= LOYALTY_CODE_MAX_ATTEMPTS; attempt += 1) {
      const candidate = generateLoyaltyCode();
      try {
        const set = await this.customersRepository.setLoyaltyCodeIfMissing(customerId, candidate);
        if (set) return candidate;
        // Someone else issued a code between our read and write — use theirs.
        const winner = await this.customersRepository.findLoyaltyCodeById(customerId);
        if (winner?.loyaltyCode) return winner.loyaltyCode;
      } catch (err) {
        if (!isLoyaltyCodeCollision(err)) throw err;
      }
    }
    throw new Error('Could not issue a unique customer identity code.');
  }

  // Explicit, admin-triggered replacement. The old code stops resolving immediately (the unique
  // column now holds the new value). Callers are responsible for confirmation + audit.
  async regenerate(customerId: string): Promise<string> {
    const existing = await this.customersRepository.findLoyaltyCodeById(customerId);
    if (!existing) throw new NotFoundException('Customer not found.');
    for (let attempt = 1; attempt <= LOYALTY_CODE_MAX_ATTEMPTS; attempt += 1) {
      const candidate = generateLoyaltyCode();
      try {
        await this.customersRepository.setLoyaltyCode(customerId, candidate);
        return candidate;
      } catch (err) {
        if (!isLoyaltyCodeCollision(err)) throw err;
      }
    }
    throw new Error('Could not issue a unique customer identity code.');
  }
}
