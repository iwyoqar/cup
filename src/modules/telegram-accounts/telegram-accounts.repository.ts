import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { generateLoyaltyCode, isLoyaltyCodeCollision, LOYALTY_CODE_MAX_ATTEMPTS } from '../customers/loyalty-code';

// Moved here from src/modules/auth/ during Phase 1.6: this is shared between Mini App auth
// (AuthService, HMAC-verified initData identity) and the Telegram Bot (TelegramIdentityService,
// trusted Bot API update identity) — neither module should depend on the other to reach it.
// See docs/PHASE-1-DESIGN.md section 12 / this phase's explicit "avoid TelegramModule ->
// AuthModule -> TelegramModule" instruction.

export interface TelegramProfileData {
  telegramUserId: string;
  chatId: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  languageCode: string | null;
}

export interface CreateTelegramAccountData extends TelegramProfileData {
  displayName: string | null;
}

// chatId is OPTIONAL on update: only the Bot has an authoritative ctx.chat.id (Phase 1.6).
// Mini App auth has no real chat context and must not clobber a real chatId the Bot already
// recorded with its own "chatId == telegramUserId" placeholder guess — see
// telegram-identity.service.ts.
export type UpdateTelegramProfileData = Omit<TelegramProfileData, 'telegramUserId' | 'chatId'> & { chatId?: string };

@Injectable()
export class TelegramAccountsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByTelegramUserId(telegramUserId: string) {
    const row = await this.prisma.telegramAccount.findUnique({
      where: { telegramUserId },
      include: { customer: true },
    });
    if (!row) return null;
    const { customer, ...telegramAccount } = row;
    return { customer, telegramAccount };
  }

  findByCustomerId(customerId: string) {
    return this.prisma.telegramAccount.findUnique({ where: { customerId } });
  }

  // Phase 6: bulk Telegram-eligibility resolution for campaign audiences — one query for many
  // customers, never a per-customer loop, same bulk-lookup pattern as LoyaltyRepository.
  // findAccountsByCustomerIds. A customer with no row here has no usable Telegram destination
  // (see CampaignAudienceService).
  findByCustomerIds(customerIds: string[]) {
    return this.prisma.telegramAccount.findMany({ where: { customerId: { in: customerIds } } });
  }

  // Customer + TelegramAccount created together via one nested Prisma write, which Prisma
  // wraps in an implicit transaction — no explicit $transaction needed for this atomicity.
  async createWithCustomer(data: CreateTelegramAccountData) {
    // Phase 11: the public identity code is issued in the same write. Only a collision on that code is
    // retried here; a telegramUserId race still surfaces to resolveOrCreateTelegramCustomer as before.
    let created;
    for (let attempt = 1; ; attempt += 1) {
      try {
        created = await this.createOnce(data);
        break;
      } catch (err) {
        if (isLoyaltyCodeCollision(err) && attempt < LOYALTY_CODE_MAX_ATTEMPTS) continue;
        throw err;
      }
    }
    const { telegramAccount, ...customer } = created;
    // telegramAccount is guaranteed non-null: we just created it in the same nested write.
    return { customer, telegramAccount: telegramAccount! };
  }

  private createOnce(data: CreateTelegramAccountData) {
    return this.prisma.customer.create({
      data: {
        loyaltyCode: generateLoyaltyCode(),
        displayName: data.displayName,
        telegramAccount: {
          create: {
            telegramUserId: data.telegramUserId,
            chatId: data.chatId,
            username: data.username,
            firstName: data.firstName,
            lastName: data.lastName,
            languageCode: data.languageCode,
          },
        },
      },
      include: { telegramAccount: true },
    });
  }

  updateProfile(telegramUserId: string, data: UpdateTelegramProfileData) {
    return this.prisma.telegramAccount.update({ where: { telegramUserId }, data });
  }
}
