import { Injectable } from '@nestjs/common';
import { PrismaService, PrismaTransactionClient } from '../../common/prisma/prisma.service';
import { isUniqueConstraintViolation } from '../../common/util/prisma-errors';
import { LoyaltySettingsService, LoyaltySettingsView } from './loyalty-settings.service';
import { LoyaltyRepository } from './loyalty.repository';

export interface LoyaltyAccountView {
  enabled: boolean;
  balance: number;
  lifetimeEarned: number;
  lifetimeSpent: number;
  // Phase 3.1 Part 4: the smallest necessary extension so the Mini App can generate its
  // explanatory earning copy ("Har 1000 so'm xarid uchun 1 ball") FROM this response instead
  // of duplicating the business rule in frontend code. Included regardless of `enabled` — the
  // frontend already hides the whole section when disabled, so this just avoids the response
  // shape changing based on that flag. Never exposes welcomeBonus/pointValue/spendEnabled/
  // minimumOrderAmount/pointsExpireAfterDays here — those aren't needed for this copy, and
  // GET /admin/settings/loyalty remains the only place the full configuration is exposed.
  earnRate: number;
  earnUnitAmount: number;
}

export interface LoyaltyTransactionView {
  id: string;
  type: string;
  points: number;
  balanceAfter: number;
  description: string | null;
  createdAt: string;
}

export interface LoyaltyTransactionPage {
  items: LoyaltyTransactionView[];
  nextCursor: string | null;
}

// Phase 3 Part 8 — IMPORTANT, read before adding a call site: nothing in this service is ever
// invoked automatically from order creation or order-status sync yet, and that is deliberate,
// not an oversight. The currently verified Poster/CUP order lifecycle is only
// pending -> sent_to_poster -> accepted (see common/enums/order-status.ts and
// poster-status-map.ts) — there is no reliable "completed/paid" signal an automatic purchase-
// earning rule could safely trigger on. Awarding points merely for an order being *created* or
// *accepted* would let a later-cancelled/refunded order still pay out — see
// order-status-sync.service.ts's syncOne() for the exact comment marking where this would be
// wired up once such a signal exists. This service only provides the read-side account view,
// the ledger, and the (separately gated, idempotent) welcome bonus grant.
@Injectable()
export class LoyaltyService {
  constructor(
    private readonly repository: LoyaltyRepository,
    private readonly settingsService: LoyaltySettingsService,
    private readonly prisma: PrismaService,
  ) {}

  async getAccountView(customerId: string): Promise<LoyaltyAccountView> {
    const settings = await this.settingsService.get();
    if (!settings.enabled) {
      // Loyalty being off is not the same as "no account" — it means the feature is simply
      // not active for anyone right now. No account is created or touched in this case.
      return {
        enabled: false,
        balance: 0,
        lifetimeEarned: 0,
        lifetimeSpent: 0,
        earnRate: settings.earnRate,
        earnUnitAmount: settings.earnUnitAmount,
      };
    }
    const account = await this.ensureAccount(customerId, settings);
    return {
      enabled: true,
      balance: account.balance,
      lifetimeEarned: account.lifetimeEarned,
      lifetimeSpent: account.lifetimeSpent,
      earnRate: settings.earnRate,
      earnUnitAmount: settings.earnUnitAmount,
    };
  }

  // Phase 4: read-only snapshot for Admin Customer 360 — deliberately does NOT call
  // ensureAccount(). Unlike getAccountView (the customer-facing path), viewing a customer's
  // admin profile must never have side effects: no lazy account creation, no welcome bonus
  // grant, just for an admin looking at a profile. Returns null if the customer has never
  // triggered account creation themselves (i.e., never opened Loyalty while it was enabled).
  async getAccountSnapshot(customerId: string): Promise<{ balance: number; lifetimeEarned: number; lifetimeSpent: number } | null> {
    const account = await this.repository.findAccountByCustomerId(customerId);
    if (!account) {
      return null;
    }
    return { balance: account.balance, lifetimeEarned: account.lifetimeEarned, lifetimeSpent: account.lifetimeSpent };
  }

  // Phase 5: bulk version of getAccountSnapshot for segment evaluation — same read-only
  // contract (no lazy account creation, no welcome bonus, no mutation of any kind), just for
  // many customers in one query instead of one. A customer with no LoyaltyAccount row simply
  // gets no entry in the returned map; callers default missing entries to zero (see
  // segments.service.ts), never treat "no account yet" as an error.
  async getAccountSnapshotsForCustomers(
    customerIds: string[],
  ): Promise<Map<string, { balance: number; lifetimeEarned: number; lifetimeSpent: number }>> {
    if (customerIds.length === 0) {
      return new Map();
    }
    const accounts = await this.repository.findAccountsByCustomerIds(customerIds);
    return new Map(
      accounts.map((account) => [
        account.customerId,
        { balance: account.balance, lifetimeEarned: account.lifetimeEarned, lifetimeSpent: account.lifetimeSpent },
      ]),
    );
  }

  // Phase 7: the ONE credit path a promotion's LOYALTY_POINTS benefit uses — reused rather than
  // a second loyalty transaction mechanism (spec's explicit instruction). Deliberately does NOT
  // check settings.enabled or call ensureAccount's welcome-bonus logic: a promotion awarding
  // points is a distinct, admin-authored event from the ambient purchase-earning program, and
  // must not be gated by whether that separate program happens to be toggled on. If the
  // customer has no LoyaltyAccount yet, one is created here with a zero starting balance (no
  // welcome bonus — that grant belongs solely to ensureAccount's own first-loyalty-view path,
  // never duplicated here). Known limitation: this performs a create/increment write and a
  // ledger-row write as two sequential operations, not one cross-service transaction — see
  // promotion-redemption.service.ts's comment on the same tradeoff.
  async creditPoints(customerId: string, points: number, options: { description?: string; orderId?: string | null } = {}): Promise<void> {
    const account = await this.getOrCreateBareAccount(customerId);
    await this.prisma.runTransaction(async (tx) => {
      const updated = await this.repository.incrementBalance(tx, account.id, points);
      await this.repository.createTransaction(tx, {
        loyaltyAccountId: account.id,
        type: 'EARN',
        points,
        balanceAfter: updated.balance,
        orderId: options.orderId ?? null,
        description: options.description ?? null,
      });
    });
  }

  // Phase 12: the identical ledger write as creditPoints, but INSIDE a caller-owned transaction so Loyalty 2.0 can make "this
  // purchase/achievement was processed" and "these points were credited" commit or roll back together. Same EARN ledger
  // row, same lifetimeEarned accounting; no settings gate, no welcome bonus (see creditPoints).
  async creditPointsTx(tx: PrismaTransactionClient, customerId: string, points: number, options: { description?: string; orderId?: string | null } = {}): Promise<string> {
    const account = (await this.repository.findAccountByCustomerIdTx(tx, customerId)) ?? (await this.repository.createAccount(tx, customerId, 0));
    const updated = await this.repository.incrementBalance(tx, account.id, points);
    const row = await this.repository.createTransaction(tx, {
      loyaltyAccountId: account.id,
      type: 'EARN',
      points,
      balanceAfter: updated.balance,
      orderId: options.orderId ?? null,
      description: options.description ?? null,
    });
    return row.id; // Phase 14: lets a caller keep a durable pointer from its own record to the ledger row it caused
  }

  // Same "read, try create, re-read the race winner on a unique-constraint conflict" pattern as
  // ensureAccount, but with welcomeBonus fixed at 0 — this path is never the customer's first
  // loyalty-program touchpoint by definition (see creditPoints's comment).
  private async getOrCreateBareAccount(customerId: string) {
    const existing = await this.repository.findAccountByCustomerId(customerId);
    if (existing) {
      return existing;
    }
    try {
      return await this.prisma.runTransaction((tx) => this.repository.createAccount(tx, customerId, 0));
    } catch (err) {
      if (isUniqueConstraintViolation(err)) {
        const raceWinner = await this.repository.findAccountByCustomerId(customerId);
        if (raceWinner) {
          return raceWinner;
        }
      }
      throw err;
    }
  }

  async listTransactions(customerId: string, options: { cursor?: string; limit: number }): Promise<LoyaltyTransactionPage> {
    const account = await this.repository.findAccountByCustomerId(customerId);
    if (!account) {
      return { items: [], nextCursor: null };
    }
    const rows = await this.repository.findTransactionsByAccount(account.id, {
      cursor: options.cursor,
      take: options.limit + 1,
    });
    const hasMore = rows.length > options.limit;
    const pageRows = hasMore ? rows.slice(0, options.limit) : rows;
    return {
      items: pageRows.map((row) => ({
        id: row.id,
        type: row.type,
        points: row.points,
        balanceAfter: row.balanceAfter,
        description: row.description,
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor: hasMore ? pageRows[pageRows.length - 1].id : null,
    };
  }

  // Phase 3 Part 9: lazy creation + at-most-once welcome bonus. Concurrency safety comes from
  // LoyaltyAccount.customerId's own unique constraint — the exact same "read, try create,
  // re-read the race winner on a unique-constraint conflict" pattern already established for
  // Cart (CartService.getOrCreateCart) and TelegramAccount
  // (resolveOrCreateTelegramCustomer): two simultaneous requests (repeated Mini App opens,
  // concurrent API calls) cannot both create an account for the same customer, so they cannot
  // both grant a welcome bonus either — whichever loses the race just re-reads the winner's row.
  private async ensureAccount(customerId: string, settings: LoyaltySettingsView) {
    const existing = await this.repository.findAccountByCustomerId(customerId);
    if (existing) {
      return existing;
    }
    const welcomeBonus = settings.welcomeBonus > 0 ? settings.welcomeBonus : 0;
    try {
      return await this.prisma.runTransaction(async (tx) => {
        const account = await this.repository.createAccount(tx, customerId, welcomeBonus);
        if (welcomeBonus > 0) {
          await this.repository.createTransaction(tx, {
            loyaltyAccountId: account.id,
            type: 'WELCOME_BONUS',
            points: welcomeBonus,
            balanceAfter: welcomeBonus,
            description: 'Welcome bonus',
          });
        }
        return account;
      });
    } catch (err) {
      if (isUniqueConstraintViolation(err)) {
        const raceWinner = await this.repository.findAccountByCustomerId(customerId);
        if (raceWinner) {
          return raceWinner;
        }
      }
      throw err;
    }
  }
}
