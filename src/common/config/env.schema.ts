import { z } from 'zod';

// Fail-fast environment validation. POSTER_API_TOKEN is required and is never logged,
// never given a default, and never echoed back in any response.
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  POSTER_API_BASE_URL: z.string().url(),
  POSTER_API_TOKEN: z.string().min(1, 'POSTER_API_TOKEN is required'),
  POSTER_DEFAULT_SPOT_ID: z.coerce.number().int().positive().default(1),

  ORDER_STATUS_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(30000),
  CATALOG_SYNC_INTERVAL_MS: z.coerce.number().int().positive().default(300000),

  // See docs/PHASE-0-PLAN.md and the Phase 0 code review: an IdempotencyKey left "in_progress"
  // longer than this (e.g. a crash between reserving the key and recording Poster's outcome)
  // is treated as "uncertain" rather than retried automatically — never a blind retry.
  IDEMPOTENCY_STALE_IN_PROGRESS_MS: z.coerce.number().int().positive().default(120000),

  // Phase 1.3: required for Telegram Mini App initData HMAC verification (see
  // docs/PHASE-1-DESIGN.md section 12). This is cryptographic key material only — the bot
  // itself (polling/webhook) is not implemented until Phase 1.6. Never logged, never returned
  // in any response.
  TELEGRAM_BOT_TOKEN: z.string().min(1, 'TELEGRAM_BOT_TOKEN is required'),
  // Signs CUP's own session tokens — deliberately separate key material from the bot token
  // and the Poster token. Never logged, never returned in any response.
  JWT_SECRET: z.string().min(1, 'JWT_SECRET is required'),
  JWT_EXPIRES_IN_SECONDS: z.coerce.number().int().positive().default(86400),
  // Rejects initData older than this — see the "freshness" check in Telegram's own docs.
  TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: z.coerce.number().int().positive().default(86400),

  // Phase 1.5: a cart whose last activity (max of Cart.updatedAt and its items' addedAt — see
  // CartService.assertCartNotExpired) is older than this is rejected at checkout, not
  // proactively cleaned up (no background job). 1 hour is a reasonable dev default; deferred
  // from Phase 1.4 since there was no checkout to enforce it against yet.
  CART_EXPIRY_MS: z.coerce.number().int().positive().default(3600000),

  // Phase 1.6: the Mini App launch button's target. Deliberately OPTIONAL — registration and
  // phone collection must keep working without it (see telegram-bot.service.ts), since the
  // Mini App frontend itself doesn't exist yet. Validated as a URL only when actually provided.
  MINI_APP_URL: z.string().url().optional(),

  // Phase 3: Admin sessions are signed with an entirely separate secret from customer JWTs
  // (JWT_SECRET) — a customer token must fail signature verification outright against admin
  // routes, not merely fail a claim check. Never logged, never returned in any response.
  ADMIN_JWT_SECRET: z.string().min(1, 'ADMIN_JWT_SECRET is required'),
  ADMIN_JWT_EXPIRES_IN_SECONDS: z.coerce.number().int().positive().default(43200),
  // Phase 3: optional — read only by prisma/seed.ts to idempotently bootstrap the first Admin
  // row (upsert by email) when no admin exists yet. Never read by the running application
  // itself, and both must be provided together or the seed step just logs and skips.
  // Phase 11: barista (staff) sessions. Optional: when absent the staff signing key is DERIVED from
  // ADMIN_JWT_SECRET with a fixed label (HMAC), so a staff token still cannot verify as an admin or
  // customer token (different key AND audience). Set it to give staff a fully independent secret.
  STAFF_JWT_SECRET: z.string().min(16).optional(),
  STAFF_JWT_EXPIRES_IN_SECONDS: z.coerce.number().int().positive().default(43200),
  // Phase 11.2: a Poster receipt younger than this is not imported yet (reason TOO_RECENT). It is a settling delay,
  // not a dedupe key: it only gives Poster time to report the receipt link of a CUP-created order first.
  POSTER_IMPORT_SETTLE_SECONDS: z.coerce.number().int().min(0).default(600),
  // Phase 20 — Poster webhook continuous sync. POSTER_SYNC_ENABLED is an OPERATOR safety interlock (default OFF): while it is not exactly "true" the webhook
  // endpoint still verifies and durably QUEUES events, but nothing is fetched or imported and the reconciliation loop does not run. POSTER_APPLICATION_SECRET is
  // the Poster application's secret (developer dashboard) used ONLY to verify webhook signatures; without it the endpoint answers 503 and stores nothing.
  // POSTER_ACCOUNT optionally pins the expected Poster account name. The intervals bound the processor tick and the missed-webhook reconciliation.
  POSTER_SYNC_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  POSTER_APPLICATION_SECRET: z.string().min(8).optional(),
  POSTER_ACCOUNT: z.string().trim().min(1).max(64).optional(),
  POSTER_SYNC_TICK_MS: z.coerce.number().int().min(1000).default(15000),
  POSTER_RECONCILE_INTERVAL_MS: z.coerce.number().int().min(60000).default(60000),
  // The reconciliation is CHECKPOINT-based (Settings key poster.sync.reconcileCheckpoint): it resumes from the last successfully reconciled moment, however long CUP
  // was down. LOOKBACK_DAYS is only the INITIAL checkpoint (how far back the very first run looks when no checkpoint exists yet). OVERLAP_MINUTES is the safety margin
  // each pass re-reads BEFORE the checkpoint (clock skew, receipts that reach Poster's API a little late); re-reading is harmless because imports are idempotent.
  POSTER_RECONCILE_LOOKBACK_DAYS: z.coerce.number().int().min(1).max(7).default(2),
  POSTER_RECONCILE_OVERLAP_MINUTES: z.coerce.number().int().min(5).max(1440).default(60),
  POSTER_WEBHOOK_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(50).default(12),
  // Phase 21 — Poster POS widget backend (read-only). POS_WIDGET_ENABLED is an operator interlock, default OFF: while it is not exactly "true" every /pos-widget
  // route answers 503 and reads nothing. Requests are authenticated with Poster's documented request signature, keyed by POSTER_APPLICATION_SECRET (server-side only,
  // never in the widget bundle). POS_WIDGET_ACCOUNT pins the Poster account (X-Poster-Url); POS_WIDGET_PUBLIC_URL is the public HTTPS base URL Poster calls (the
  // signature covers the full URL); POS_WIDGET_SIGNATURE_MAX_AGE is the accepted age of X-Poster-Time in seconds.
  POS_WIDGET_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  POS_WIDGET_ACCOUNT: z.string().trim().min(1).max(64).optional(),
  POS_WIDGET_PUBLIC_URL: z.string().url().optional(),
  POS_WIDGET_SIGNATURE_MAX_AGE: z.coerce.number().int().min(30).max(3600).default(300),
  // Phase 22 — reward / promotion redemption on the LIVE Poster POS order, from the widget. Each is its own operator interlock, default OFF, independent of
  // POS_WIDGET_ENABLED (the read-only overview can be on while redemption stays off). Reward mutation is implemented and live-verified
  // (docs/PHASE-22-AUDIT.md §15). Promotion mutation (Phase 23, docs/PHASE-23-PROMOTIONS.md) is verified only for FREE_PRODUCT / LOYALTY_POINTS benefit
  // types — PERCENT_DISCOUNT / FIXED_DISCOUNT have no known Poster mechanism and always resolve FAILED regardless of this flag. Turning either flag on
  // does not, by itself, make an unsupported benefit type mutate anything.
  POS_REWARD_REDEMPTION_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  POS_PROMOTION_REDEMPTION_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  // Phase 17: the business day used by analytics (day boundaries, daily chart). A FIXED offset from UTC in minutes so the
  // boundaries are deterministic; default 300 = UTC+5 (Uzbekistan, no daylight saving).
  BUSINESS_TIMEZONE_OFFSET_MINUTES: z.coerce.number().int().min(-720).max(840).default(300),
  // Phase 12: how often the Loyalty 2.0 background sync looks for qualifying purchases that have not been processed yet
  // (cashback / points / level-ups / achievements). It only does any work while Loyalty 2.0 is switched on in Admin.
  LOYALTY2_SYNC_INTERVAL_MS: z.coerce.number().int().min(1000).default(120000),
  // Phase 13 — CRM automation. CRM_AUTOMATION_SEND_ENABLED is a HARD SAFETY INTERLOCK (an operator env flag, not an Admin setting): while it
  // is not exactly "true" NO automation can ever send a Telegram message, whatever the Admin settings say (preview still works).
  // Parsed as an explicit enum: z.coerce.boolean("false") would be true. AUTOMATION_RUN_INTERVAL_MS is the runner heartbeat.
  CRM_AUTOMATION_SEND_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  AUTOMATION_RUN_INTERVAL_MS: z.coerce.number().int().min(1000).default(60000),
  // Phase 14 — referrals. REFERRAL_RUN_INTERVAL_MS is the qualification / reward job heartbeat (a no-op while Referrals is off in Admin).
  // TELEGRAM_BOT_USERNAME is OPTIONAL: the bot's own username (learned when the bot starts polling) is used when it is absent; set it only to
  // override (a leading @ is tolerated). It is public information, not a secret.
  REFERRAL_RUN_INTERVAL_MS: z.coerce.number().int().min(1000).default(60000),
  TELEGRAM_BOT_USERNAME: z
    .string()
    .trim()
    .transform((value) => value.replace(/^@/, ''))
    .pipe(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{3,31}$/, 'TELEGRAM_BOT_USERNAME must be a Telegram bot username'))
    .optional(),
  ADMIN_BOOTSTRAP_EMAIL: z.string().email().optional(),
  ADMIN_BOOTSTRAP_PASSWORD: z.string().min(8).optional(),

  // Phase 8.1 HARD PRODUCTION GATE — deliberately an operator-controlled env flag, NOT an Admin
  // Panel setting: it is a safety interlock, not a business rule a founder tunes. Default OFF.
  // While off, no customer can select a reward and checkout refuses any order carrying one.
  // Reason: Poster's incomingOrders.createIncomingOrder documents a per-line `price`, but the
  // official docs do not say whether price 0 is honored, and Poster's API responses do not echo
  // price back — so "CUP total == what Poster actually charges" cannot be proven from code or
  // API alone. Turn on ONLY after a supervised real verification order has been checked at the
  // POS (reward line shows 0). Parsed as an explicit enum: z.coerce.boolean("false") would be true.
  REWARD_CHECKOUT_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(raw: NodeJS.ProcessEnv): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  return parsed.data;
}
