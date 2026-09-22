import { Injectable } from '@nestjs/common';
import { ConfigService } from '../../common/config/config.service';

// The bot's public username, used only to build https://t.me/<bot>?start=ref_<code>. Never hardcoded: the optional TELEGRAM_BOT_USERNAME override wins,
// otherwise the username the bot itself reports when it starts polling is pushed here by TelegramBotService (push, not pull: this module must not
// depend on TelegramModule, which depends on it for /start attribution). No Telegram API call is made from here.
@Injectable()
export class ReferralBotIdentityService {
  private learned: string | null = null;

  constructor(private readonly config: ConfigService) {}

  learn(username: string | null | undefined): void {
    if (username && /^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(username)) this.learned = username;
  }

  username(): string | null {
    return this.config.env.TELEGRAM_BOT_USERNAME ?? this.learned;
  }
}
