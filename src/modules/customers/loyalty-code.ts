import { randomInt } from 'node:crypto';

// Phase 11 — the PUBLIC customer identity code that is shown as QR / Code128 and read by baristas.
//
// Properties (all required by the spec): unique (DB unique index is the final word), random and
// non-sequential (crypto.randomInt, never derived from anything), non-guessable (31^8 ≈ 8.5e11
// possibilities), human-readable and short, stable for a customer's lifetime, and completely
// independent of Customer.id, the Telegram user id and the phone number.
//
// The alphabet omits 0/1/I/L/O so a code read aloud or typed from a screen cannot be confused.
// A code identifies a customer ONLY when a server-side lookup on it succeeds — it carries no data
// and confers no authority; scanning it never changes loyalty state.
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const LOYALTY_CODE_PREFIX = 'CUP-';
export const LOYALTY_CODE_BODY_LENGTH = 8;

const CODE_PATTERN = new RegExp(`^${LOYALTY_CODE_PREFIX}[${ALPHABET}]{${LOYALTY_CODE_BODY_LENGTH}}$`);

export function generateLoyaltyCode(): string {
  let body = '';
  for (let i = 0; i < LOYALTY_CODE_BODY_LENGTH; i += 1) {
    body += ALPHABET[randomInt(ALPHABET.length)];
  }
  return `${LOYALTY_CODE_PREFIX}${body}`;
}

// Forgiving of how a code arrives (scanner keyboard input, typed by hand, lower case, spaces, missing
// prefix or hyphen) but strict about the result: returns the canonical code or null. Never throws.
export function normalizeLoyaltyCode(input: string): string | null {
  if (typeof input !== 'string') return null;
  let value = input.replace(/\s+/g, '').toUpperCase();
  if (value.startsWith('CUP') && !value.startsWith(LOYALTY_CODE_PREFIX)) {
    value = `${LOYALTY_CODE_PREFIX}${value.slice(3)}`;
  } else if (!value.startsWith(LOYALTY_CODE_PREFIX)) {
    value = `${LOYALTY_CODE_PREFIX}${value}`;
  }
  return CODE_PATTERN.test(value) ? value : null;
}

// A unique-constraint violation specifically on loyaltyCode (as opposed to some other unique column
// such as TelegramAccount.telegramUserId) — the only case where retrying with a fresh code is right.
export function isLoyaltyCodeCollision(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; meta?: { target?: unknown } };
  return e.code === 'P2002' && JSON.stringify(e.meta?.target ?? '').includes('loyaltyCode');
}

export const LOYALTY_CODE_MAX_ATTEMPTS = 8;
