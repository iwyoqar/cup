import { Injectable } from '@nestjs/common';
import { isUniqueConstraintViolation } from '../../common/util/prisma-errors';
import { TelegramAccountsRepository } from './telegram-accounts.repository';

// The trusted profile fields common to BOTH identity sources CUP has: Mini App initData
// (HMAC-verified, no real chat context) and the Telegram Bot (ctx.from/ctx.chat, trusted
// because it comes from Telegram's own servers via the Bot API). Callers are responsible for
// having already established trust — this service does no verification of its own.
export interface TrustedTelegramProfile {
  telegramUserId: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  languageCode: string | null;
  // Only the Bot has a genuine chat id (ctx.chat.id). Mini App auth has no chat context at
  // all and must NOT pass a guessed value here on every call, or it will overwrite a real
  // chatId the Bot already recorded. Omit entirely when the caller has no authoritative value.
  chatId?: string;
}

// Plain function, not a class method: this lets AuthService (Phase 1.3, whose constructor
// signature must stay stable for its existing test suite — see the Phase 1.5 lesson about
// breaking constructor arity) call it directly with its own already-injected
// TelegramAccountsRepository, without taking on a brand-new constructor dependency.
// TelegramIdentityService below gives the Bot (Phase 1.6, a new consumer with no such
// constraint) a normal injectable wrapper around this exact same function. Zero duplication
// either way — both paths execute this one function body, satisfying "do not duplicate
// existing Customer or TelegramAccount logic."
//
// Concurrency: read-then-create, with the database's unique constraint on
// TelegramAccount.telegramUserId as the final word if two requests for the same brand-new
// Telegram user race each other (e.g. a user tapping /start twice quickly). Whoever loses the
// race re-reads the winner's row rather than erroring or creating a second Customer.
export async function resolveOrCreateTelegramCustomer(
  telegramAccountsRepository: TelegramAccountsRepository,
  profile: TrustedTelegramProfile,
) {
  const existing = await telegramAccountsRepository.findByTelegramUserId(profile.telegramUserId);
  if (existing) {
    const telegramAccount = await telegramAccountsRepository.updateProfile(profile.telegramUserId, {
      username: profile.username,
      firstName: profile.firstName,
      lastName: profile.lastName,
      languageCode: profile.languageCode,
      ...(profile.chatId !== undefined ? { chatId: profile.chatId } : {}),
    });
    return { customer: existing.customer, telegramAccount };
  }

  try {
    return await telegramAccountsRepository.createWithCustomer({
      telegramUserId: profile.telegramUserId,
      // A brand-new record needs SOME chatId (NOT NULL column) even if this particular caller
      // has no authoritative one (Mini App auth, reached before the user ever used the Bot) —
      // telegramUserId is the same documented "private chat id == user id" placeholder Phase
      // 1.3 already used, corrected to a real value the next time the Bot records ctx.chat.id.
      chatId: profile.chatId ?? profile.telegramUserId,
      username: profile.username,
      firstName: profile.firstName,
      lastName: profile.lastName,
      languageCode: profile.languageCode,
      displayName: buildDisplayName(profile),
    });
  } catch (err) {
    if (isUniqueConstraintViolation(err)) {
      const raceWinner = await telegramAccountsRepository.findByTelegramUserId(profile.telegramUserId);
      if (raceWinner) {
        return raceWinner;
      }
    }
    throw err;
  }
}

function buildDisplayName(profile: TrustedTelegramProfile): string | null {
  const nameParts = [profile.firstName, profile.lastName].filter((part): part is string => Boolean(part));
  if (nameParts.length > 0) {
    return nameParts.join(' ');
  }
  return profile.username ?? null;
}

// Thin injectable wrapper for consumers that want normal NestJS DI (the Bot, Phase 1.6) —
// AuthService instead calls resolveOrCreateTelegramCustomer directly, see above.
@Injectable()
export class TelegramIdentityService {
  constructor(private readonly telegramAccountsRepository: TelegramAccountsRepository) {}

  resolveOrCreateCustomer(profile: TrustedTelegramProfile) {
    return resolveOrCreateTelegramCustomer(this.telegramAccountsRepository, profile);
  }
}
