import { InvalidTelegramSignatureError, MalformedInitDataError, StaleInitDataError } from '../../src/modules/auth/auth.errors';
import { verifyTelegramInitData } from '../../src/modules/auth/telegram-init-data';
import { buildSignedInitData, buildValidInitData } from '../telegram-test-vectors';

const BOT_TOKEN = 'test-only-fake-bot-token-000000000000';
const MAX_AGE_SECONDS = 86400;

describe('verifyTelegramInitData (deterministic test vectors — never calls real Telegram)', () => {
  it('accepts valid, correctly signed initData and extracts the verified user', () => {
    const initData = buildValidInitData({ telegramUserId: 987654321, firstName: 'Ada', username: 'ada_lovelace' }, BOT_TOKEN);

    const result = verifyTelegramInitData(initData, BOT_TOKEN, MAX_AGE_SECONDS);

    expect(result).toEqual({
      telegramUserId: '987654321',
      firstName: 'Ada',
      lastName: 'User',
      username: 'ada_lovelace',
      languageCode: 'en',
    });
  });

  it('rejects a tampered hash', () => {
    const initData = buildValidInitData({}, BOT_TOKEN);
    const tampered = initData.replace(/hash=[a-f0-9]+/, `hash=${'0'.repeat(64)}`);

    expect(() => verifyTelegramInitData(tampered, BOT_TOKEN, MAX_AGE_SECONDS)).toThrow(InvalidTelegramSignatureError);
  });

  it('rejects initData signed with a different bot token (wrong key material)', () => {
    const initData = buildValidInitData({}, 'a-completely-different-bot-token');

    expect(() => verifyTelegramInitData(initData, BOT_TOKEN, MAX_AGE_SECONDS)).toThrow(InvalidTelegramSignatureError);
  });

  it('rejects a stale auth_date beyond the configured freshness window', () => {
    const staleAuthDate = Math.floor(Date.now() / 1000) - MAX_AGE_SECONDS - 60;
    const initData = buildValidInitData({ authDate: staleAuthDate }, BOT_TOKEN);

    expect(() => verifyTelegramInitData(initData, BOT_TOKEN, MAX_AGE_SECONDS)).toThrow(StaleInitDataError);
  });

  it('accepts auth_date just inside the freshness window', () => {
    const freshEnough = Math.floor(Date.now() / 1000) - (MAX_AGE_SECONDS - 60);
    const initData = buildValidInitData({ authDate: freshEnough }, BOT_TOKEN);

    expect(() => verifyTelegramInitData(initData, BOT_TOKEN, MAX_AGE_SECONDS)).not.toThrow();
  });

  it('rejects initData with no hash field', () => {
    expect(() => verifyTelegramInitData('auth_date=123&user=%7B%7D', BOT_TOKEN, MAX_AGE_SECONDS)).toThrow(
      MalformedInitDataError,
    );
  });

  it('rejects initData with no auth_date field', () => {
    const initData = buildSignedInitData({ user: JSON.stringify({ id: 1 }) }, BOT_TOKEN);

    expect(() => verifyTelegramInitData(initData, BOT_TOKEN, MAX_AGE_SECONDS)).toThrow(MalformedInitDataError);
  });

  it('rejects initData with no user field', () => {
    const initData = buildSignedInitData({ auth_date: String(Math.floor(Date.now() / 1000)) }, BOT_TOKEN);

    expect(() => verifyTelegramInitData(initData, BOT_TOKEN, MAX_AGE_SECONDS)).toThrow(MalformedInitDataError);
  });

  it('rejects a user field that is not valid JSON', () => {
    const initData = buildSignedInitData(
      { user: 'not-json', auth_date: String(Math.floor(Date.now() / 1000)) },
      BOT_TOKEN,
    );

    expect(() => verifyTelegramInitData(initData, BOT_TOKEN, MAX_AGE_SECONDS)).toThrow(MalformedInitDataError);
  });

  it('rejects a user field missing a numeric id', () => {
    const initData = buildSignedInitData(
      { user: JSON.stringify({ first_name: 'No Id' }), auth_date: String(Math.floor(Date.now() / 1000)) },
      BOT_TOKEN,
    );

    expect(() => verifyTelegramInitData(initData, BOT_TOKEN, MAX_AGE_SECONDS)).toThrow(MalformedInitDataError);
  });

  it('rejects missing initData entirely', () => {
    expect(() => verifyTelegramInitData('', BOT_TOKEN, MAX_AGE_SECONDS)).toThrow(MalformedInitDataError);
  });
});
