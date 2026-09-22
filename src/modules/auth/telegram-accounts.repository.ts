// Compatibility re-export ONLY. The real implementation moved to
// ../telegram-accounts/telegram-accounts.repository.ts during Phase 1.6 so both AuthModule
// (Mini App) and TelegramModule (Bot) can share it without one depending on the other.
// Kept here solely because test/unit/auth.service.spec.ts imports from this exact path, and
// per explicit project instruction, existing tests are not to be modified. Do not add any new
// logic to this file — it is a pure re-export.
export * from '../telegram-accounts/telegram-accounts.repository';
