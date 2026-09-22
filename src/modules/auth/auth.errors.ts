import { BadRequestException, UnauthorizedException } from '@nestjs/common';

// Matches the error contract in this phase's spec exactly:
//   400 — malformed/missing initData
//   401 — invalid Telegram signature
//   401 — expired/stale initData
//   401 — missing/invalid CUP session token
// Messages are deliberately generic — never echo raw initData, the bot token, or internal
// validation detail back to the client.

export class MalformedInitDataError extends BadRequestException {
  constructor(reason: string) {
    super(`Malformed Telegram initData: ${reason}`);
  }
}

export class InvalidTelegramSignatureError extends UnauthorizedException {
  constructor() {
    super('Invalid Telegram signature.');
  }
}

export class StaleInitDataError extends UnauthorizedException {
  constructor() {
    super('Telegram initData has expired.');
  }
}

export class InvalidSessionError extends UnauthorizedException {
  constructor(reason = 'Invalid or expired session.') {
    super(reason);
  }
}
