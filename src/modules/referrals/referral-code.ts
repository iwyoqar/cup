import { randomInt } from 'node:crypto';

// Phase 14 — the PUBLIC referral code. Shown to customers as REF-7K4M9X2P; only the 8-character body is stored and carried in the Telegram
// deep link (https://t.me/<bot>?start=ref_7K4M9X2P).
//
// Same properties as the loyalty code (Phase 11) — crypto.randomInt, non-sequential, non-guessable (31^8 ≈ 8.5e11), no ambiguous 0/1/I/L/O — but a
// SEPARATE code with a different prefix on purpose: the loyalty code is scanned by staff at the till and identifies the customer to them, so it
// must never be shared publicly; a referral code is meant to be shared and carries no identity (a server lookup is the only thing that resolves it,
// and resolving it never reveals who the referrer is to the friend).
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const REFERRAL_CODE_LENGTH = 8;
export const REFERRAL_CODE_DISPLAY_PREFIX = 'REF-';
export const REFERRAL_START_PREFIX = 'ref_';
export const REFERRAL_CODE_MAX_ATTEMPTS = 8;

const BODY_PATTERN = new RegExp(`^[${ALPHABET}]{${REFERRAL_CODE_LENGTH}}$`);

export function generateReferralCodeBody(): string {
  let body = '';
  for (let i = 0; i < REFERRAL_CODE_LENGTH; i += 1) body += ALPHABET[randomInt(ALPHABET.length)];
  return body;
}

export const displayReferralCode = (body: string): string => `${REFERRAL_CODE_DISPLAY_PREFIX}${body}`;

// Canonical stored body, or null. Forgiving about case, whitespace and an optional REF-/REF_ prefix; strict about the result.
export function normalizeReferralCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  let value = input.replace(/\s+/g, '').toUpperCase();
  if (value.startsWith('REF-') || value.startsWith('REF_')) value = value.slice(4);
  return BODY_PATTERN.test(value) ? value : null;
}

export type StartPayload = { kind: 'NONE' } | { kind: 'REFERRAL'; code: string | null };

// The text after "/start ". Telegram limits it to 64 characters of [A-Za-z0-9_-]. Anything that is not a `ref_…` payload is NOT ours (kind NONE —
// leave /start behaviour exactly as it was); a `ref_…` payload with a malformed code is REFERRAL with code null (a no-op, never an error).
export function parseStartPayload(payload: unknown): StartPayload {
  if (typeof payload !== 'string') return { kind: 'NONE' };
  const text = payload.trim();
  if (text.length === 0 || text.length > 64) return { kind: 'NONE' };
  if (!text.toLowerCase().startsWith(REFERRAL_START_PREFIX)) return { kind: 'NONE' };
  return { kind: 'REFERRAL', code: normalizeReferralCode(text.slice(REFERRAL_START_PREFIX.length)) };
}

export function buildReferralLink(botUsername: string, body: string): string {
  return `https://t.me/${botUsername}?start=${REFERRAL_START_PREFIX}${body}`;
}

// A unique-constraint violation specifically on the code column (as opposed to the one-code-per-customer constraint) — the only case where
// retrying with a fresh code is right.
export function isReferralCodeCollision(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; meta?: { target?: unknown } };
  return e.code === 'P2002' && /code/.test(JSON.stringify(e.meta?.target ?? '')) && !/customerId/.test(JSON.stringify(e.meta?.target ?? ''));
}
