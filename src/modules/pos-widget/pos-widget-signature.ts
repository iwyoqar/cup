import { createHash, timingSafeEqual } from 'node:crypto';

// Phase 21 — Poster's DOCUMENTED request signature for Poster.makeRequest (https://dev.joinposter.com/en/docs/v3/pos/requests/makeRequest):
//   headers added by Poster:  X-Poster-Signature, X-Poster-Time (Unix timestamp, seconds), X-Poster-Url (account), X-Poster-Spot-Id, X-Poster-Tablet-Id
//   X-Poster-Signature       = md5( fullRequestUrl + jsonBody + X-Poster-Time + applicationSecret )
//                              — the full URL INCLUDES the GET parameters; for a GET request the body is excluded.
// The documentation says the signature is used for "vulnerable transactions such as payment, points writing-off or accrual"; whether ORDINARY makeRequest calls
// carry it is NOT documented and is verified at runtime (GET /pos-widget/ping reports it). Nothing here invents a field: a request without the headers is simply
// unauthenticated.
export const POSTER_HEADER = {
  signature: 'x-poster-signature',
  time: 'x-poster-time',
  url: 'x-poster-url',
  spot: 'x-poster-spot-id',
  tablet: 'x-poster-tablet-id',
} as const;

export interface PosContext {
  account: string;
  spotId: string | null;
  tabletId: string | null;
}

export type PosAuthFailure = 'DISABLED' | 'NOT_CONFIGURED' | 'MISSING_SIGNATURE' | 'STALE_TIMESTAMP' | 'BAD_SIGNATURE' | 'WRONG_ACCOUNT';
export type PosAuthResult = { ok: true; context: PosContext } | { ok: false; reason: PosAuthFailure; signaturePresent: boolean };

export function expectedSignature(url: string, body: unknown | undefined, time: string, secret: string): string {
  const json = body !== undefined && body !== null && !(typeof body === 'object' && Object.keys(body as object).length === 0) ? JSON.stringify(body) : '';
  return createHash('md5').update(url + json + time + secret).digest('hex');
}

// Constant-time comparison against every plausible spelling of the URL Poster signed (see the controller: the configured public base URL, and the forwarded
// scheme / host). The candidates only decide WHICH string is hashed — none of them can make a forged signature verify without the secret.
export function signatureMatches(candidateUrls: string[], body: unknown | undefined, time: string, given: string, secret: string): boolean {
  const g = Buffer.from(given.toLowerCase(), 'utf8');
  let match = false;
  for (const url of candidateUrls) {
    const e = Buffer.from(expectedSignature(url, body, time, secret), 'utf8');
    if (e.length === g.length && timingSafeEqual(e, g)) match = true; // no early exit: the work does not depend on which candidate matched
  }
  return match;
}

// X-Poster-Url is "the account identifier": accept the bare subdomain or a URL form of it (its exact spelling is not documented) and compare case-insensitively.
export function normalizeAccount(value: string | undefined | null): string {
  if (!value) return '';
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/\.joinposter\.com$/, '');
}

const DIGITS = /^\d{1,12}$/;
export const cleanId = (v: string | undefined): string | null => (v && DIGITS.test(v.trim()) ? v.trim() : null);
