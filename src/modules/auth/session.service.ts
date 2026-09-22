import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '../../common/config/config.service';
import { InvalidSessionError } from './auth.errors';

export interface SessionPayload {
  sub: string; // customerId — the only identity claim. No phone or other sensitive data.
}

// CUP's own session token, issued only after Telegram initData has been verified (see
// telegram-init-data.ts). Signed with JWT_SECRET — deliberately distinct key material from
// TELEGRAM_BOT_TOKEN and POSTER_API_TOKEN. Never logs the token or the secret.
@Injectable()
export class SessionService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  issue(customerId: string): string {
    return this.jwtService.sign(
      { sub: customerId } satisfies SessionPayload,
      { secret: this.config.env.JWT_SECRET, expiresIn: this.config.env.JWT_EXPIRES_IN_SECONDS },
    );
  }

  verify(token: string): SessionPayload {
    try {
      return this.jwtService.verify<SessionPayload>(token, { secret: this.config.env.JWT_SECRET });
    } catch {
      throw new InvalidSessionError();
    }
  }
}
