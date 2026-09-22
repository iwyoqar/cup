import { Injectable } from '@nestjs/common';
import { GrammyError } from 'grammy';
import { TelegramBotService } from './telegram-bot.service';

// Phase 6: the Telegram-specific sending abstraction — normalizes grammY's error taxonomy into
// three outcomes CampaignMessagingService can act on WITHOUT knowing anything about grammY
// itself. Deliberately knows nothing about campaigns/recipients/customers — it only ever sees a
// chatId and text, same separation TelegramBotService already keeps from
// TelegramRegistrationService.
export type TelegramSendResult =
  | { outcome: 'sent'; telegramMessageId: string }
  // A definite, permanent failure — Telegram's API responded and rejected the request (e.g. bot
  // blocked, chat not found). Safe to mark the recipient 'failed' outright; retrying would not
  // help.
  | { outcome: 'failed'; errorCode: string }
  // Telegram's API responded with 429 — a definite non-delivery, but potentially retryable
  // after waiting. retryAfterSeconds comes from Telegram's own response when available.
  | { outcome: 'rate_limited'; errorCode: string; retryAfterSeconds: number | null }
  // The request may or may not have reached Telegram (network/timeout failure before any
  // response). NEVER auto-retried by this service's caller — see campaign-messaging.service.ts.
  | { outcome: 'uncertain'; errorCode: string };

@Injectable()
export class TelegramMessagingService {
  constructor(private readonly telegramBotService: TelegramBotService) {}

  async sendText(chatId: string, text: string): Promise<TelegramSendResult> {
    try {
      const message = await this.telegramBotService.sendCampaignMessage(chatId, text);
      return { outcome: 'sent', telegramMessageId: String(message.message_id) };
    } catch (err) {
      return this.classify(err);
    }
  }

  // grammY throws GrammyError for a definite API-level response (Telegram received the request
  // and rejected it) — the error_code is Telegram's own HTTP-style status. Anything else
  // (network failure, timeout, DNS failure — grammY's HttpError or any other thrown value) means
  // we never got a definite response at all, which is the "uncertain" case: the message may or
  // may not have actually been delivered.
  private classify(err: unknown): TelegramSendResult {
    if (err instanceof GrammyError) {
      if (err.error_code === 429) {
        const retryAfterSeconds = typeof err.parameters?.retry_after === 'number' ? err.parameters.retry_after : null;
        return { outcome: 'rate_limited', errorCode: 'telegram_429_rate_limited', retryAfterSeconds };
      }
      return { outcome: 'failed', errorCode: `telegram_${err.error_code}` };
    }
    return { outcome: 'uncertain', errorCode: 'uncertain_transport_error' };
  }
}
