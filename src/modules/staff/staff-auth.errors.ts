import { ForbiddenException, HttpException, HttpStatus, UnauthorizedException } from '@nestjs/common';

// Generic on purpose: never distinguishes "no such account" from "wrong password" (same rule as the
// admin login), and never echoes internal detail.
export class InvalidStaffCredentialsError extends UnauthorizedException {
  constructor() {
    super('Invalid username or password.');
  }
}

export class InvalidStaffSessionError extends UnauthorizedException {
  constructor(reason = 'Invalid or expired staff session.') {
    super(reason);
  }
}

export class StaffLoginThrottledError extends HttpException {
  constructor() {
    super('Too many failed sign-in attempts. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
  }
}

export class StaffRoleForbiddenError extends ForbiddenException {
  constructor() {
    super('This action is not available for your role.');
  }
}
