import { createHash, timingSafeEqual } from 'node:crypto';

// Phase 20 — the DOCUMENTED Poster webhook shape and signature (https://dev.joinposter.com/en/docs/v3/web/webhooks). Nothing here is inferred:
//   POST body (JSON): { account, account_number, object, object_id, action, time, verify, [data] }
//   action        : "added" | "changed" | "removed" | "transformed"
//   time          : Unix timestamp in SECONDS, sent as a string
//   verify        : md5( account ; object ; object_id ; action ; [data ;] time ; application_secret )   (fields joined with ";", data only if transmitted)
// There is NO event id, and the documentation does not say what a `transaction` webhook carries beyond the ids (so it is only ever a hint: the canonical
// transaction is always re-read from Poster's API). Retries (documented: 15) re-send the SAME body, hence the (object, object_id, action, time) dedupe key.
export const POSTER_WEBHOOK_ACTIONS = ['added', 'changed', 'removed', 'transformed'] as const;
export type PosterWebhookAction = (typeof POSTER_WEBHOOK_ACTIONS)[number];

export interface PosterWebhookPayload {
  account: string;
  object: string;
  objectId: string;
  action: PosterWebhookAction;
  time: string; // seconds, as sent
  data: string | undefined; // only when transmitted as a string; anything else cannot be verified and is refused
  account_number?: string;
}

export type ParsedWebhook =
  | { ok: true; payload: PosterWebhookPayload; verify: string }
  | { ok: false; reason: 'MALFORMED' | 'UNSUPPORTED_DATA' };

const OBJECT_NAME = /^[a-z_]{1,40}$/;
const OBJECT_ID = /^[A-Za-z0-9_-]{1,40}$/;
const TIME = /^\d{9,12}$/;

// Shape validation only (no secret involved). `data`, when present, must be a string — the documented example concatenates it verbatim, and a structured
// value has no documented serialisation, so it is refused rather than guessed.
export function parsePosterWebhook(body: unknown): ParsedWebhook {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, reason: 'MALFORMED' };
  const b = body as Record<string, unknown>;
  const str = (v: unknown): string | null => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : null);
  const account = str(b.account);
  const object = str(b.object);
  const objectId = str(b.object_id);
  const action = str(b.action);
  const time = str(b.time);
  const verify = typeof b.verify === 'string' ? b.verify : null;
  if (!account || !object || !objectId || !action || !time || !verify) return { ok: false, reason: 'MALFORMED' };
  if (account.length > 64 || !OBJECT_NAME.test(object) || !OBJECT_ID.test(objectId) || !TIME.test(time) || !/^[a-f0-9]{32}$/i.test(verify)) return { ok: false, reason: 'MALFORMED' };
  if (!(POSTER_WEBHOOK_ACTIONS as readonly string[]).includes(action)) return { ok: false, reason: 'MALFORMED' };
  let data: string | undefined;
  if (b.data !== undefined && b.data !== null) {
    if (typeof b.data !== 'string') return { ok: false, reason: 'UNSUPPORTED_DATA' };
    data = b.data;
  }
  const accountNumber = str(b.account_number) ?? undefined;
  return { ok: true, verify, payload: { account, object, objectId, action: action as PosterWebhookAction, time, data, account_number: accountNumber } };
}

export function computePosterWebhookSignature(p: Pick<PosterWebhookPayload, 'account' | 'object' | 'objectId' | 'action' | 'time' | 'data'>, secret: string): string {
  const parts = [p.account, p.object, p.objectId, p.action];
  if (p.data !== undefined) parts.push(p.data);
  parts.push(p.time, secret);
  return createHash('md5').update(parts.join(';')).digest('hex');
}

// Constant-time comparison; the secret is never logged or returned.
export function verifyPosterWebhookSignature(payload: PosterWebhookPayload, verify: string, secret: string): boolean {
  const expected = Buffer.from(computePosterWebhookSignature(payload, secret), 'utf8');
  const given = Buffer.from(verify.toLowerCase(), 'utf8');
  return expected.length === given.length && timingSafeEqual(expected, given);
}

// The same delivery (a Poster retry) always yields the same key; a genuinely new change has a new time and therefore a new key.
export const webhookDedupeKey = (p: Pick<PosterWebhookPayload, 'object' | 'objectId' | 'action' | 'time'>): string => `${p.object}:${p.objectId}:${p.action}:${p.time}`;
