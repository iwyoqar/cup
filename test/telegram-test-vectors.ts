import { createHmac } from 'crypto';

// Deliberately re-implements Telegram's documented initData signing algorithm independently
// of src/modules/auth/telegram-init-data.ts, so tests aren't just checking the implementation
// against itself — see core.telegram.org/bots/webapps, "Validating data received via the
// Mini App". Test-only: never used by application code, never talks to real Telegram.
export function buildSignedInitData(fields: Record<string, string>, botToken: string): string {
  const dataCheckString = Object.keys(fields)
    .sort((a, b) => a.localeCompare(b))
    .map((key) => `${key}=${fields[key]}`)
    .join('\n');

  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  return new URLSearchParams({ ...fields, hash }).toString();
}

export interface ValidInitDataOverrides {
  telegramUserId?: number;
  firstName?: string;
  lastName?: string;
  username?: string;
  languageCode?: string;
  authDate?: number;
}

export function buildValidInitData(overrides: ValidInitDataOverrides = {}, botToken: string): string {
  const user = {
    id: overrides.telegramUserId ?? 123456789,
    first_name: overrides.firstName ?? 'Test',
    last_name: overrides.lastName ?? 'User',
    username: overrides.username ?? 'testuser',
    language_code: overrides.languageCode ?? 'en',
  };
  const authDate = overrides.authDate ?? Math.floor(Date.now() / 1000);

  return buildSignedInitData(
    {
      user: JSON.stringify(user),
      auth_date: String(authDate),
      query_id: 'AAHtest',
    },
    botToken,
  );
}
