import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '../../common/config/config.service';
import { InvalidAdminSessionError } from './admin-auth.errors';

export interface AdminSessionPayload {
  sub: string; // adminId — the only identity claim.
  role: string;
}

// Signed with ADMIN_JWT_SECRET — deliberately distinct key material from the customer-facing
// JWT_SECRET (see session.service.ts) and from TELEGRAM_BOT_TOKEN/POSTER_API_TOKEN. A customer
// session token fails signature verification outright against this service, and an admin token
// fails outright against the customer SessionService — structural separation, not a claim-based
// check that something could bypass. Never logs the token or the secret.
@Injectable()
export class AdminSessionService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  issue(adminId: string, role: string): string {
    return this.jwtService.sign(
      { sub: adminId, role } satisfies AdminSessionPayload,
      { secret: this.config.env.ADMIN_JWT_SECRET, expiresIn: this.config.env.ADMIN_JWT_EXPIRES_IN_SECONDS },
    );
  }

  verify(token: string): AdminSessionPayload {
    try {
      return this.jwtService.verify<AdminSessionPayload>(token, { secret: this.config.env.ADMIN_JWT_SECRET });
    } catch {
      throw new InvalidAdminSessionError();
    }
  }
}
