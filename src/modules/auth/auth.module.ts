import { forwardRef, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { CustomersModule } from '../customers/customers.module';
import { TelegramAccountsModule } from '../telegram-accounts/telegram-accounts.module';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';

// Deliberately does NOT import or depend on anything Telegram-Bot-specific (grammY, webhook,
// polling) — those belong to Phase 1.6's TelegramModule. This module only verifies Mini App
// initData and issues/validates CUP's own session tokens. Secret/expiry values are passed
// explicitly on every JwtService call (see SessionService), so JwtModule.register({}) needs
// no options. TelegramAccountsRepository/TelegramIdentityService now live in the shared
// TelegramAccountsModule (moved during Phase 1.6) so TelegramModule can reuse the exact same
// Customer+TelegramAccount logic without depending on AuthModule at all.
@Module({
  // Phase 2: forwardRef() here pairs with CustomersModule's forwardRef(() => AuthModule) — see
  // its comment for why this mutual dependency is genuine, not solvable by reordering.
  imports: [forwardRef(() => CustomersModule), TelegramAccountsModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, SessionService, AuthGuard],
  exports: [AuthGuard, SessionService],
})
export class AuthModule {}
