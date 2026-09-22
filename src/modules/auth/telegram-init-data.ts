import { createHmac, timingSafeEqual } from 'crypto';
import { InvalidTelegramSignatureError, MalformedInitDataError, StaleInitDataError } from './auth.errors';

export interface VerifiedTelegramUser {
  telegramUserId: string;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  languageCode: string | null;
}

interface TelegramInitDataUser {
  id?: unknown;
  first_name?: unknown;
  last_name?: unknown;
  username?: unknown;
  language_code?: unknown;
}

// Implements Telegram's officially documented algorithm exactly — confirmed against the
// primary source (core.telegram.org/bots/webapps, "Validating data received via the Mini
// App") during Phase 1.3 implementation, not from memory or a third-party summary:
//
//   1. secret_key = HMAC_SHA256(key="WebAppData", data=<bot_token>)
//   2. data_check_string = every field except "hash", sorted alphabetically by key,
//      joined as "key=value" with "\n"
//   3. computed_hash = hex(HMAC_SHA256(key=secret_key, data=data_check_string))
//   4. valid iff computed_hash === hash (compared in constant time)
//   5. (recommended by the same docs) reject if auth_date is older than an app-defined window
//
// Never logs rawInitData, botToken, or any computed hash — callers must not either.
export function verifyTelegramInitData(
  rawInitData: string,
  botToken: string,
  maxAgeSeconds: number,
): VerifiedTelegramUser {
  if (!rawInitData || typeof rawInitData !== 'string') {
    throw new MalformedInitDataError('initData is required and must be a non-empty string.');
  }

  const params = new URLSearchParams(rawInitData);

  const hash = params.get('hash');
  if (!hash) {
    throw new MalformedInitDataError('missing "hash" field.');
  }

  const authDateRaw = params.get('auth_date');
  const authDate = authDateRaw !== null ? Number(authDateRaw) : NaN;
  if (authDateRaw === null || !Number.isFinite(authDate)) {
    throw new MalformedInitDataError('missing or non-numeric "auth_date" field.');
  }

  const userRaw = params.get('user');
  if (!userRaw) {
    throw new MalformedInitDataError('missing "user" field.');
  }
  let userJson: TelegramInitDataUser;
  try {
    userJson = JSON.parse(userRaw) as TelegramInitDataUser;
  } catch {
    throw new MalformedInitDataError('"user" field is not valid JSON.');
  }
  if (typeof userJson.id !== 'number' || !Number.isFinite(userJson.id)) {
    throw new MalformedInitDataError('"user" field is missing a numeric "id".');
  }

  const dataCheckString = [...params.entries()]
    .filter(([key]) => key !== 'hash')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computedHash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const computedHashBuffer = Buffer.from(computedHash, 'hex');
  const receivedHashBuffer = Buffer.from(hash, 'hex');
  const signatureValid =
    computedHashBuffer.length === receivedHashBuffer.length && timingSafeEqual(computedHashBuffer, receivedHashBuffer);
  if (!signatureValid) {
    throw new InvalidTelegramSignatureError();
  }

  const ageSeconds = Date.now() / 1000 - authDate;
  if (ageSeconds > maxAgeSeconds) {
    throw new StaleInitDataError();
  }

  return {
    telegramUserId: String(userJson.id),
    firstName: typeof userJson.first_name === 'string' ? userJson.first_name : null,
    lastName: typeof userJson.last_name === 'string' ? userJson.last_name : null,
    username: typeof userJson.username === 'string' ? userJson.username : null,
    languageCode: typeof userJson.language_code === 'string' ? userJson.language_code : null,
  };
}
