import { UnauthorizedException } from '@nestjs/common';

// Thin, explicit domain errors — same pattern as auth.errors.ts (customer side). Messages are
// deliberately generic and never distinguish "no such email" from "wrong password", nor echo
// any internal validation detail.

export class InvalidAdminSessionError extends UnauthorizedException {
  constructor(reason = 'Invalid or expired admin session.') {
    super(reason);
  }
}

export class InvalidAdminCredentialsError extends UnauthorizedException {
  constructor() {
    super('Invalid email or password.');
  }
}

export class AdminInactiveError extends UnauthorizedException {
  constructor() {
    super('This admin account is inactive.');
  }
}
