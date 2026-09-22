import { Injectable } from '@nestjs/common';
import { Db, PrismaService } from '../../common/prisma/prisma.service';
import { LoyaltyTransactionType } from '../../common/enums/loyalty-transaction-type';

export interface CreateLoyaltyTransactionData {
  loyaltyAccountId: string;
  type: LoyaltyTransactionType;
  points: number;
  balanceAfter: number;
  orderId?: string | null;
  description?: string | null;
}

@Injectable()
export class LoyaltyRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAccountByCustomerId(customerId: string) {
    return this.prisma.loyaltyAccount.findUnique({ where: { customerId } });
  }

  // Phase 12: same read, through a caller-supplied transaction client.
  findAccountByCustomerIdTx(db: Db, customerId: string) {
    return db.loyaltyAccount.findUnique({ where: { customerId } });
  }

  // Phase 5: bulk read for segment evaluation — one query for many customers, never a
  // per-customer loop. Purely a read; never creates accounts (see LoyaltyService.
  // getAccountSnapshotsForCustomers for why that matters).
  findAccountsByCustomerIds(customerIds: string[]) {
    return this.prisma.loyaltyAccount.findMany({ where: { customerId: { in: customerIds } } });
  }

  // welcomeBonus is the ONLY way a brand-new account can start with a non-zero balance — see
  // LoyaltyService.ensureAccount, which creates the matching WELCOME_BONUS ledger row in the
  // same transaction as this call.
  createAccount(db: Db, customerId: string, welcomeBonus: number) {
    return db.loyaltyAccount.create({
      data: { customerId, balance: welcomeBonus, lifetimeEarned: welcomeBonus },
    });
  }

  createTransaction(db: Db, data: CreateLoyaltyTransactionData) {
    return db.loyaltyTransaction.create({ data });
  }

  // Phase 7: the write side of LoyaltyService.creditPoints (promotion LOYALTY_POINTS benefit).
  // lifetimeEarned moves with balance here — same accounting as a purchase-earned point, never
  // a separate ledger dimension.
  incrementBalance(db: Db, accountId: string, points: number) {
    return db.loyaltyAccount.update({
      where: { id: accountId },
      data: { balance: { increment: points }, lifetimeEarned: { increment: points } },
    });
  }

  findTransactionsByAccount(accountId: string, options: { cursor?: string; take: number }) {
    return this.prisma.loyaltyTransaction.findMany({
      where: { loyaltyAccountId: accountId },
      orderBy: { createdAt: 'desc' },
      take: options.take,
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    });
  }
}
