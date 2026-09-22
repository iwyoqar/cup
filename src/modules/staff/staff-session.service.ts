import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHmac } from 'node:crypto';
import { ConfigService } from '../../common/config/config.service';
import { InvalidStaffSessionError } from './staff-auth.errors';

export type StaffActorKind = 'STAFF' | 'ADMIN';

export interface StaffSessionPayload {
  sub: string; // StaffMember.id or Admin.id, depending on `kind`
  kind: StaffActorKind;
}

const STAFF_AUDIENCE = 'cup-staff';

// Staff tokens are signed with a key that is neither the customer JWT secret nor the admin one, and
// carry their own audience — a customer or admin token fails signature verification against the staff
// guard outright, and a staff token fails against theirs. See STAFF_JWT_SECRET in env.schema.ts.
@Injectable()
export class StaffSessionService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  private signingKey(): string {
    const explicit = this.config.env.STAFF_JWT_SECRET;
    if (explicit) return explicit;
    return createHmac('sha256', this.config.env.ADMIN_JWT_SECRET).update('cup-staff-session-signing-key-v1').digest('hex');
  }

  issue(kind: StaffActorKind, actorId: string): string {
    return this.jwtService.sign({ sub: actorId, kind } satisfies StaffSessionPayload, {
      secret: this.signingKey(),
      audience: STAFF_AUDIENCE,
      expiresIn: this.config.env.STAFF_JWT_EXPIRES_IN_SECONDS,
    });
  }

  verify(token: string): StaffSessionPayload {
    try {
      const payload = this.jwtService.verify<StaffSessionPayload>(token, { secret: this.signingKey(), audience: STAFF_AUDIENCE });
      if (payload.kind !== 'STAFF' && payload.kind !== 'ADMIN') throw new Error('bad kind');
      return payload;
    } catch {
      throw new InvalidStaffSessionError();
    }
  }

  // Also used (with a distinct label) to bind Poster-match choice tokens to one customer.
  deriveLabelledKey(label: string): string {
    return createHmac('sha256', this.signingKey()).update(label).digest('hex');
  }
}
