import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module';
import { ReferralsModule } from '../referrals/referrals.module';
import { TelegramAccountsModule } from '../telegram-accounts/telegram-accounts.module';
import { TelegramBotService } from './telegram-bot.service';
import { TelegramMessagingService } from './telegram-messaging.service';
import { TelegramRegistrationService } from './telegram-registration.service';

// Deliberately does NOT import AuthModule (and does not use AuthGuard/@CurrentCustomer at
// all) — this phase's explicit architectural rule. Bot handlers trust ctx.from/ctx.chat
// directly; AuthGuard is an HTTP-only concept for the Mini App. Both TelegramModule and
// AuthModule instead import the shared TelegramAccountsModule independently, so neither
// depends on the other — see telegram-accounts.module.ts.
// Phase 1.9: exports TelegramBotService so NotificationsModule can send order-status messages
// through this exact same bot instance (never a second grammY Bot — see telegram-bot.service.ts)
// without NotificationsModule needing to depend on TelegramRegistrationService/CustomersModule
// at all.
// Phase 6: also exports TelegramMessagingService (built on TelegramBotService) so CampaignsModule
// can send campaign messages through the same bot instance/polling session, without depending on
// TelegramRegistrationService/CustomersModule either.
@Module({
  // Phase 14: ReferralsModule provides /start ref_<code> attribution and receives the bot username (it never imports this module back).
  imports: [TelegramAccountsModule, CustomersModule, ReferralsModule],
  providers: [TelegramBotService, TelegramRegistrationService, TelegramMessagingService],
  exports: [TelegramBotService, TelegramMessagingService],
})
export class TelegramModule {}
