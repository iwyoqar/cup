import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Bot, Context, InlineKeyboard, Keyboard } from 'grammy';
import { ConfigService } from '../../common/config/config.service';
import { ReferralBotIdentityService } from '../referrals/referral-bot-identity.service';
import { TrustedTelegramProfile } from '../telegram-accounts/telegram-identity.service';
import {
  GENERIC_ERROR_MESSAGE,
  HELP_MESSAGE,
  MINI_APP_NOT_CONFIGURED_MESSAGE,
  OPEN_MINI_APP_BUTTON_TEXT,
  PHONE_REQUEST_MESSAGE,
  REGISTRATION_COMPLETE_MESSAGE,
  SHARE_PHONE_BUTTON_TEXT,
  VIEW_ORDER_BUTTON_TEXT,
  WELCOME_BACK_MESSAGE,
  WRONG_CONTACT_MESSAGE,
} from './telegram-messages';
import { TelegramRegistrationService } from './telegram-registration.service';

// Transport layer only — grammY setup, handler wiring, sending messages/keyboards. All
// business logic (registration state, phone mandatoriness, contact ownership) lives in
// TelegramRegistrationService; handlers here just extract trusted fields from ctx and call
// into it. See this phase's explicit "keep Telegram-specific transport logic separate from
// business logic" requirement.
//
// Auth distinction (important, do not blur): ctx.from/ctx.chat here are trusted because they
// come from Telegram's own servers via the Bot API's long-polling connection — a categorically
// different trust mechanism from Phase 1.3's Mini App initData, which arrives through
// untrusted client JS and requires its own HMAC verification. Never reuse that HMAC flow here;
// never treat Bot ctx.from as if it needed the same verification Mini App initData does.
@Injectable()
export class TelegramBotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramBotService.name);
  private readonly bot: Bot;

  constructor(
    private readonly config: ConfigService,
    private readonly registrationService: TelegramRegistrationService,
    private readonly referralBotIdentity: ReferralBotIdentityService,
  ) {
    // TELEGRAM_BOT_TOKEN is already required and fail-fast validated by ConfigService's own
    // constructor (Phase 1.3) — the app cannot boot without it, and the error it throws names
    // only the missing variable, never a value. Read here, never logged, never printed.
    this.bot = new Bot(this.config.env.TELEGRAM_BOT_TOKEN);
  }

  async onModuleInit(): Promise<void> {
    this.registerHandlers();

    if (this.config.env.NODE_ENV === 'test') {
      // CRITICAL: without this guard, every existing test that boots the full AppModule
      // (e.g. the Phase 0/1.x integration specs) would start REAL long polling against the
      // REAL Telegram Bot API the instant TelegramModule is registered in AppModule. This
      // must never happen — long polling is only started outside the test environment.
      this.logger.log('NODE_ENV=test — Telegram bot handlers registered, polling not started.');
      return;
    }

    this.bot
      .start({
        onStart: (botInfo) => {
          // Phase 14: the bot's own username (public) is what referral deep links are built from — learned here, never hardcoded.
          this.referralBotIdentity.learn(botInfo.username);
          this.logger.log(`Telegram bot started: @${botInfo.username}`);
        },
      })
      .catch((err) => {
        this.logger.error(`Telegram bot polling stopped unexpectedly: ${this.safeMessage(err)}`);
      });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.config.env.NODE_ENV === 'test') {
      return;
    }
    await this.bot.stop();
  }

  private registerHandlers(): void {
    this.bot.command('start', (ctx) => this.handleStartCommand(ctx));
    // Optional, minimal — per this phase's explicit "only if useful, does not expand scope."
    this.bot.command('help', (ctx) => ctx.reply(HELP_MESSAGE));
    this.bot.on('message:contact', (ctx) => this.handleContactMessage(ctx));

    // Last-resort safety net — individual handlers already catch their own errors and reply
    // with a generic message; this only fires for something that slipped past that.
    this.bot.catch((err) => {
      this.logger.error(`Unhandled Telegram bot error: ${this.safeMessage(err.error)}`);
    });
  }

  private async handleStartCommand(ctx: Context): Promise<void> {
    try {
      const profile = this.extractTrustedProfile(ctx);
      if (!profile) {
        return;
      }

      // ctx.match is the deep-link payload after "/start " (e.g. ref_7K4M9X2P). It is passed on untouched and never logged.
      const payload = typeof ctx.match === 'string' ? ctx.match : undefined;
      const { isRegistered } = await this.registrationService.handleStart(profile, payload);

      if (!isRegistered) {
        // Phase 1.6's central rule: the Mini App must never become a registration bypass —
        // an unregistered user's /start leads here, not to the Mini App button.
        await ctx.reply(PHONE_REQUEST_MESSAGE, { reply_markup: this.buildPhoneRequestKeyboard() });
        return;
      }

      await this.sendRegisteredGreeting(ctx, WELCOME_BACK_MESSAGE);
    } catch (err) {
      this.logger.error(`Error handling /start: ${this.safeMessage(err)}`);
      await ctx.reply(GENERIC_ERROR_MESSAGE).catch(() => undefined);
    }
  }

  private async handleContactMessage(ctx: Context): Promise<void> {
    try {
      const from = ctx.from;
      const contact = ctx.message?.contact;
      if (!from || !contact) {
        return;
      }

      const result = await this.registrationService.handleContact(String(from.id), {
        phone_number: contact.phone_number,
        user_id: contact.user_id,
      });

      if (!result.ok) {
        await ctx.reply(WRONG_CONTACT_MESSAGE, { reply_markup: this.buildPhoneRequestKeyboard() });
        return;
      }

      // Two messages, necessarily: Telegram's reply_markup can only be ONE of
      // ReplyKeyboardMarkup / InlineKeyboardMarkup / ReplyKeyboardRemove per message, so
      // clearing the phone-request keyboard and offering the Mini App button can't be
      // combined into a single reply.
      await ctx.reply(REGISTRATION_COMPLETE_MESSAGE, { reply_markup: { remove_keyboard: true } });
      await this.sendRegisteredGreeting(ctx, WELCOME_BACK_MESSAGE);
    } catch (err) {
      this.logger.error(`Error handling contact: ${this.safeMessage(err)}`);
      await ctx.reply(GENERIC_ERROR_MESSAGE).catch(() => undefined);
    }
  }

  // Telegram's server-provided update is the trusted identity source (see this phase's
  // explicit instruction) — never a user id from command text, never username-as-identity.
  private extractTrustedProfile(ctx: Context): TrustedTelegramProfile | null {
    const from = ctx.from;
    const chat = ctx.chat;
    if (!from || !chat) {
      return null;
    }
    return {
      telegramUserId: String(from.id),
      // Phase 1.6: the first REAL verification of chatId, using ctx.chat.id directly rather
      // than blindly preserving Phase 1.3's "chatId == telegramUserId" placeholder assumption
      // — see telegram-identity.service.ts for how this now only overwrites what Mini App
      // auth (which has no chat context at all) had left as a guess.
      chatId: String(chat.id),
      username: from.username ?? null,
      firstName: from.first_name ?? null,
      lastName: from.last_name ?? null,
      languageCode: from.language_code ?? null,
    };
  }

  // Phase 1.9: the ONLY send path order-status notifications use — reuses this same bot
  // instance/long-polling connection (spec section 30), never a second `new Bot(...)`. Callers
  // (OrderNotificationService) never touch grammY directly, matching the existing "transport
  // lives here, business logic lives elsewhere" split this service already follows for
  // registration. Errors are intentionally NOT caught here — the caller (which owns the
  // notification's DB delivery state) decides how to record a failure; swallowing it here
  // would hide that from the retry bookkeeping.
  async sendOrderStatusNotification(chatId: string, message: string): Promise<void> {
    const miniAppUrl = this.config.env.MINI_APP_URL;
    if (!miniAppUrl) {
      await this.bot.api.sendMessage(chatId, message);
      return;
    }
    const keyboard = new InlineKeyboard().webApp(VIEW_ORDER_BUTTON_TEXT, miniAppUrl);
    await this.bot.api.sendMessage(chatId, message, { reply_markup: keyboard });
  }

  // Phase 6: the ONLY send path campaign messaging uses — reuses this exact same bot instance,
  // never a second `new Bot(...)` (same rule as sendOrderStatusNotification above). Plain text
  // only, no keyboard — Phase 6's explicit scope is text-only campaign messages. Errors are
  // intentionally NOT caught here — TelegramMessagingService is the one place that classifies
  // them (permanent vs. rate-limited vs. uncertain), matching this file's existing "transport
  // lives here, decisions live elsewhere" split.
  async sendCampaignMessage(chatId: string, text: string) {
    return this.bot.api.sendMessage(chatId, text);
  }

  private buildPhoneRequestKeyboard(): Keyboard {
    return new Keyboard().requestContact(SHARE_PHONE_BUTTON_TEXT).resized().oneTime();
  }

  // If MINI_APP_URL isn't configured, registration/phone-saving must still fully succeed —
  // this only affects what's offered as the NEXT step, and never crashes or sends an invalid
  // Telegram web_app button URL (Telegram requires a valid HTTPS URL for that button type).
  private async sendRegisteredGreeting(ctx: Context, message: string): Promise<void> {
    const miniAppUrl = this.config.env.MINI_APP_URL;
    if (!miniAppUrl) {
      await ctx.reply(`${message}\n\n${MINI_APP_NOT_CONFIGURED_MESSAGE}`);
      return;
    }
    const keyboard = new InlineKeyboard().webApp(OPEN_MINI_APP_BUTTON_TEXT, miniAppUrl);
    await ctx.reply(message, { reply_markup: keyboard });
  }

  // Never lets a raw error object (which could stringify to include request/response detail)
  // reach a log line unfiltered — just the message, matching this phase's "server-side
  // logging can contain useful diagnostics, but never secrets" instruction. The bot token
  // itself is never part of any grammY error's message (grammY does not echo it back).
  private safeMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
