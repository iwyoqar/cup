import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthGuard } from './admin-auth.guard';
import { AdminAuthService } from './admin-auth.service';
import { AdminSessionService } from './admin-session.service';
import { AdminsRepository } from './admins.repository';

// Deliberately its own independent JwtModule.register({}) — NOT shared with the customer
// AuthModule. Part 1/15 require customer and admin authentication to be completely separate;
// using a second, independent JwtService instance (all secret/expiry values passed explicitly
// per-call, see admin-session.service.ts, so no shared config is needed anyway) reinforces that
// separation structurally rather than just by convention.
@Module({
  imports: [JwtModule.register({})],
  controllers: [AdminAuthController],
  providers: [AdminsRepository, AdminSessionService, AdminAuthService, AdminAuthGuard],
  exports: [AdminAuthGuard, AdminSessionService, AdminsRepository],
})
export class AdminAuthModule {}
