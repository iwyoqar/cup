import { forwardRef, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TelegramAccountsModule } from '../telegram-accounts/telegram-accounts.module';
import { CustomersController } from './customers.controller';
import { CustomersRepository } from './customers.repository';
import { CustomersService } from './customers.service';
import { LoyaltyCodeService } from './loyalty-code.service';

// Phase 2: TelegramAccountsModule imported for CustomersService's profile view (needs
// TelegramAccountsRepository for username) — no cycle there, TelegramAccountsModule has no
// imports of its own.
//
// AuthModule is a genuine circular dependency, not a lazy shortcut: AuthModule already imports
// CustomersModule (for CustomersRepository, used by AuthService), and CustomersController now
// needs AuthGuard (and transitively SessionService) from AuthModule for its own `GET
// /customers/me` route — the exact same "AuthGuard's dependencies are resolved against the
// REQUESTING module's context" issue CartModule hit in Phase 1.6, except CartModule wasn't
// itself a dependency of AuthModule, so a plain import was enough there. Here it genuinely
// isn't — forwardRef() on both sides (see auth.module.ts) is Nest's documented mechanism for
// exactly this mutual-dependency shape.
@Module({
  imports: [TelegramAccountsModule, forwardRef(() => AuthModule)],
  controllers: [CustomersController],
  providers: [CustomersRepository, CustomersService, LoyaltyCodeService],
  exports: [CustomersRepository, LoyaltyCodeService],
})
export class CustomersModule {}
