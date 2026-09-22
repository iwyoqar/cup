import * as path from 'path';

// Loaded by Jest before every test file. Points DATABASE_URL at a dedicated test SQLite
// file (never the local dev.db) and supplies fixed config so ConfigService/PosterService can
// be constructed without a real .env. Poll intervals are set absurdly high so no background
// job ever fires during a test run.
const testDbPath = path.join(__dirname, '..', 'prisma', 'test.db').replace(/\\/g, '/');

process.env.NODE_ENV = 'test';
process.env.PORT = '4000'; // never actually bound in tests (app.listen() is not called)
process.env.DATABASE_URL = `file:${testDbPath}`;
process.env.POSTER_API_BASE_URL = 'https://joinposter.com/api';
process.env.POSTER_API_TOKEN = 'test-token';
process.env.POSTER_DEFAULT_SPOT_ID = '1';
process.env.ORDER_STATUS_POLL_INTERVAL_MS = '999999999';
process.env.CATALOG_SYNC_INTERVAL_MS = '999999999';
// Large by default so ordinary "in_progress" tests aren't accidentally treated as stale;
// tests targeting the staleness behavior override this before constructing their ConfigService.
process.env.IDEMPOTENCY_STALE_IN_PROGRESS_MS = '999999999';

// Dedicated test-only secrets — NEVER the real bot token or a production JWT secret. Tests
// that need a specific bot token for HMAC test vectors set process.env.TELEGRAM_BOT_TOKEN
// themselves before constructing ConfigService; this is just a safe default so unrelated
// tests can boot ConfigService without caring about auth at all.
process.env.TELEGRAM_BOT_TOKEN = 'test-only-fake-bot-token-000000000000';
process.env.JWT_SECRET = 'test-only-fake-jwt-secret-do-not-use-in-prod';
process.env.JWT_EXPIRES_IN_SECONDS = '3600';
process.env.TELEGRAM_INIT_DATA_MAX_AGE_SECONDS = '86400';
