import { Module } from '@nestjs/common';
import { TelegramAccountsRepository } from './telegram-accounts.repository';
import { TelegramIdentityService } from './telegram-identity.service';

// Shared leaf module: both AuthModule (Mini App) and TelegramModule (Bot, Phase 1.6) import
// this for Customer+TelegramAccount resolution — neither imports the other, avoiding the
// TelegramModule -> AuthModule -> TelegramModule cycle this phase explicitly warns against.
@Module({
  providers: [TelegramAccountsRepository, TelegramIdentityService],
  exports: [TelegramAccountsRepository, TelegramIdentityService],
})
export class TelegramAccountsModule {}
