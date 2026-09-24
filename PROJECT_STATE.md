# CUP Coffee — Project State

Last updated: 2026-09-24 (POS import now accepts customer-unlinked receipts, counted anonymously — owner decision, code-complete, not yet deployed).

## Behavior change — POS import no longer skips customer-unlinked receipts (2026-09-24, code-complete)

Trigger: the owner deleted and rebuilt the entire real Poster menu mid-session (32→3 products; catalog sync correctly deactivated the old 29 and activated the new 3 — confirmed no staleness bug). While investigating, the owner asked to wipe CUP's entire production database and re-import from Poster fresh; this was **refused** (blocked by the environment's own safety classifier on a read-only prep step, and independently — a full wipe would destroy real customers, real reward redemptions, staff/admin accounts, with no verified backup, to fix a problem that didn't actually exist). The real underlying want, once clarified: import ALL real Poster sales into CUP, not just the subset already linked to a CUP customer.

**Old behavior:** `poster-transaction-import.service.ts` skipped a receipt entirely (`NO_CLIENT` / `CLIENT_NOT_LINKED`, never written) if it had no Poster client, or its client wasn't linked to a CUP customer — meaning Analytics/Finance revenue only ever reflected the subset of real sales attributable to a known customer.

**New behavior:** `PosterImportedTransaction.customerId`/`posterClientId` are now nullable. Such a receipt is imported anonymously (`customerId: null`) as long as it's still closed/paid and its branch is mapped — the ONE remaining case still skipped is a receipt bearing Poster's `application_id` marker (a probable CUP-order) with no resolved link: that always wants the real link or nothing, never a guess. Every per-customer consumer (rewards, Loyalty2, CRM automation triggers, Customer 360) already filters by a specific real `customerId`, so an anonymous row is automatically excluded from all of them without any change needed there; `AnalyticsRepository.posCustomerIds` got one explicit `customerId: { not: null }` filter so anonymous rows don't inflate the "distinct customers" count. Revenue (`posTotals`, and Finance's own P&L reuse of it) already summed with no customer filter, so it picks up anonymous sales automatically — **this is a real, upward revenue-figure change once deployed**, not cosmetic.

**Verified live (2026-09-24) against local `dev.db` using the real production Poster account:** a real preview+import of 2026-09-01..24 found 81 receipts; 52 were importable (up from what would have been ~28 under the old rule — 29 `NO_CLIENT` + 24 `CLIENT_NOT_LINKED` no longer skipped, only 4 `APPLICATION_ID_UNLINKED` still held back). A real write imported all 52: 41 landed anonymous (`customerId: null`), 21 with a real customer. `GET /admin/analytics/overview` correctly summed all 62 IMPORTED receipts into revenue (3,611,366 so'm from POS) while `customers: 1` stayed correct (not inflated by the 41 anonymous rows).

**Admin UI:** the now-dead `UNMAPPED_CUSTOMER` import category was removed from `PosterImportPage.tsx`'s labels/order; the data-quality report's `customers` block (`receiptsWithLinkedCustomer`/`receiptsWithoutPosterClient`/`receiptsWithUnlinkedPosterClient`) already existed and now carries the customer-linkage visibility that used to live in the attribution grouping.

`npx tsc --noEmit` / `npm run build` clean on both backend and `admin/`. Postgres migration hand-authored (`prisma/postgres/migrations/0004_pos_import_allow_anonymous/`). **Not yet deployed.**

## Finance & Accounting Dashboard (2026-09-24, code-complete, not deployed)

Full new `Admin → Finance` section: Revenue - COGS = Gross Profit; - Operating Expenses = Operating Profit; - Taxes - Interest - Other Financial Costs = Net Profit; plus Cash Flow, Loans, configurable Taxes, Investments, and Payback/ROI. New backend module `src/modules/finance/`, 8 new Prisma models (`ExpenseCategory`, `Expense`, `Loan`, `LoanPayment`, `TaxRule`, `Investment`, `CashAdjustment`, plus `Product.hasRecipe/theoreticalCostMinor/costSyncedAt`), new Admin UI `admin/src/pages/FinancePage.tsx` (Overview/P&L/Cash Flow/Expenses/Loans/Taxes/Investment & Payback tabs).

**Phase 1 audit finding (corrected a wrong premise in the request):** the codebase had ZERO finance/expense/loan/tax/inventory/payroll/purchasing models or data before this — the only reusable piece was `AnalyticsRepository`'s already-deduped CUP+POS revenue source, reused verbatim (never re-derived).

**COGS — the interesting discovery:** Poster POS has a real recipe/ingredient-cost system (`menu.getProduct`'s `ingredients`/`cost`, `storage.getStorageLeftovers`), verified live against the real account. But the REAL, currently-selling menu (all ~29 products) has NO recipe configured in Poster at all — a live test-recipe the owner added while investigating this (`product_id 61`, "Cappuccino 250 ml", English name, separate from the real "Капучино 250 мл" id 37) proved the mechanism works (18g coffee + 200ml milk + 1 cup = 8 570 so'm cost) but is not connected to any real sale. `FinanceCogsSyncService` reads this live per product every 30 min (`FINANCE_COGS_SYNC_INTERVAL_MS`) and caches `Product.theoreticalCostMinor` — a product with no Poster recipe stays `hasRecipe: false` forever, never estimated; the Overview/P&L UI shows an explicit "COGS data incomplete" banner naming exactly which products and quantities are excluded. COGS becomes accurate automatically, product by product, as the owner configures real recipes in Poster's own "Dishes" UI — no CUP-side data entry needed.

**"5+1"-reward-style counting reused for nothing else:** deliberately kept COGS/Expense semantics independent of the reward-visit-counting change earlier today — no interaction between the two.

**Two spec items explicitly NOT tracked, by design, per the spec's own "show Data incomplete, never fabricate" instruction (Phase 1's audit found no underlying data for either):**
- Inventory *purchases* (cash spent restocking) — only theoretical COGS of goods *sold* exists (an accrual figure). No purchasing/supplier module exists or was built; Cash Flow's own view says so explicitly rather than substituting COGS for it.
- Payroll as a dedicated per-employee system — folded into the "Salaries" default Expense category instead of a new model (`StaffMember` has no compensation field and none was added, per "do not create duplicate/unnecessary models").

**Reused, not rebuilt:** `AnalyticsRepository` (revenue, per-product quantity/revenue, branch/period filtering), `AdminAuthGuard`/`CurrentAdmin`, `StaffScanEvent` (audit trail for every finance mutation, no new audit table), `Branch`, the project's whole-UZS-integer money convention, the `CatalogSyncJob`/scheduled-interval-from-config pattern (mirrored for `FinanceCogsSyncJob` and `FinanceRecurringExpenseJob`).

**Loans:** principal repayment (cash-flow item) and interest (P&L expense) are always recorded as two separate fields on one `LoanPayment` row — never one blended "loan payment expense", per the spec's explicit instruction. Standard fixed-rate amortization for the estimated monthly payment; the real ledger only ever sums actually-recorded `LoanPayment` rows.

**Taxes:** fully configurable (name, rate, base = Revenue/Gross Profit/Operating Profit, effective date range) — no hardcoded Uzbek tax rate or rule; explicitly presented as a calculation engine, not verified legal tax advice.

**Payback/ROI:** never fabricates an estimate — explicit `NO_INVESTMENT_RECORDED` / `INSUFFICIENT_HISTORY` / `NEGATIVE_CASH_FLOW` states when a reliable projection isn't possible, matching the spec's own instruction.

**Verified (2026-09-24):** `npx tsc --noEmit` and `npm run build` clean on both backend and `admin/`. Full manual walkthrough in a real browser against local `dev.db` — created a real expense, loan (250M so'm/18%/60mo, matching the spec's own worked example) with a payment recorded, a 4%-of-revenue tax rule, and an 80M so'm investment; confirmed Overview, P&L, Cash Flow, and Payback all reflect them correctly and consistently with each other. `POST /admin/finance/cogs-sync` verified live against the real Poster account (29 products scanned, all correctly reported as having no recipe yet).

**Not yet deployed** — needs a Postgres migration on Render (`prisma/postgres/migrations/0003_finance_accounting_v1/`, already hand-authored and mirrors the two applied SQLite migrations) plus the usual `npm run render:build`/deploy. Not yet built: a printable/exportable monthly report matching the spec's literal ASCII layout (the P&L tab shows the same numbers interactively, with drill-down, instead), and per-branch Payback (Payback is currently whole-business only, since Investment can be branch-tagged but the owner's initial big-ticket items — espresso machine, renovation — are typically not meaningfully split per branch).

## Fix — real POS purchases no longer wait 10 minutes to appear in reward progress (2026-09-24, code-complete)

Owner report: a customer's "5+1" progress in the Telegram Mini App didn't update right after a real POS purchase — suspected (correctly) to be the same `POSTER_IMPORT_SETTLE_SECONDS` (10 min) delay seen elsewhere.

**Root cause:** the settle delay's actual purpose (per its own original comment) is narrow — give Poster time to report a CUP Mini App checkout's receipt link (`incoming_order.transaction_id`) BEFORE that same receipt might otherwise be imported a second time as a bare POS sale (double-counting it: once as a CUP order, once as an imported POS purchase). It was applied to EVERY closed receipt regardless, including ones rung up directly at the register that could never have a CUP order to conflict with in the first place.

**Fix:** Poster stamps every CUP-created receipt with an undocumented `application_id` field (Phase 19's own prior observation, already used elsewhere in this file to skip an unresolved CUP-linked receipt rather than guess). `poster-transaction-import.service.ts`'s `TOO_RECENT` check now only applies the wait when `application_id` is present; a receipt without it proceeds immediately to the normal closed/paid/client-linked checks. **Verified live against the real Poster account (78 transactions, 2026-09-01..24):** every transaction with a known CUP order (#1, 2, 4, 12–15, 19, 52, 57, 58, 73) carries `application_id="7"`; every register-rung transaction (including the Phase 27.2 reward-redemption test #69 and every other recent sale) carries none — a clean, consistent split with no ambiguous cases observed.

**Deliberately NOT changed:** `POSTER_RECONCILE_INTERVAL_MS`'s hard 60-second floor (`env.schema.ts`, `min(60000)`) stays as-is. The reconciliation loop re-scans a multi-day Poster window on every tick (`poster-reconcile.service.ts`); polling that every few seconds would put sustained heavy load on Poster's API for a cosmetic latency gain, risking the account being rate-limited — the owner asked for near-instant (1-2s) delivery but agreed this specific mechanism isn't the safe way to get there. **Real-world latency now:** 0–60 seconds for a POS-native purchase (was up to ~11 minutes) — bounded by the reconciliation tick, since Poster webhooks (the only path to genuine sub-minute/real-time delivery) remain blocked on Poster's own side (Phase 27.1, parked).

`npx tsc --noEmit` and `npm run build` both clean. Not yet deployed.

## Behavior change — "5+1"-style rewards now count VISITS, not units (2026-09-24, code-complete)

Owner decision, prompted by a direct question: does the "5+1" reward need 5 separate purchases, or does buying 5 coffees in one visit also complete it? The owner chose separate visits only — a customer buying 5 coffees in a single receipt must NOT by itself unlock the reward.

**Rule now:** one CUP order, or one imported Poster POS transaction, containing at least one item in the program's qualifying category, counts as exactly ONE toward the threshold — regardless of how many qualifying items or what quantity that visit contains. Two different coffees in the same receipt still count as 1 visit (the owner explicitly chose "whole receipt = 1", not "one per qualifying line item").

**Implementation:** `RewardProgressRepository` gained `countQualifyingOccasions`/`countQualifyingOccasionsTx`/`countQualifyingOccasionsForCustomers` (`reward-progress.repository.ts`) — a DELIBERATELY SEPARATE set of methods from the existing `sumQualifyingQuantity*` ones, which are unchanged and still needed elsewhere: Loyalty2's `CATEGORY_UNITS` achievement condition and the CRM automation `LOYALTY_MILESTONE` "lifetimeCoffeeQuantity" metric both genuinely mean "total coffee units ever bought", not "number of visits", and were deliberately left alone. Switched to the new occasion-counting method: `RewardProgressService.getProgress`/`getAvailableForCustomers` (customer-facing progress bar and eligibility check), `RewardRedemptionService.createRedemptionRecord`'s transaction-consistent re-check (kept in lockstep with the progress display — a mismatch here would let the redemption engine refuse or allow something the UI already promised), and `automation-trigger.service.ts`'s `REWARD_UNLOCKED` CRM trigger (kept in lockstep with the reward engine's own math, per its own pre-existing comment requiring this).

**Verified:** against real local data, an existing customer's two totals genuinely differ (58 summed units vs. 14 qualifying visits) — confirms the new grouped/counted queries run correctly against real `Order`/`OrderItem`/`PosterImportedTransaction`/`PosterImportedTransactionItem` data, not just in the abstract. `npx tsc --noEmit` and `npm run build` both clean. Not yet deployed to production — this changes real reward math, so it should go out deliberately, not on the next incidental deploy.

**Frontend note, not changed:** the Mini App's "Yana N ta coffee va keyingisi bepul" ("N more coffees and the next one is free") copy in `frontend/src/features/account/RewardProgressSection.tsx` still reads naturally with the new visit-based count (N more purchases), so it was left as-is.

## Phase 27.1 — Production Poster Webhook Verification: RECONCILIATION HEALTHY, WEBHOOK DELIVERY BLOCKED (unresolved, parked)

Audited the full webhook pipeline (receiver signature/dedupe, durable queue, processor, transaction reconciliation) against the real production Poster account and code — no code defect found; the implementation matches Phase 20's design exactly (see that section below). Live findings:

- **Reconciliation (the fallback path) is genuinely healthy in production**: `/admin/poster/sync-status` shows the checkpoint advancing every `POSTER_RECONCILE_INTERVAL_MS` (now 60 000 — see Phase 24.1), `ok: true`, `caughtUp: true`. Every closed Poster receipt is picked up within about a minute regardless of webhooks — nothing is lost.
- **Webhook delivery has never fired** (`received24h: 0`, `lastReceivedAt: null`) because the webhook URL was never actually saved on Poster's side — confirmed directly by the owner, not assumed.
- **Attempting to configure it hit a real, unresolved blocker on Poster's own platform**: Poster's dashboard "Check" button for `GET /webhooks/poster` fails (red X) even though the endpoint was independently verified healthy from outside Poster — clean fast `200` responses to both GET and HEAD, a valid TLS certificate chain (`openssl s_client`: `Verify return code: 0`), and a response body matching the one documented acknowledgement shape (`{"status":"accept"}`, `en/web/webhooks.md`). An undocumented `{"status":"200"}` probe was also tried live at the owner's request and did not help either (reverted — no doc support for it). The "Receive webhooks by" entity dropdown on Poster's page also would not register a selection during this investigation, a second, related symptom that was never resolved. Full trail: `src/modules/poster-sync/poster-webhook.controller.ts`'s own comment.
- **Conclusion:** the blocker is on Poster's platform (its own Check feature, or something about how its check reaches this host) — not a CUP defect. Do not re-attempt this by guessing new response shapes without new evidence from Poster support.
- **Duplicate safety re-confirmed by code audit (unchanged from Phase 20):** three independent layers — the webhook `dedupeKey` unique constraint (a Poster retry only bumps `deliveries`), the import engine's pre-write `findExisting` check, and `PosterImportedTransaction.posterTransactionId`'s own unique constraint as the final backstop (a race is caught and retagged `ALREADY_IMPORTED`, never duplicated) — so loyalty accrual, rewards and analytics revenue can never double-count regardless of how many times an event or a reconciliation pass revisits the same receipt.
- **Parked, not disabled:** `POSTER_SYNC_ENABLED` stays on; reconciliation keeps running as the primary mechanism in practice until webhook setup is revisited (e.g. with Poster support's help). No code changes were needed beyond the response-body experiments above (net effect: unchanged from before this phase, after the revert).

## Phase 24 — Production Readiness: CODE-COMPLETE, NOT DEPLOYED

Prepares the backend to deploy to **Render** (Node web service) against **Supabase PostgreSQL**. Nothing was deployed and no
production database was created or touched — this phase only prepares the code, schema, and configuration. Full detail:
`CHANGELOG.md`.

**Local dev is completely unaffected.** `prisma/schema.prisma` (SQLite) and `prisma/migrations/` are untouched; `npm run
start:dev` against `dev.db` works exactly as before. Production uses a **separate, generated** schema
(`prisma/postgres/schema.prisma`, produced mechanically from `prisma/schema.prisma` by `scripts/generate-production-schema.js`
— the only difference is the datasource provider, since the schema was already portable from Phase 0: no enum, no Decimal, no
`@db.*` native overrides) and its own migration history (`prisma/postgres/migrations/`, one initial migration covering every
table, generated via `prisma migrate diff --from-empty`, never applied to any real database in this pass).

- **PostgreSQL compatibility.** Prisma's SQLite connector stores `DateTime` as an integer Unix-epoch-millisecond column;
  PostgreSQL stores it as a native UTC timestamp — a different on-disk representation, not just a syntax difference. Every raw
  SQL query that did its own date-bucketing (`strftime`) now goes through a new shared, dialect-aware helper
  (`src/common/prisma/sql-dialect.ts`), which picks the correct expression at runtime from `DATABASE_URL`'s scheme. Fixed this
  way: `analytics.repository.ts` (daily revenue) and `loyalty2.repository.ts` (visit days / morning / weekend purchase
  counts). The SQLite branch is byte-equivalent to the code it replaced and was manually re-verified against real `dev.db`
  data (not just "compiles") — see CHANGELOG for the exact check.
- **Also fixed (second pass, same day):** `branch-intelligence.repository.ts` (Phase 18) and `automations.repository.ts`
  (Phase 13) — previously flagged as blockers because their public contracts (`RangeMs { from, to }`, `EventCursor { t }`) pass
  raw epoch-ms numbers between the repository and its service/caller, not just inside a self-contained query. Resolved WITHOUT
  changing either contract: three new helpers were added to `sql-dialect.ts` — `epochMsCastSql()` normalizes a native
  DateTime column to an epoch-ms integer inside a CTE projection (so every downstream comparison against that CTE's `t`/`act`
  alias stays a plain integer-to-integer comparison, needing no further change in either dialect); `dayBucketFromEpochMsSql()`
  buckets an already-epoch-ms column by local calendar day (replaces `branch-intelligence`'s local `dayExpr`, distinct from
  `dayBucketSql` which expects a native timestamp column); `epochMsParam()` converts an epoch-ms number for the handful of
  queries that compare directly against a raw native DateTime column, bypassing any CTE (`topProductPerBranch`,
  `pointsLedger`, `rewardRedemptions`, `promotionRedemptions`, `referrals` in branch-intelligence). `RangeMs`/`EventCursor`
  themselves, and every service/controller that consumes them, are byte-for-byte unchanged. SQLite branch manually
  re-verified against real `dev.db` across every affected method in both files (branch metrics, totals, activity, daily
  series, points ledger, reward/promotion redemption counts, referrals, purchase-event stream, birthday matching, cart
  inactivity) — see CHANGELOG.
- **A real, unrelated bug fixed in passing:** `package.json`'s `start`/`main` pointed at `dist/main.js`, which has never
  existed (`tsconfig.json`'s `rootDir` puts the compiled entry point at `dist/src/main.js`) — every local restart this whole
  project has ever needed the workaround `node dist/src/main.js` by hand. Fixed at the source.
- **Production config added:** `GET /health/db` (a real readiness probe — `SELECT 1`, identical SQL on both dialects,
  distinct from the existing bare liveness `GET /health`, which is unchanged); `app.enableShutdownHooks()` (SIGTERM was
  previously not handled at all — Prisma's `$disconnect()` never ran on a platform-initiated shutdown); env var validation
  was already fail-fast (Phase 0's `parseEnv`, unchanged); CORS's existing "reflect any origin" policy was reviewed and left
  as-is — it's already production-reasoned (bearer JWT auth, no cookies, no ambient credential to leak cross-origin), not an
  oversight to fix.
- **`render.yaml`** — a Render Blueprint, `autoDeploy: false`. No `databases:` block (deliberately: the DB is external
  Supabase, not a Render-managed Postgres). Every reward/promotion/sync/checkout feature flag is explicitly `"false"`.
  `DATABASE_URL` and every secret are `sync: false` (set manually in the Render dashboard, never committed).
- **URL audit:** no hardcoded `localhost`/tunnel URL exists anywhere in application source code (backend or any frontend) —
  everything already goes through env vars (`VITE_API_BASE_URL`, `POS_WIDGET_PUBLIC_URL`, `MINI_APP_URL`, etc.), a Phase 1.7
  convention that already held. Existing `.env.example` files across admin/staff/frontend/pos-widget were left with their
  dev-localhost defaults (never removed, per instruction) and gained a one-line note on the production/build-time behavior.
- **Validation:** `prisma validate` clean for both schemas (re-confirmed after the second pass — no schema/migration changed,
  only application-code SQL); backend `tsc`/build clean; widget `tsc`/build clean; full test suite re-run — same 6
  pre-existing, unrelated failing files as every prior phase's own baseline (none newly broken; neither
  `branch-intelligence` nor `automations` has a dedicated test file, so this pass relied on the same manual real-data
  verification approach as `analytics`/`loyalty2` above).
- **Real environment:** completely untouched. No Supabase project exists yet; no Render service exists yet; the real `.env`
  was not modified; `POS_REWARD_REDEMPTION_ENABLED`/`POS_PROMOTION_REDEMPTION_ENABLED` were not touched.
- **Remaining before deploy:** purely external/manual — create the Supabase project, set the real `DATABASE_URL` (pooled) and
  every `sync: false` secret in Render, connect the repo as a Render Blueprint, run the first deploy. No further code changes
  are anticipated to be blockers.

## Phase 23 — Promotion Redemption: IMPLEMENTED, PARTIALLY BLOCKED (`POS_PROMOTION_REDEMPTION_ENABLED=false`)

`FREE_PRODUCT` and `LOYALTY_POINTS` promotions have a verified-safe Poster mutation path — `FREE_PRODUCT` reuses Phase 22's already-live-verified REST
mechanism exactly; `LOYALTY_POINTS` needs no Poster mutation at all (a pure CUP-side credit). `PERCENT_DISCOUNT`/`FIXED_DISCOUNT` have **no known Poster
mechanism** (re-confirmed by re-reading the full docs mirror specifically for this) and always resolve `FAILED`/`BLOCKED_NO_VERIFIED_POSTER_MUTATION`,
regardless of the flag. Full detail: `docs/PHASE-23-PROMOTIONS.md`, `DECISIONS.md` D23-1..5, `CHANGELOG.md`.

- **Architecture mirrors Phase 22/22.3 exactly** (explicitly requested reuse): a new `PromotionRedemptionAttempt` model (own lifecycle, own
  `redeemedForPosterOrderId` unique backstop for "one promotion per order" — a SEPARATE invariant from Phase 22.3's reward rule, verified by test that
  neither table can see the other), the same three-phase transaction discipline (claim → Poster mutation entirely outside any tx → commit), the same
  Poster-order-identity resolution (widget's claimed order id independently re-verified via REST, never trusted directly).
- **Reuses, not duplicates:** the existing `PromotionEligibilityService` (unmodified) and — notably — the existing `PromotionRedemptionService.redeem()`
  (unmodified, called OUTSIDE any transaction since it isn't transaction-aware and has its own race-safety for `usageLimitPerCustomer` across any
  caller). A new, narrow edge case this reuse introduces: if Poster confirms but `redeem()` then can't commit (a concurrent non-POS redemption exhausted
  the usage limit in that exact gap), the attempt goes to `UNKNOWN` for reconciliation — never `FAILED`, never a faked `REDEEMED`.
- **Widget:** "Promolar" card gains "Qo'llash" per eligible promotion, shown only for the two Poster-mutatable benefit types (never for
  `PERCENT_DISCOUNT`/`FIXED_DISCOUNT`, so the widget never invites a guaranteed-to-fail click) → confirm → applying → success/already-applied/rejected/
  unknown, Uzbek copy as specified. Also fixed a small pre-existing display bug: the benefit-text helper checked `'POINTS'` instead of the real
  `'LOYALTY_POINTS'` value.
- **Admin:** no new UI needed — successful POS-originated redemptions flow through the unmodified `PromotionRedemptionService.redeem()`, so they already
  appear in `PromotionDetailView.tsx`'s existing "Total redemptions" list with zero Admin code changes.
- **Tests (explicitly requested, unlike every earlier Phase 22 pass):** 12 new integration tests + 5 new guard unit tests, all passing. Found and fixed a
  real cross-file test-isolation bug in `test/db-test-helper.ts`'s shared `cleanDatabase()` along the way. Re-ran `reward-redemption-one-per-order.spec.ts`
  unchanged as a regression check — still 9/9. Ran the full suite: same 6 pre-existing, unrelated failing files as before this pass, none touched.
- **Real environment:** untouched. `POS_PROMOTION_REDEMPTION_ENABLED` absent from `.env` (default false); `POS_REWARD_REDEMPTION_ENABLED` left exactly as
  found. No real Poster mutation occurred — the backend was down the entire time this was built.
- **Before going live:** an owner-approved live test of `FREE_PRODUCT` through this specific flow (its underlying mechanism is proven, but not yet
  exercised end-to-end here) on a fresh disposable order, mirroring Phase 22.2's Experiment 4. `PERCENT_DISCOUNT`/`FIXED_DISCOUNT` have no path to
  production without a genuinely new Poster capability appearing — not planned as future work.

## Phase 22.3 — Safety fix: ONE POSTER ORDER = MAXIMUM ONE REWARD REDEMPTION

Real incident (2026-09-22, after go-live): a customer had 10 legitimately-banked "5+1" rewards; 10 sequential clicks on the
SAME Poster order each independently succeeded (each was individually valid — nothing was over-counted or fabricated), giving
away ~10 free drinks on two now-closed real orders. Fixed the same day: a new server-side rule caps redemption to ONE per
Poster order, enforced inside the same short DB transaction that already guards against concurrent same-program attempts, with
a unique-column backstop (`redeemedForPosterOrderId`) at the database level. A customer's other banked rewards are completely
unaffected — this only ever blocks a SECOND redemption on the SAME order. Full detail: `docs/PHASE-22-AUDIT.md`, `DECISIONS.md`
D22-14..18, `CHANGELOG.md`, migration `20260922083012_phase22_2_one_reward_per_poster_order`.

- New failure reason `REWARD_ALREADY_REDEEMED_FOR_ORDER`; widget shows "Bu buyurtma uchun sovg'a allaqachon ishlatilgan." and hides the redeem button for an order once it's known to have used its one reward (cosmetic — the server enforces regardless).
- An `UNKNOWN` Poster result now also blocks further attempts on that SAME order (not just that customer+program) — extends the codebase's existing "never auto-retry an ambiguous result" rule, since an unconfirmed mutation might have actually succeeded.
- 9 new integration tests (`test/integration/reward-redemption-one-per-order.spec.ts`) against the real SQLite test DB, explicitly requested for this pass — all passing, including a genuine concurrent-race test.
- Nothing about the Poster mutation mechanism, reward-earning math, existing balances, or existing redemption records was changed. `POS_REWARD_REDEMPTION_ENABLED` was left exactly as found (still `true` from the earlier go-live approval) — this pass performed no real Poster call at all (the backend was down throughout).
- **Pending:** the backend still needs a restart to load this fix — until then it's running the pre-fix code. Do this before any further real redemption is attempted.

## Bug fix — Poster money was stored 100x too large (2026-09-22, FIXED, DEPLOYED, catalog resynced)

`POSTER_PRICE_UNITS_PER_CUP_UZS` (`src/modules/poster/poster-money.ts`) was `1`; Poster's wire unit is kopecks/tiyin (100 = 1 so'm), so it should be `100`, and now is. Re-verified against the real Poster account: Poster Management shows Cappuccino 250 ml at 24 000.00 СУМ; the live `menu.getProducts`/`dash.getTransaction` raw value is `2400000`; `2400000 / 100 = 24000` matches exactly. This is the single conversion boundary for both catalog product prices and Poster-imported transaction money (verified: no frontend formatter anywhere duplicates the conversion) — one constant change fixes both.

**Real impact so far: none currently visible.** Every `PosterImportedTransaction` row with `status: IMPORTED` (i.e. counted by Analytics/Growth/Loyalty) predates the real catalog and is Phase 9/10 test-era noise (amounts 300–2700, already known to be test data). The three real, new-scale receipts (Poster ids 35/36/37, 2026-09-21) are `UNRESOLVED`/`UNMAPPED_PRODUCT` — for an unrelated, pre-existing reason (see below) — and excluded from all reporting, so nothing live was wrong. No historical `Product.priceMinor` or imported-transaction row was rewritten; the fix only corrects conversions computed from now on.

**Found, not fixed (separate, out of scope):** ~24 products including both Cappuccino sizes fail catalog sync with `Unknown menu_category_id "0"` and are simply absent from `Product` — a category-mapping bug, unrelated to money. Do not resolve/reimport transactions 35/36/37 (or any future `UNMAPPED_PRODUCT` row) until that's fixed; if/when reimported, it must happen AFTER this money fix is deployed or they'll import at the old wrong scale.

**DEPLOYED (2026-09-22):** the real backend on :3000 was (re)started running the corrected code (the previous process had already exited between sessions — nothing was killed) and `POST /catalog/sync` was run against the real DB. Verified: `Product.priceMinor` for Americano 250/350 ml (18 000 / 22 000), Espresso (15 000), Espresso Doppio (20 000) now match Poster's real displayed prices; the catalog API returns the same canonical values; the Mini App's `ProductCard`/`formatSom` and the POS widget's reward-eligible-product rendering both pass the value straight through with no conversion, code-confirmed (Mini App's own UI could not be screenshotted end-to-end — it requires real Telegram `initData` with no dev bypass by design, same long-standing limitation as every prior phase). Cappuccino (Poster ids 37/38) and ~22 other products are still NOT in CUP's catalog at all — pre-existing, unrelated `menu_category_id "0"` mapping bug (see below), not something this fix touches.

## Bug fix — 24 of 29 real products missing from CUP's catalog (2026-09-23, FIXED, code-complete, self-deploys on next Render restart)

Root cause found live: these products (both Cappuccino sizes, Latte, Flat White, Raf, Mocha, Cortado, Iced Americano/Latte, Cold Brew, Affogato, pastries, water, syrup/milk add-ons — 24 of 29 total) all report `menu_category_id: "0"` from `menu.getProducts`. This is not a data error — Poster reports the literal `category_name: "Top screen"` directly on each such product — it is the merchant's own choice to place these on the register's quick-access grid instead of filing them under a category tab. `CatalogService.sync()` treated an unresolvable `menu_category_id` as a skip, so these 24 products were never written to `Product` at all: never importable from a POS receipt, never counted toward any reward, never visible anywhere in CUP.

**Fix:** `catalog.service.ts` now creates a real fallback `Category` row for any `menu_category_id` Poster's own category list doesn't cover, named from the product's own `category_name` field (never invented) — sorted after every real category tab. `poster.types.ts`'s `PosterProduct` gained the `category_name` field this reads. Verified live against the real Poster account and local `dev.db`: all 29/29 products now sync successfully (previously 5/29); both Cappuccino rows land correctly, active, under the new "Top screen" category.

**Continuous sync was already running** (`CatalogSyncJob`, `CATALOG_SYNC_INTERVAL_MS=300000` — every 5 minutes, wired since Phase 0) — this fix needed no new scheduling, only the sync logic itself stopped dropping these products. Once deployed, production self-heals on its next tick with no manual catalog-sync trigger needed.

**Owner decision applied same day:** the owner explicitly chose which of the 24 Top-screen products are real coffee drinks (16 — both Cappuccino sizes, Latte, Flat White, Raf, Mocha, Cortado, iced Americano/Latte, Cold Brew, Espresso Tonic, Affogato, Pourover, guest-variety Espresso, extra Espresso shot) versus not (8 — water, pastries, milk/syrup add-ons). `TOP_SCREEN_COFFEE_PRODUCT_IDS` in `catalog.service.ts` files the 16 explicitly-named Poster product_ids under the real "Кофе" category (posterCategoryId "1") instead of the "Top screen" fallback, so they now count toward the "5+1" reward like every other coffee item; the remaining 8 stay under "Top screen" and do not. Verified live: "Кофе" category now has 20 active products (4 original + 16 newly added), all 29/29 products still sync successfully. Not inferred from names — an explicit, reviewable, owner-approved list.

CUP is a customer ordering / CRM / loyalty / marketing layer on top of Poster POS (Poster stays the operational source of truth
for products, prices, orders). Components:

| Part | Path | Notes |
| --- | --- | --- |
| Backend | `src/` | NestJS + Fastify + Prisma (SQLite `prisma/dev.db`) |
| Customer Mini App | `frontend/` | React + Vite, Telegram Mini App |
| Admin Panel | `admin/` | React + Vite, owner/admin session (`AdminAuthGuard`) |
| Staff Panel | `staff/` | React + Vite, separate staff JWT |
| POS widget | `pos-widget/` | React + Vite, one `bundle.js` for the Poster POS platform (Phase 21); READ-ONLY, holds no secret |

## Phase status

| Phase | Status |
| --- | --- |
| 0 – 11.1 | Complete (see `docs/`). Scanner hardware tests DEFERRED (no device). |
| 11.2 POS import foundation | Implemented; activation controls added in Phase 19; the FIRST real import ran on 2026-09-21 with owner approval (7 receipts). Any further import needs a new approval. |
| 17 Analytics Dashboard V1 | COMPLETE (see below). |
| **11.3 POS → Reward Integration** | **COMPLETE** (see below). The real POS import is still not run, so no real POS purchase feeds rewards yet. |
| **11.4 Unified Customer 360** | **COMPLETE** (see below). |
| **12 Loyalty 2.0** | **COMPLETE** (see below). The program ships **switched OFF**; nothing is earned until an admin enables it. |
| **13 CRM Automation & Customer Engagement** | **COMPLETE** (see below). Ships **OFF** twice over: Admin `crm.automation.enabled` = false AND operator env `CRM_AUTOMATION_SEND_ENABLED` = false. No real Telegram message has ever been sent by it. |
| **14 Referral System** | **COMPLETE** (see below). Ships **OFF** (`referral.enabled` = false): no attribution, no code, no qualification, no reward until an admin enables it. |
| **15 CRM / Growth Intelligence** | **COMPLETE** (see below). Read-only and deterministic: no schema change, nothing stored, nothing sent. |
| **16 Staff Panel 2.0** | **COMPLETE** (see below). A read-only customer-service console; no schema change, no new business action. |
| **18 Branch Intelligence** | **COMPLETE** (see below). A read-only, per-branch view of existing data; no schema change, nothing stored, nothing sent. |
| **19 POS Import Activation & Attribution Data Quality** | **COMPLETE — REAL IMPORT EXECUTED 2026-09-21 (owner-approved): 7 receipts, 8 100 so'm** (see below). Preview -> validate -> review -> confirm -> import is built and verified; no further import runs without a new explicit approval. |
| **20 Poster Webhook Continuous Sync & Reliability** | **COMPLETE — ships OFF** (see below). Poster webhook -> durable queue -> Phase 19 engine, with reconciliation as the safety net. Verified end to end against real Poster on copies; **not yet active in the real environment** (needs the owner's Poster application secret, a stable public URL and `POSTER_SYNC_ENABLED=true`). |
| **21 Poster POS Widget + CUP Operational Integration** | **COMPLETE — built and verified against a local Poster simulator; ships OFF; NOT yet loaded into a real Poster POS** (see below and `docs/PHASE-21-POS-CAPABILITY.md`). Read-only: nothing is ever changed in Poster or CUP by it. Whether ordinary `Poster.makeRequest` calls are signed is the one open, real-POS question. |
| **Admin UI/UX redesign** | **DONE (2026-09-22)** — UI only. The Admin now shares the Mini App design tokens and a component library (`admin/src/ui/`); 20 pages in one navigation; Dashboard / Sales / Continuous Sync / System Health / Errors / Audit / Branch Configuration added from EXISTING endpoints. Verified with stubbed API responses (the admin password was not entered); needs a look with real data after login. |
| **22 Reward & Promotion Redemption** | **AUDIT COMPLETE, BLOCKED — no real mutation, no schema/API/widget change.** `docs/PHASE-22-AUDIT.md`: no documented Poster mechanism is confirmed safe to make a POS order line free. Read-only experiment tooling prepared under `scripts/phase22-experiments/` (not part of the app); one read-only plumbing check run against an already-closed receipt; the real experiments (POS `addProduct` / `setOrderBonus` on an open order, REST visibility delay, REST `addTransactionProduct`) all need the owner to open one unpaid test order and approve each mutating call individually — none has been run. |
| 23+ | Not started. |

## Phase 16 — Staff Panel 2.0: COMPLETE

The Staff Panel is now a **customer service console**: scan (or search) a customer and ONE request returns everything a barista needs — identity, loyalty (legacy + Loyalty 2.0),
reward progress, eligible promotions, referral status, lifecycle / RFM / signals / opportunities and recent CUP + POS activity. It is **read-only and a pure composition layer**: no
schema change, no migration, no business rule recomputed, nothing written except the (de-duplicated) audit row. Poster remains the POS; the browser only talks to CUP.

- **Backend (`src/modules/staff/`):** `StaffProfileService` composes the canonical read models — `LoyaltyService.getAccountSnapshot` (never creates an account), `Loyalty2ProfileService`
  (`{enabled:false}` while off — no level / XP / streak is fabricated), `RewardProgramsService.listForCustomer` (+ new `redemptionSummaryForCustomer`), `PromotionsService.listForCustomer`
  (canonical eligibility), `ReferralsService.getStaffView` (read-only counts + the customer's own status), `GrowthIntelligenceService.getCustomerBlock` (all branches, and a branch-scoped
  copy when a branch scope applies) and the Customer 360 `CustomerActivityService` feed (CUP orders + IMPORTED POS, cursor-paginated).
- **Routes (all StaffAuthGuard):** `GET /staff/customers/by-code/:code/profile?scope=branch|all&branchId=`, `GET /staff/customers/by-code/:code/activity?cursor&limit&scope&branchId`
  (page <= 20), `GET /staff/recent` (this staff member's last 10 customers), and the upgraded `GET /staff/customers/search?query=` (Search 2.0). The Phase 11 routes (`/staff/auth`, `/staff/me`,
  `/by-code/:code` card, `/poster-candidates`, `/poster-link`) are unchanged. Customers are addressed by their PUBLIC loyalty code only.
- **Authorization (unchanged model, extended for scope):** staff session only — customer JWT, admin-panel JWT, wrong-secret, expired, missing and DEACTIVATED-account tokens are all 401; an admin acting in the staff
  panel (staff-audience token, kind ADMIN) is allowed. Branch scope: a branch-assigned staff member defaults to THEIR branch for activity and gets a clearly labelled branch-scoped growth block beside the global one;
  `scope=all` (customer-level view) is allowed; `branchId` may only be their own branch (anything else is **403**); unassigned staff and admin actors may pick a branch; an unknown branch is 400. Customer identity,
  loyalty, rewards, promotions and referral status are global; branch metrics never silently become global (branch rows carry their branch name; unmapped-branch purchases appear only in the all-branches view).
- **Search 2.0:** code, phone (existing "+digits" convention; also 998…, the 9-digit national number, spaces / dashes / brackets), name, Telegram @username; at most 20 rows; each row: name, masked phone,
  code, Loyalty 2.0 level (null while off), lifecycle, last purchase — computed with ONE bulk aggregate for the whole list (no per-row query). Input is capped (3-100 characters).
- **Privacy:** phone masked (+998•••••2233), Telegram username shown, birthday as day + month only, Poster shown only as LINKED / NOT_LINKED; no customer / Telegram / chat / Poster / promotion / program / referral /
  product ids; no CRM internals (segments, campaigns, recommended triggers); referral shows counts only, never invited names or the referrer's name. A malformed, oversized or unknown code is one indistinguishable 404.
- **Audit:** `StaffScanEvent` is reused as-is: a profile view logs `PROFILE_VIEW` (staff, customer, branch, time) at most once per staff + customer per 60 s (a refresh adds nothing); Recent is derived from the
  staff member's own LOOKUP / PROFILE_VIEW events. Nothing sensitive is logged.
- **Staff web app (`staff/`):** hash routes `#/scan` (default, scan-first: camera, hardware scanner, manual code), `#/customers` (Search 2.0), `#/recent`, `#/customer/CUP-XXXXXXXX` with tabs Skaner / Mijozlar / So'nggilar.
  The profile (mobile-first, 2 columns from 700 px): header (name, code + copy, masked phone, Telegram, level + lifecycle badges, Poster state), branch scope switch ("Mening filialim" / "Barcha filiallar"),
  Rewards, Loyalty, Promotions, Customer state (lifecycle, RFM, signals, opportunities, branch box), Recent purchases (source CUP / POS, branch, amount, item lines, "Ko'proq" pagination), Referral and the existing Poster
  mapping. Loading skeleton, 404 (no retry, back to scan), network error (retry; a failed refresh keeps the profile and shows a banner), 401 -> login. The old scan-card component was replaced.
- **Deliberately NOT built:** any balance / points / reward / refund / payment / POS action, manual referrer assignment, customer notes (no existing note model; not added), "open customer QR" (no QR renderer in the Staff app; the
  code is shown and copyable), Poster-id search.
- **Performance (copy DB):** one profile = 91-92 SQL statements at ~60, ~260 and ~5 060 customers (constant — no N+1), 53-63 ms; Search 2.0 at ~5 060 customers: 18 ms; Recent: 4 statements. A segment-targeted promotion now evaluates the
  segment for the ONE customer (`filterCustomersInSegment`, same evaluator, same result) instead of every customer — this was the only cost that grew with the customer base.
- **Verified** on a throw-away copy of the real DB: 57 service-level checks (auth-independent profile shapes for CUP-only / POS-only / mixed / no-purchase / Telegram + Poster-mapped / long-name customers, Loyalty 2.0 ON / OFF /
  legacy, rewards none / progress / available / multiple, promotions eligible / ineligible / expired / inactive / product-based, referral none / attributed / registered / qualified / rewarded, lifecycle NEW / ACTIVE / LOYAL / AT_RISK /
  DORMANT / CHURNED / none, activity mixed / branch-mapped / unmapped / inactive product / zero revenue / pagination, search formats, audit dedupe, Recent, privacy, performance), 20 HTTP / security checks, and the Staff UI
  (mobile 375, tablet 768, desktop pane; no horizontal overflow; long names; empty, loading, error and retry states). Every Telegram Bot API call and Poster request was blocked and counted: 0 attempted. No tests were written or run.
- **Real DB:** unchanged (no migration). Before == after: customers 2, orders 6, orderItems 12, loyaltyTransactions 2 (balance sum 150), rewardRedemptions 0, rewardPrograms 0, posterImportedTransactions 0, referrals 0,
  referralRewards 0, staff_scan_events 8. No authenticated Staff call was made against the real DB (a view writes an audit row); the real backend was only restarted and probed unauthenticated (401).

## Phase 15 — CRM / Growth Intelligence: COMPLETE

A deterministic, explainable layer over the canonical purchases: RFM scores, lifecycle states, growth signals and opportunities. **No AI, no prediction, no
model, no cache, no new table, no migration.** Module `src/modules/growth-intelligence/`; Admin page "Growth Intelligence"; Customer 360 `growth` block;
compact "Lifecycle · RFM" column in the Customers list; growth fields in Segments; read-only CRM trigger candidates. It sends nothing and writes nothing.

- **One calculation.** `GrowthIntelligenceRepository.aggregates` is the ONLY purchase aggregate: a single bulk SQL pass (CTE + window functions) over qualifying CUP
  orders (`CUSTOMER_METRICS_ORDER_STATUSES`, by createdAt / branchId) UNION IMPORTED POS purchases (by occurredAt / branchId) -> one row per purchasing customer
  (lifetime purchases + revenue, first / second / last purchase, the moment lifetime revenue first reached the high-value threshold, lookback purchases + revenue).
  pending / failed / cancelled / uncertain / unresolved / non-IMPORTED rows never count (same predicates as Loyalty 2.0, Analytics V1, Customer 360). Every consumer
  (dashboard, Customer 360, list, Segments, candidates) calls `GrowthIntelligenceService`, so the definitions cannot drift; verified equal to Customer 360's own unified
  summary and to Analytics V1 (revenue and customer counts, all branches and per branch).
- **RFM.** Recency = business-local calendar days since the last qualifying purchase (a same-day purchase is 0). Frequency = qualifying purchases and Monetary =
  qualifying revenue INSIDE the lookback (default 90 days; the Admin period filter 7 / 30 / 90 / 365 / custom overrides it per view). Scores 1-5 use absolute,
  configurable boundaries (no percentiles): recency <= 7 / 14 / 30 / 60 days -> 5 / 4 / 3 / 2 else 1; frequency >= 2 / 3 / 5 / 8 -> 2..5; monetary >= 50 000 / 150 000 /
  300 000 / 600 000 so'm -> 2..5. `rfmScore` is the three digits ("543"); `rfmTotal` = R+F+M (3-15). Descriptive, never predictive.
- **Lifecycle (explicit precedence, first match wins; "beyond" = strictly more days):** CHURNED (days since last purchase > churnDays 180) -> DORMANT (> dormantDays 90) ->
  AT_RISK (> activeDays 30) -> NEW (first purchase within newDays 14) -> LOYAL (lifetime purchases >= 5 and lifetime revenue >= loyalMinRevenue 0) -> ACTIVE. A customer with no
  qualifying purchase has NO state (reported as "no purchase yet"). Boundaries verified exactly (activeDays 14: 14 ACTIVE / 15 AT_RISK; churnDays 60: 60 DORMANT / 61 CHURNED).
  "Active customers" (KPI) = NEW + ACTIVE + LOYAL. Lifecycle always uses the current date, not the period filter.
- **Thresholds** are Admin configuration (`growth.*` settings, Admin > Growth Intelligence > Edit thresholds): lookbackDays, the three 4-value boundary lists, newDays,
  activeDays, dormantDays, churnDays, loyalMinPurchases, loyalMinRevenue, highValueRevenue (1 000 000 so'm), risingDays, secondPurchaseDueDays, signalWindowDays,
  birthdayLookaheadDays, upgradeProximityPercent. The server validates the whole set (ranges, strictly ascending boundaries, newDays <= activeDays < dormantDays < churnDays).
  The defaults are STARTING values that only decide how customers are labelled; review them against the real menu prices and visit frequency.
- **Business timezone / branch.** Day arithmetic uses BUSINESS_TIMEZONE_OFFSET_MINUTES (fixed offset, as Analytics). A branch view uses ONLY purchases at that branch
  (CUP Order.branchId, POS branchId — never inferred): recency, lifecycle and lifetime figures are then branch-scoped; a customer whose activity has no mapped branch is
  counted in "All branches" and excluded from every specific branch view (`totalCustomers` / `neverPurchased` are not shown per branch).
- **Signals (derived, not stored):** FIRST_PURCHASE, SECOND_PURCHASE, HIGH_VALUE_CUSTOMER, RISING_CUSTOMER (crossed the high-value threshold within risingDays), AT_RISK,
  DORMANT, CHURNED, REWARD_AVAILABLE (bulk, through RewardProgressService math), REFERRAL_SUCCESS, LOYALTY_LEVEL_UP (only while Loyalty 2.0 is on), BIRTHDAY_UPCOMING. Each has
  a type, a deterministic key (customer + the event / period: e.g. `dormant:{c}:{lastPurchaseDay}`, `referral:{id}`, `level:{c}:{code}`, `birthday:{c}:{year}`), a detectedAt
  (when the condition became true where the data records it; null for REWARD_AVAILABLE) and a reason. Severity is a fixed property of the type: INFO (first / second purchase,
  level-up, referral success), OPPORTUNITY (high-value, rising, reward available, birthday), ATTENTION (at risk, dormant, churned). Repeated evaluation gives identical output.
- **Opportunities (fixed rule table; priority is the rule's output, not an opinion):** WIN_BACK (HIGH if high-value and AT_RISK/DORMANT, MEDIUM otherwise, LOW if CHURNED),
  SECOND_PURCHASE (MEDIUM once secondPurchaseDueDays passed, else LOW), REWARD_REDEMPTION (HIGH if inactive, else MEDIUM), VIP_RETENTION (MEDIUM if rising, else LOW),
  BIRTHDAY (MEDIUM), LOYALTY_UPGRADE (MEDIUM; within upgradeProximityPercent of the next level, Loyalty 2.0 on), REFERRAL (LOW; loyal customer, referral program on). Each carries a
  reason and the EXISTING Segment definition / Phase 13 trigger type that fits (a recommendation only — nothing is created or activated).
- **Segments:** the allowlist gains lifecycleState, rfmScore, rfmTotal, recency/frequency/monetary scores, recencyDays, daysSinceLastPurchase, daysSinceFirstPurchase, frequency,
  monetary, lifetimeRevenue, lifetimePurchases and growthSignal (equals = has the signal, not_equals = does not). Growth data is loaded ONLY when a segment uses one of these fields
  (one bulk aggregate for the id set); existing segments are unchanged and cost the same. A customer with no purchase has null growth data and never satisfies a growth condition
  (not even not_equals) — the existing null rule. Segment growth fields use all branches and the configured default lookback. Evaluation stays dynamic (no static lists).
- **CRM foundation (read-only):** `GET /admin/growth/candidates?type=CUSTOMER_AT_RISK|CUSTOMER_DORMANT|CUSTOMER_HIGH_VALUE|CUSTOMER_SECOND_PURCHASE_DUE|CUSTOMER_BIRTHDAY_UPCOMING`
  (bounded, cursor-paginated) lists who currently meets each rule with a deterministic id-free event key; `GrowthIntelligenceService.candidates(..., { internal: true })` gives a future
  Phase 13 trigger the real key + customer id. Nothing is queued, no automation is created or activated, and the Phase 13 safety gates are untouched.
- **Admin API (AdminAuthGuard only, read-only except the thresholds):** `GET|PATCH /admin/growth/settings`, `GET /admin/growth/branches`, `GET /admin/growth/overview`
  (period, from/to, branchId), `GET /admin/growth/candidates`. Customer / staff / missing / invalid tokens -> 401. Responses carry no customer ids, Telegram ids, phones or Poster ids.
- **Dashboard:** 12 KPIs, lifecycle distribution, RFM matrix + score histograms + most common scores, signal counts + latest feed, opportunity counts by priority + top list, and top
  high-value / at-risk / new / rising customers (names only), plus the editable thresholds. Customer 360 adds a "Growth Intelligence" card (lifecycle, RFM, last purchase, purchases,
  revenue, signals, opportunities); the Customers list adds one compact "Lifecycle · RFM" column (tooltip: last purchase, purchases, revenue) from ONE aggregate query per page.
- **Performance / caching:** one aggregate query for the whole dashboard whatever the customer count (17 -> 21 SQL statements from ~200 to ~5 200 customers; the only growth is one
  grouped reward query per 5 000 ids); 183 ms for ~5 200 customers, 246 ms for a growth segment over them. No cache was introduced: it was not needed.
- **Verified** on a throw-away copy of the real DB: 70 backend checks (scenarios A-E, mixed CUP + POS, branch filtering, exact boundaries, edge cases, an independent per-customer
  recomputation oracle for All / each branch, Analytics parity, Customer 360 parity, signals, opportunities, segments, performance), 24 HTTP / security checks, and the Admin UI.
  Every Telegram Bot API call and Poster request was blocked and counted: 0 attempted. No tests were written or run.
- **Real DB:** untouched (no migration in this phase). Before == after: customers 2, orders 6, orderItems 12, loyaltyTransactions 2 (balance sum 150), rewardRedemptions 0,
  rewardPrograms 0, posterImportedTransactions 0, referrals 0, referralRewards 0, automations 0; no `growth.*` settings; CRM automation still OFF. A read-only overview on the
  real data reports 2 customers, both NEW.

## Phase 14 — Referral System: COMPLETE

Module `src/modules/referrals/`; Admin page "Referrals"; Mini App "Do'stingizni taklif qiling" (Account); Customer 360 "Referrals" block; Telegram
`/start ref_<code>` attribution. **Off by default** (`referral.enabled` = false).

- **Flow:** referrer opens the Mini App -> gets a public code + link -> shares it (Telegram share dialog, always a deliberate tap) -> the friend taps
  `https://t.me/<bot>?start=ref_<code>` -> attribution row (ATTRIBUTED, or REGISTERED for an already-registered customer) -> the friend shares a phone
  (REGISTERED) -> the friend's first qualifying purchase (CUP order OR imported POS) -> QUALIFIED -> rewards -> REWARDED.
- **Schema (additive migration `20260921125905_phase14_referrals`: ALTER TABLE ADD COLUMN on the empty Phase 12 `referrals` table, 2 CREATE TABLE, indexes;
  nothing rebuilt or dropped):** `referrals` extended (referralCode, attributedAt, registeredAt, qualifiedAt, rewardedAt, closedAt, closeReason,
  qualifyingPurchaseKey, qualifyingAmountMinor, checkedAt, updatedAt; indexes on status, createdAt, (status, checkedAt), referrer), `referral_codes`
  (customerId unique, code unique), `referral_rewards` (unique (referralId, beneficiary); unique (customerId, beneficiary, ordinal); loyaltyTransactionId unique).
- **Code:** `REF-XXXXXXXX` (only the 8-char body is stored/in the link), `crypto.randomInt`, alphabet without 0/1/I/L/O, unique in the DB, independent of
  customer id / Telegram id / phone / Poster id. It is NOT the loyalty code (that one is scanned by staff at the till and must never be shared). Created lazily
  the first time a registered customer opens the section while the program is on (no backfill; the real DB has none).
- **Link:** `https://t.me/<bot>?start=ref_<body>`. The username is never hardcoded: optional env `TELEGRAM_BOT_USERNAME` wins, otherwise the username the bot
  reports when it starts polling is pushed into `ReferralBotIdentityService` (no Telegram API call from referrals). Null link -> the Mini App shows the code only.
- **Attribution (first valid wins, DB-enforced by unique referredCustomerId):** rejected (no row, silent) for: program off, malformed/unknown code, own code
  (SELF_REFERRAL), already attributed (repeat /start, another code, concurrent attempts), friend already has a qualifying purchase (ALREADY_PURCHASED — no
  retroactive rewards), circular (the referrer was invited by the friend). Rows are written ONLY for a valid attribution — never for a click. `/start` replies are
  unchanged; attribution never throws; logs carry the outcome only.
- **Qualification (`decideReferral`, pure):** purchases = the ONE canonical qualifying-purchase list (Loyalty2Repository: CUP orders in
  CUSTOMER_METRICS_ORDER_STATUSES + POS status IMPORTED; pending / failed / cancelled / uncertain / unresolved / non-IMPORTED never count). Rules: a purchase
  BEFORE attribution closes the referral REJECTED (PRIOR_PURCHASE); effective minimum = max(1, minimumPurchaseAmount); first-purchase-only ON: the friend's first
  purchase must meet the minimum else REJECTED (FIRST_PURCHASE_BELOW_MINIMUM); OFF: the earliest purchase meeting the minimum qualifies; the window applies to the
  PURCHASE time (an in-window purchase processed late still qualifies); nothing qualifying after the window -> EXPIRED (kept, not deleted). **attributionWindowDays =
  0 means the attribution never expires.**
- **Rewards:** POINTS only, through the existing `LoyaltyService.creditPointsTx` (EARN ledger row; creditPointsTx now returns the ledger id). The claim row
  (`ReferralReward`) is inserted BEFORE the credit in ONE transaction; the unique (referralId, beneficiary) makes each reward exactly-once; a lost race rolls back that
  whole transaction and retries find the winner. `ReferralReward` rows (GRANTED / SKIPPED + reason) are the independent proof; `Referral.status` is a projection
  (REWARDED = at least one GRANTED). `maxSuccessfulReferrals` (0 = unlimited): the referrer's GRANTED rewards are numbered 1..N under a unique (customer, beneficiary, ordinal),
  so the cap holds across concurrent DIFFERENT referrals; a capped referrer gets a SKIPPED row (MAX_REFERRALS_REACHED) while the friend is still rewarded.
- **Runner:** `REFERRAL_RUN_INTERVAL_MS` (default 60 000; no-op while OFF; never overlaps; bounded batch of 100, least-recently-checked first, two bulk queries + one
  touch per tick). A reconciler finishes QUALIFIED referrals whose reward step was lost. No Poster call, no import, no Telegram call.
- **Config (Admin › Referrals, `referral.*` settings):** enabled (false), referrerRewardType/Value (POINTS, 100), referredRewardType/Value (POINTS, 50),
  minimumPurchaseAmount (0), rewardOnFirstPurchaseOnly (true), maxSuccessfulReferrals (10), attributionWindowDays (30). CASHBACK is refused by the server until integrated.
  The reward values are editable STARTING values (the spec's example) — the owner must review them before enabling.
- **APIs:** customer `GET /referrals` (code, link, successfulReferrals, pendingReferrals, totalRewardsEarned, reward config, limitReached, myReferral),
  `GET /referrals/history` (bounded cursor; status / dates / points only — no friend names); admin `GET|PATCH /admin/referrals/settings`, `GET /admin/referrals/summary`,
  `GET /admin/referrals` (filters status, referrer name/code, referred name, dates), `GET /admin/referrals/:id`. NO write route exists for referrals, statuses, rewards or
  qualification (customer or admin). Customer JWT only on customer routes, AdminAuthGuard only on admin routes; staff / customer / missing / invalid tokens -> 401.
- **CRM events (for later):** `ReferralEventsService` derives REFERRAL_ATTRIBUTED / REGISTERED / QUALIFIED / REWARDED from the lifecycle timestamps (same "derived stream + cursor"
  model as Phase 13; key `referral:{id}:{TYPE}`). Nothing consumes them yet and nothing is sent from referrals.
- **Verified** on a throw-away copy of the real DB (migration deployed onto it first): 67 backend checks (all 22 required scenarios incl. concurrency: 3 simultaneous
  qualification runs -> 1 transition; 3 simultaneous reward attempts -> 1 reward per beneficiary; 4 simultaneous attributions -> 1; 3 different codes at once -> 1, stays;
  cap 2 with 4 simultaneous qualifiers -> exactly 2 referrer rewards), 28 HTTP/security checks, Admin and Mini App UI interactions. Every Telegram Bot API call and
  every Poster request was blocked and counted: 0 attempted. Detection cost is constant (9 SQL statements for 5 and for 60 candidates). No tests were written or run.
- **Real DB after deploy:** existing counts identical to the baseline (customers 2, orders 6, orderItems 12, loyaltyTransactions 2 / balance sum 150, rewardRedemptions 0,
  rewardPrograms 0, posterImportedTransactions 0); `referrals`, `referral_codes`, `referral_rewards` empty; no `referral.*` settings (program OFF). Backup
  `prisma/dev.db.pre-phase14.bak` (owner may delete).
- **IMPORTANT for the owner before enabling:** review the reward values (100 / 50 points; the existing earn rule is 1 point per 1 000 so'm), the cap (10) and the window
  (30 days); switch `referral.enabled` on in Admin › Referrals; test with two owner-controlled Telegram accounts first (the real `/start ref_` path through the live bot has
  only been exercised with a simulated update). The legacy `loyalty2.referralEnabled` flag is no longer consulted.

## Phase 13 — CRM Automation & Customer Engagement: COMPLETE

A generic automation layer ABOVE the existing Campaign engine (no second campaign engine): customer behaviour -> trigger -> audience/segment ->
eligibility -> cooldown/frequency -> Campaign -> Telegram -> delivery tracking. Module `src/modules/automations/`; Admin page "CRM Automation";
Customer 360 "CRM automation activity". **Off by default, two independent gates** (see below).

- **Model:** `Automation` (WHEN / WHY / WHO / HOW OFTEN: status DRAFT|ACTIVE|PAUSED|ARCHIVED, triggerType, strictly validated JSON config, campaign,
  optional segment, cooldownHours, maxSendsPerCustomer, activatedAt, per-automation eventCursor + lastRunKey, lastRunAt). The `Campaign` supplies WHAT
  message / WHICH channel only (ready = status draft|completed, telegram, non-blank text, no unknown variables). Tables: `automations`,
  `automation_executions` (decision record + queue: PENDING/SKIPPED/SENT/FAILED, unique automation+triggerKey), `automation_send_slots` (cooldown +
  frequency ledger), `crm_daily_slots` (daily cap ledger). Migration `20260921115933_phase13_crm_automation` is purely additive (4 CREATE TABLE).
- **Triggers (allowlist, structured config, no free-form rules/scripts):** FIRST_PURCHASE, REWARD_UNLOCKED, BIRTHDAY, INACTIVE_CUSTOMER, ABANDONED_CART,
  LOYALTY_MILESTONE, SCHEDULED_SEGMENT. Deterministic idempotent keys: `first-purchase:{c}`, `birthday:{c}:{year}`, `reward:{c}:{program}:{index}`,
  `inactive:{c}:{period}`, `milestone:{c}:{metric}:{threshold}`, `cart:{c}:{cartId}:{version}`, `scheduled:{automation}:{runKey}:{c}`.
- **Events:** no queue/Kafka/Redis. A PURCHASE_COMPLETED stream is derived from the canonical tables (qualifying CUP orders + IMPORTED POS rows; keys
  `CUP:{orderId}` / `POS:{txId}`), read with a per-automation cursor. Detection is read-only and bounded (batches, time-bounded bulk aggregates).
- **Guards, in order:** Telegram account (else SKIPPED `NO_TELEGRAM_ACCOUNT`) -> segment -> cooldown -> frequency cap -> global daily cap (default 3/day)
  -> quiet hours (default 21:00-09:00 business time; a send is DEFERRED to the end of the window, not discarded). Cooldown / frequency / daily cap are
  enforced by unique reservation rows inserted in one transaction, so concurrent runners cannot exceed them.
- **Gates:** Admin setting `crm.automation.enabled` (default false; stamps `enabledAtMs` on every off->on so nothing earlier can fire) AND env
  `CRM_AUTOMATION_SEND_ENABLED` (default false; read-only in Admin; re-checked right before the transport call). With either closed the runner neither
  detects, queues nor sends. Dry-run **Preview** ("Preview — xabar yuborilmaydi") always works and writes nothing.
- **Runner:** interval `AUTOMATION_RUN_INTERVAL_MS` (default 60000, registered on the SchedulerRegistry as `crm-automation-runner`), batch size 100, guarded
  against overlap; logs counts only (no personal data). Watermark = max(activation, CRM-enable time, now - `maxEventAgeHours` (72)): activating never
  mass-sends history.
- **Personalisation:** allowlist `{{firstName}} {{displayName}} {{points}} {{rewardCount}} {{rewardProgress}} {{level}} {{branchName}}`, resolved server-side
  only for variables present; unknown variables are rejected when an automation is created/activated.
- **Admin API (AdminAuthGuard only):** `GET|PATCH /admin/crm/settings`, `GET /admin/crm/automations/meta`, `GET|POST /admin/crm/automations`,
  `GET|PATCH /admin/crm/automations/:id`, `POST .../:id/activate|pause|archive|preview`, `GET .../:id/executions`. No delete route, no "send now" route.
  Customer / staff / missing / invalid tokens -> 401. An ACTIVE automation cannot change trigger/campaign/segment (409); ARCHIVED is immutable.
- **Settings (Admin):** enabled, daily limit, quiet hours, batch size, run interval, default cooldown, default max sends, max event age.
- **Reused (not duplicated):** CampaignsModule (+ new `CampaignMessagingService.deliver`, same 429/uncertain policy as manual sends), SegmentsService
  (new batch `filterCustomersInSegment`), TelegramMessagingService/TelegramBotService, CustomerMetricsService, RewardProgressRepository (new bulk
  `sumQualifyingQuantityForCustomers`), Loyalty2 profile, Loyalty, RewardPrograms.
- **Verified** on a throw-away copy of the real DB (migration deployed onto it first) with a stub Telegram transport: 85 backend checks covering the 18
  required scenarios (all 7 triggers, idempotency, cooldown, frequency, daily cap, quiet-hours deferral, no-Telegram skip, gates, concurrency — 6
  concurrent processors -> exactly 1 send under a 24 h cooldown; 8 -> exactly 3 under max 3 / daily 3; performance: detection + eligibility = 8 SQL
  statements for both 5 and 65 candidates), 17 HTTP/security checks, and the Admin UI (list, create with server validation, detail + preview,
  Customer 360 block, 768 px). Zero real bot calls, zero Poster calls. No tests were written or run (standing rule).
- **Real DB after deploy:** all existing counts identical to the baseline (customers 2, orders 6, orderItems 12, loyaltyTransactions 2 / balance sum 150,
  rewardRedemptions 0, rewardPrograms 0, posterImportedTransactions 0); the four new tables are empty; no `crm.automation.*` settings (CRM off);
  `CRM_AUTOMATION_SEND_ENABLED` is absent from the real `.env` (closed). Backup `prisma/dev.db.pre-phase13.bak` (owner may delete).
- **IMPORTANT for the owner before enabling:** (1) create a Campaign whose text uses only allowlisted variables; (2) create the automation as DRAFT and
  run Preview; (3) switch `crm.automation.enabled` on in Admin; (4) set `CRM_AUTOMATION_SEND_ENABLED=true` in `.env` and restart the backend.
  Real Telegram delivery through this layer has never been exercised (stub only): test with one owner-controlled customer first.

## Phase 12 — Loyalty 2.0 (Gamification & Wallet): COMPLETE

Layered ON TOP of the existing loyalty / reward / promotion engines (all preserved). Module `src/modules/loyalty2/`; admin page "Loyalty 2.0";
Mini App account loyalty view; Customer 360 `membership` block. **Off by default** (`loyalty2.enabled` = false): while off, the customer
endpoint reports `{enabled:false}`, the Mini App shows the old points section, nothing is written.

- **Derived (never stored, never assigned):** membership level (highest active level whose `minLifetimeSpend` <= lifetime spend), XP
  (`xpRate` XP per `xpUnitAmount` so'm, default 1:1, floored), XP progress (levelXP / nextLevelXP), visit streak (distinct business days
  with a qualifying purchase; same day = no increment, next day +1, a skipped day resets; current is alive only if the last visit was today
  or yesterday; best is kept), achievement progress, birthday eligibility, cashback wallet (aggregate of its ledger).
- **Persisted, exactly-once (unique constraints):** `LoyaltyAccrual` (one per qualifying purchase, snapshot of level/rates), `CashbackTransaction`
  (EARN, unique per purchase), `LoyaltyLevelUp`, `CustomerAchievement`, `BirthdayRewardClaim` (foundation), `Referral` (foundation, unused).
- **Purchases** = the Phase 5 / Analytics V1 definition (qualifying CUP orders + IMPORTED POS), so unified metrics are kept.
- **Sync** (`Loyalty2SyncService.syncCustomer`, idempotent): accrual (cashback at the level in force BEFORE the purchase; optional purchase
  points via the EXISTING earn rate x level multiplier, through `LoyaltyService.creditPointsTx`), level-up events (dated at the crossing
  purchase), achievement unlocks (+ reward points, once). Triggered lazily by `GET /loyalty/overview` and by a background job
  (`LOYALTY2_SYNC_INTERVAL_MS`, default 120 s; a no-op while off). Customer 360 and every read never sync.
- **Accrual start:** purchases before `accrualStartsAt` (stamped when the program is first enabled) never earn cashback/points; level/XP use
  the full history. Rules are snapshotted: turning cashback on later does not credit purchases already processed.
- **Config (Admin):** program switch, XP rate/unit, cashback switch (percent per level), purchase-points switch (+ the existing earn rate),
  streak, birthday (points, window), referral flag; 4 seeded editable levels (BRONZE 0 / SILVER 500 000 / GOLD 2 000 000 / BLACK 5 000 000 so'm) and
  9 seeded achievements (all reward 0 points; the coffee ones start inactive until an admin picks a category).
- **API:** customer `GET /loyalty/overview`, `GET /loyalty/history` (cursor, default 10 / max 20), `PUT /loyalty/birthday` (set once);
  admin `GET|PATCH /admin/loyalty2/settings`, `GET|PUT /admin/loyalty2/levels`, `GET|POST /admin/loyalty2/achievements`, `PATCH .../:id`.
  Existing `GET /loyalty`, `/loyalty/rewards`, `/loyalty/transactions` are unchanged. Customer JWT only on customer routes, admin session only on
  admin routes, staff has no access (verified 401 for every other token kind).
- **Verified** on a throw-away copy of the real DB (the migration was deployed onto it first): 62 backend checks, 27 HTTP/security checks, and the
  Admin, Mini App and Customer 360 UIs. Real DB after deploy: existing counts identical, new tables hold only the seeded 4 levels / 9 achievements,
  0 accruals / cashback / unlocks / level-ups / claims, no `loyalty2.*` settings (program off). No tests written or run.
- **IMPORTANT for the owner before enabling:** the existing points rule in the real DB is already enabled at 1 point per 1 000 so'm, so switching
  "Earn loyalty points on purchases" on will start crediting purchase points (x level multiplier); it is a separate switch from the master switch on
  purpose. The default cashback rates (1 / 2 / 3 / 5 %) are only starting values; review them first.
- **Limitations:** no refund reversal (Poster refund behaviour is unverified; a refunded purchase keeps its cashback/points/achievements/level);
  cashback spending is not integrated (earning only; a SPEND ledger type is reserved); the birthday reward is eligibility only (the once-a-year claim
  is an internal service method with no route, and a customer cannot change a birthday once set); referral is schema + flag only; a streak "visit" is a
  qualifying purchase (no other visit signal); `pending` orders never qualify (existing behaviour); re-enabling after a pause keeps the original
  accrual start (purchases made while paused accrue); there are no Loyalty 2.0 segments or analytics yet.

## Phase 11.4 — Unified Customer 360: COMPLETE

Admin Customer 360 (`GET /admin/customers/:id`) is now a unified profile. All existing fields are kept (`metrics`, `activity`,
`favoriteBranch`, `recentOrders`, `recentPosPurchases`, `loyalty`, `rewards`, `identity` keep their CUP-only / POS-only meaning); the
additive fields are `summary`, `loyalty.recent`, `rewardHistory`, `promotions`, `segments`, `recentActivity`.
- `summary` = qualifying CUP orders (statuses in `CUSTOMER_METRICS_ORDER_STATUSES`) + IMPORTED POS purchases (Analytics V1 rules):
  totalPurchases, totalRevenueMinor, averageCheckMinor (rounded), first/last purchase, CUP and POS counts/revenue, unified
  favorite branch (highest combined count, ties → most recent), activeRewardCount, loyaltyBalance, promotionCount.
  Composition is the pure `customer-summary.ts`; CUP figures come from `CustomerMetricsService.getSummaryForCustomer` (bounded
  aggregates, same definitions), POS figures from `PosterImportedActivityService`.
- `GET /admin/customers/:id/activity?cursor&limit&filter=purchases|all` — cursor-paginated merged feed (CUP orders, POS purchases;
  `all` adds loyalty ledger rows and reward redemptions). Default 10, max 20. Global order = time DESC, kind rank ASC, id DESC;
  each source is fetched at most `limit+1` rows after the cursor in the database, merged and cut; the cursor is opaque and
  malformed cursors are 400. No ids in items.
- Reused, not re-implemented: `RewardProgramsService.listForCustomer` (RewardProgressService), `LoyaltyService`
  (`getAccountSnapshot`, `listTransactions`), `PromotionsService.listForCustomer` (read-only), `SegmentsService.listMatchingForCustomer`
  (new single-customer entry point that runs the existing evaluator; nothing stored).
- `profile.phone` is masked (`+998•••••0511`); Telegram/Poster/internal ids, tokens are never returned (`identity.posterLinked` flag only).
- UI: rebuilt `CustomerDetailView` (header, KPI cards, Total/CUP/POS breakdown, loyalty, rewards + progress, recent activity,
  paginated purchase table, loyalty activity, promotions, segments, identity). Friendly Uzbek errors + Retry, Uzbek empty states,
  no stale figures on customer change; verified at 1280 / 1024 / 768 (no horizontal overflow; the table scrolls in its wrapper).
- Verified on a throw-away DB copy (real Poster receipts imported into the COPY only, plus an 800-purchase synthetic customer):
  spec scenario 10 purchases / 30 500 so'm / average 3 050 (CUP 4 / 23 900, POS 6 / 6 600); exact global order and no
  duplicates/skips for page sizes 7/10/20 over 800 and 920 rows; stable cursor when newer rows arrive; 40 SQL statements for an
  11-purchase and an 800-purchase customer alike (13 per activity page); zero Poster calls; 401 for no/customer/staff/invalid/
  wrong-secret tokens; 400 bad cursor/filter; 404 unknown customer; a `customerId` query parameter cannot redirect the lookup.
- Real DB unchanged (customers 2, orders 6, orderItems 12, loyaltyTransactions 2, rewardRedemptions 0, rewardPrograms 0,
  posterImportedTransactions 0). No tests written or run.
- Limitations: segment membership is order-derived CUP metrics (Phase 5 semantics), so POS purchases do not yet influence
  segments; `PromotionsService.listForCustomer` evaluates segment-restricted promotions with the existing full-audience path
  (cost grows with customers × active promotions, existing design); the legacy `recentOrders[].id` still carries the order id
  (kept for compatibility, the redesigned UI does not use it); the Customers list still shows full phone numbers (search is by phone).

## Phase 11.3 — POS → Reward Integration: COMPLETE

Imported Poster POS purchases now count toward the SAME reward progress as CUP orders — one purchase history, one balance, no
second engine. The only calculation change is in `RewardProgressRepository.sumQualifyingQuantityWith`:
`qualifying units = qualifying CUP paid units + qualifying imported POS paid units` (two bounded local aggregate queries, run
together). `RewardProgressService` (X+Y math), `RewardEligibilityService`, `RewardRedemptionService` (incl. its in-transaction
re-check), `GET /loyalty/rewards` and the Mini App UI are unchanged and pick it up automatically.

What counts as a qualifying POS unit (all must hold, read from the canonical import tables, never from Poster):
- `PosterImportedTransaction.status = 'IMPORTED'` (the only Phase 11.2 state meaning "closed, paid, fully resolved, customer +
  branch mapped, not CUP-originated") and `paidMinor > 0`;
- `customerId` = the customer recorded at import through `client_id → Customer.posterClientId` (never overwritten later);
- line `productId` mapped (`Product.posterProductId`) and `Product.categoryId` = the RewardProgram's configured qualifying category;
- whole-number `quantity > 0` and line `posterPayedSumMinor > 0` (a line Poster reports as paid 0 is not counted).
Never counted: UNRESOLVED / skipped / unpaid / unlinked-client / unmapped-branch receipts, CUP-originated receipts, unmapped or
non-qualifying products, reward items (CUP `isRewardItem`), cancelled / failed / uncertain / pending CUP orders.

Duplicates: `posterTransactionId` is unique, so one Poster receipt is one row and contributes once (proved incl. concurrent and
direct duplicate inserts). No branch filter (rewards are per customer) and no date filter (same as the CUP side); product
`isActive` is not filtered (historical purchases keep counting, same as CUP).

Also changed: Admin Customer 360 gained an additive `rewards` block (`programName, threshold, qualifyingCount,
availableRewards`) from the same `RewardProgramsService.listForCustomer`, and its Activity note now says POS purchases count toward
rewards (they add no loyalty points). No schema change, no migration, no new endpoint, no new service.

Verified on a throw-away DB copy only (41 manual checks + HTTP): CUP 3 + POS 2 → 0/5, 1 reward; POS +1 → 1/5; CUP +4 → 2
rewards; redeem → 1; +5 POS → 2; mixed 2 CUP + 3 POS cappuccino → 1 reward and Borjomi changes nothing; every exclusion above;
concurrent redemption consumes one credit exactly once; 3 queries per progress calculation even with 200 imported receipts; zero
Poster calls. Real DB unchanged (posterImportedTransactions 0, rewardPrograms 0, rewardRedemptions 0). No tests written or run.

**Refund / return limitation (unchanged and now more important):** Poster refund/return behaviour is NOT verified. Imported POS
rows are treated as finalized sales; nothing subtracts a POS purchase, no negative reward transaction exists, and no Poster
status is assumed to mean "reversed". If a POS sale that already earned a reward is later refunded in Poster, CUP will not
notice. Do not run the real import for reward purposes until that is understood.

**Real import still owed:** the 6 previewed real transactions (Poster tx 11, 21, 22, 23, 28, 30) remain unimported, and no reward
program exists in the real DB, so no real customer has POS-derived reward progress. Creating a program and running the import both
need the owner's explicit approval.

Residual double-count risk (Phase 11.2, unverified): a CUP-created order whose receipt link (`incoming_order.transaction_id`) is
not yet reported when the import runs could be imported as a POS sale as well as counted as a CUP order. The import's
`POSTER_IMPORT_SETTLE_SECONDS` delay and fresh link lookup reduce this; the timing of `transaction_id` is still unverified.

## Phase 22 — Reward Redemption: IMPLEMENTED, MUTATION VERIFIED LIVE, SHIPS OFF PENDING OWNER GO-LIVE

The barista-facing "redeem the customer's free coffee onto the current Poster order" flow is fully implemented, including the one piece Phase 22's first pass couldn't do — making the reward product free on the real, currently open Poster POS order. A verified-safe mechanism now exists and is wired in; `POS_REWARD_REDEMPTION_ENABLED` still stays `false` until the owner explicitly authorizes going live (a separate decision from "it works").

- **Model** `RewardRedemptionAttempt` (`reward_redemption_attempts`, migration `20260922032032_phase22_reward_redemption_attempts`, additive): the POS-originated attempt lifecycle (REQUESTED → POSTER_MUTATING → FAILED / UNKNOWN / REDEEMED), kept deliberately separate from the CUP-order-only `RewardRedemption`/`orderId` (never repurposed for a Poster order id). Unique on `attemptId` (idempotent replay) and on `redemptionId`.
- **Endpoint** `POST /pos-widget/rewards/redeem` (`src/modules/pos-widget/`): re-resolves customer / program / product from Poster-supplied ids server-side (never trusts the widget), re-checks eligibility through the existing `RewardEligibilityService` (no second engine), rejects a second concurrent in-flight attempt for the same customer+program, then mutates the real order (below). Guarded by `PosRewardRedemptionGuard`: flag off → 503 (before the signature is even checked); the same Poster signature auth as the Phase 21 GET, extended to cover the POST body.
- **The mutation mechanism (VERIFIED LIVE, 2026-09-22 — see `docs/PHASE-22-AUDIT.md` §15):** REST `transactions.addTransactionProduct` with `price: 0`. Tested against a real, disposable, unpaid test order: the free line appeared on the cashier's actual register screen in real time (owner-confirmed, not inferred), priced at 0, with the order's own total unchanged. `PosterRewardMutationService.applyToOrder()` never trusts the widget's claimed order id (`orders.getActive().order.id`, a millisecond timestamp) directly — it independently re-resolves it to a REST `transaction_id` by listing currently-open transactions (`dash.getTransactions status=1`, verified to sync within ~20s, effectively immediate) and matching `date_start`; `spot_id`/`spot_tablet_id` for the mutation itself come only from the signed request context, never from that lookup. After mutating, it re-reads the order and only reports `confirmed` if the zero-priced line is genuinely present, the total is unchanged, and no pre-existing line changed — otherwise `ambiguous` (→ `UNKNOWN`, never retried) or `rejected` (→ `FAILED`).
- **Transaction discipline (a real bug found and fixed mid-implementation):** the Poster mutation is 1-3 real network calls and must never run inside a SQLite interactive transaction (5s timeout risk, already hit once this phase for a much cheaper case). The redemption flow is now three phases: a short DB transaction claims the attempt (creates it, checks eligibility/concurrency, marks `POSTER_MUTATING`); the Poster mutation runs entirely outside any transaction; a second short DB transaction commits the terminal result. Audit events still happen after everything closes.
- **`PosWidgetModule` now imports `PosterModule`** — a deliberate, documented reversal of Phase 21's "no Poster-facing module" boundary, scoped to `PosterRewardMutationService` only; the read-only overview path is unchanged.
- **Widget** (`pos-widget/`): reward card gains "Sovg'ani ishlatish" (shown only when `rewards.redemption.enabled`) → product picker (only if >1 eligible product) → "SOVG'ANI ISHLATISH?" confirm → applying (controls disabled, no double-submit) → success / Poster-rejected / UNKNOWN ("qayta bosmang", never auto-retried) / generic failed with a per-reason message. Never shows a Poster-derived price. Never auto-closes.
- **Env** (both optional, OFF by default, independent of each other and of `POS_WIDGET_ENABLED`): `POS_REWARD_REDEMPTION_ENABLED=false`, `POS_PROMOTION_REDEMPTION_ENABLED=false` (promotion redemption is not implemented — flag reserved for later).
- **Verified:** the full HTTP pipeline (against a DB copy, flag on, real `POSTER_API_TOKEN`) with a deliberately-unresolvable `posterOrderId` — proves the three-phase transaction split works, the Poster REST calls execute correctly, and the flow fails safe to `UNKNOWN` with zero `RewardRedemption` rows when no matching open order is found, and that a replay of that `UNKNOWN` attempt does not re-call Poster. The actual `confirmed` (real free line) path was verified via a raw, explicitly owner-approved script call against one disposable test order (Poster txn 46) — not yet through the full HTTP endpoint, since the owner asked to leave that test order untouched afterward. Both backend and widget `tsc --noEmit` and production builds are clean.
- **Real environment now:** untouched by this implementation pass. `.env` has neither `POS_REWARD_REDEMPTION_ENABLED` nor `POS_PROMOTION_REDEMPTION_ENABLED` set (both default false). Test order #46 on the real Poster account still has one free Americano line on it, left as-is at the owner's request — needs manual cleanup (or can just stay, since it was never paid or closed).
- **Before going live:** an end-to-end HTTP-level test of the `confirmed` path (one more disposable test order, through the real widget or the full endpoint) has not been done yet — only the raw REST mutation itself was. §7's POST-signature-against-a-real-POST question also remains unverified. Both are recommended before `POS_REWARD_REDEMPTION_ENABLED=true` in the real environment.

## Phase 21 — Poster POS Widget + CUP Operational Integration: COMPLETE (ships OFF, read-only)

When a barista attaches a customer to a Poster order, a small POS plugin shows that customer's CUP loyalty / reward / promotion picture in a popup, and raises a **non-blocking notification** when a free product is available. It changes nothing: no order mutation, no reward redemption, no free-product insertion, no discount, no point payment, no Poster write, no Telegram message. Full detail, evidence levels and the exact manual steps: `docs/PHASE-21-POS-CAPABILITY.md`.

- **Widget** `pos-widget/` (Vite + React + TS) builds ONE IIFE `dist/bundle.js` (CSS injected, ~164 KB / 52 KB gzip). It contains no secret; the only baked-in value is the public API URL (`VITE_CUP_API_URL`, delivered unset). A typed `PosterApi` wrapper exposes only the permitted Poster APIs, so a forbidden call does not compile; the bundle contains no `makeApiRequest`, order mutation or `before*` event. 14 UI states in Uzbek, compact and touch-first; every failure ends "Sotuvga ta'sir qilmaydi" with a Retry.
- **Backend** `src/modules/pos-widget/`: `GET /pos-widget/ping` (probe, no customer data) and `GET /pos-widget/overview?posterClientId= | code= | phone= [&ref=]` (state FOUND / NOT_FOUND / NOT_LINKED / AMBIGUOUS; masked phone, code, loyalty, rewards + eligible products, promotions, activity). No internal ids, no raw Poster payload, no CRM / growth data; `orderTotal` is rejected (reserved for Phase 22). It composes the existing read services only (no second loyalty / reward / promotion engine) and imports no mutation service. No schema change, no migration, no cache.
- **Auth** = Poster's request signature verified server-side (`md5(fullUrl + X-Poster-Time + POSTER_APPLICATION_SECRET)`), a freshness window (`POS_WIDGET_SIGNATURE_MAX_AGE`, default 300 s) and the pinned account (`X-Poster-Url`). Fails closed: disabled / not configured -> 503, missing / stale / bad signature -> 401, wrong account -> 403. **No fallback auth was built**: whether an ordinary `makeRequest` is signed is NOT DOCUMENTED and is decided by the first real request (`ping` reports `signaturePresent`).
- **Stale-response protection**: a generation counter + a server-echoed `ref` (`orderId.clientId.generation`); the ACTIVE ORDER (`orders.getActive()`) is authoritative on every `orderClientChange` (the event payload is undocumented, so it is only a trigger / fallback); the old card is cleared immediately; no CUP call is ever made with a stale or unknown identity.
- **Audit** reuses `staff_scan_events`: `POS_WIDGET_CUSTOMER_VIEW`, actor `poster:<account>:<spot>:<tablet>`, 60 s de-duplication, no phone / code / Poster id / secret / payload stored.
- **Env** (all optional, feature OFF by default): `POS_WIDGET_ENABLED=false`, `POS_WIDGET_ACCOUNT`, `POS_WIDGET_PUBLIC_URL`, `POS_WIDGET_SIGNATURE_MAX_AGE=300`; reuses `POSTER_APPLICATION_SECRET`.
- **Simulator** `pos-widget/simulator/` (dev only): a local register + Poster-server stand-in that signs server-side, traps every forbidden call, and can be driven into every state and failure (`?mobile=1`, `?payload=empty`, `?active=off`). `npm run serve` is a dev helper that serves only `/bundle.js` for Poster's Development mode.

**Verified (manual, no tests):** 39 backend HTTP checks (security matrix, states, canonical data equal to Customer 360, privacy, read-only before/after counts, audit, latency p95 <= 86 ms, bundle scan), feature-OFF default on a fresh instance, and the full browser/simulator matrix at 520x600 / 375 / 320 px with 0 forbidden calls, 0 blocking subscriptions and 0 page errors. One read-only real-Poster GET confirmed Poster client 2 <-> the CUP customer by phone. Everything about the real POS runtime is NOT VERIFIED (section 14 of the doc).

**Real environment now:** untouched. `.env` has no `POS_WIDGET_*` keys (OFF); the running backend on :3000 predates this code (`/pos-widget/ping` is 404 there until restarted); nothing was uploaded to Poster; the real DB has 0 widget audit rows. First real load = the manual steps in the doc (section 15).

## Phase 20 — Poster Webhook Continuous Sync & Reliability: COMPLETE (ships OFF)

A Poster POS sale now reaches CUP without anyone importing it: **Poster webhook -> `POST /webhooks/poster` -> durable event -> background processor -> canonical read from Poster -> the Phase 19 import engine -> Customer 360 / Analytics / Rewards.**
Poster remains the source of truth; CUP only reads. There is no second import engine: the Phase 19 classification and atomic writes were extracted into shared functions (`classify()` / `persist()`), the reviewed admin import and the automatic sync call the same code.

**What Poster documents about webhooks (official docs, github.com/joinposter/docs en/web/webhooks.md, read 2026-09-21) — and what it does not.**
Documented: a POST with `account`, `account_number`, `object`, `object_id`, `action` (added / changed / removed / transformed), `time` (Unix seconds, string), `verify` and, only for a few objects (client_ewallet, stock, application), `data`;
`verify` = md5(`account;object;object_id;action;[data;]time;application_secret`); the objects include `transaction` and `incoming_order`; the webhook URL and the chosen entities are configured per APPLICATION in the developer account, and the application must be connected
in the Marketplace for each account; the expected answer is JSON `{"status":"accept"}` (the dashboard says HTTP 200); without it Poster retries 15 times. **NOT documented:** any event id, the retry interval, rate limits, when a `transaction` webhook fires (open / change / close), whether it carries
anything beyond the ids (it does not: the documented payload has no status, spot, client or products), the Content-Type. Consequences: a webhook is only a HINT — the transaction is always re-read with `dash.getTransaction` (verified live: an ARRAY holding one transaction, `status=0` = any status, an unknown id gives an empty
array); duplicates are recognised by (object, object_id, action, time); nothing about refunds changed (`dash.getTransactionHistory` documents `delete` but no return / refund type).

- **Receiver (`src/modules/poster-sync/`).** Public route (no bearer token possible), authenticity = the documented signature with constant-time comparison; malformed -> 400, bad signature / wrong pinned account -> 401, no `POSTER_APPLICATION_SECRET` -> **503** (never "accept": nothing silently dropped, Poster keeps retrying),
  another entity -> verified and acknowledged but NOT stored (no noise), structured `data` (undocumented serialisation) -> acknowledged and dropped. It verifies, **commits the event, wakes the processor and only then answers 200 `{"status":"accept"}`**; a database failure fails the request so Poster's own retry delivers it again. It makes no Poster call, so the POS is never blocked
  (~4.5 ms and 1 SQL statement per event). Any Content-Type is accepted (application/json, text/plain, and a JSON body labelled form-urlencoded — a plausible default of Poster's PHP sender — as well as real key=value pairs); the body limit is Fastify's 1 MB (413 above).
- **Durable queue.** New table `poster_webhook_events` (additive migration `20260921190000_phase20_poster_webhooks`): one row per distinct delivery, unique `dedupeKey`; Poster's 15 retries only increment `deliveries`. Status QUEUED / PROCESSING / DONE / DEAD, `attempts`, `nextAttemptAt`, a processing lease (`lockedAt`), `outcome`, a short redacted `lastError`.
- **Processor.** Claims due events with compare-and-set (two workers never take the same row), reclaims a lease older than 5 minutes (crash recovery), coalesces all events of one transaction into ONE Poster read, imports through the Phase 19 engine, and records the outcome: IMPORTED / ALREADY_IMPORTED / CUP_ORIGINATED / SKIPPED:<reason> / UNRESOLVED:<reason> / NOT_CLOSED /
  TOO_RECENT / NOT_FOUND / REMOVED / **REMOVED_IMPORTED**. A receipt still settling is DEFERRED to exactly close + `POSTER_IMPORT_SETTLE_SECONDS` (not a failure); an open receipt waits for its next event or the reconciliation; a failure (Poster down, write rolled back) is retried with exponential backoff 30 s, 1 min, 2 min ... capped at 30 min
  and becomes DEAD after `POSTER_WEBHOOK_MAX_ATTEMPTS` (12) — visible in Admin, retried by an admin with one click. When Poster is down the first failed read stops the tick (the rest is put back untouched — no timeout burned per event). A receipt Poster reports as removed that CUP had imported is FLAGGED and never reversed (refund semantics are still unverified).
  Automatic policy = "write exactly what the preview would call IMPORTABLE (plus UNRESOLVED audit rows) and skip everything else per receipt": no customer / branch / product is ever created, CUP-created receipts are skipped, nothing is guessed. The admin gates (acknowledgement, reviewed count, 100-receipt cap) belong to the reviewed BULK import and do not apply to a single receipt.
- **Reconciliation (secondary recovery) — checkpoint-based (hardened after the first Phase 20 delivery).** The recovery loop no longer reads "now minus 2 days". It keeps a **durable checkpoint** (Setting `poster.sync.reconcileCheckpoint`, ISO time — no schema change): "every closed
  receipt with `date_close` before it has been decided". Every `POSTER_RECONCILE_INTERVAL_MS` (10 min, unchanged) and once ~10 s after every start, a pass resumes from the checkpoint **minus a small overlap** (`POSTER_RECONCILE_OVERLAP_MINUTES`, default 60, 5-1440), walks forward in bounded 2-day close-time chunks up to "now"
  (<= 12 chunks = ~23 days per pass; a longer outage simply continues on the next pass), reads each chunk from Poster with the documented Ymd window (widened one day each side because Poster files a receipt under its ACCOUNT business day, UTC+3 here, and a night receipt under the previous day) paged with the documented `next_tr` cursor, filters exactly on
  each receipt's own `date_close`, drops what CUP already has, and imports the rest (<= 200 per step, oldest first) through the same Phase 19 engine. **The checkpoint is persisted chunk by chunk and advances only over fully decided ground**: to the end of the chunk, or up to — never past — the earliest receipt that is not decided yet (still settling, write failed, or beyond the per-step cap); it never moves
  backwards. **A failed pass does not advance it** (Poster down, an exception, a read failure: the chunk that failed is not counted; chunks completed earlier in the same pass keep their progress) and the error + time are stored (`poster.sync.lastReconcileError`), the last success too (`...lastReconcileSuccess`). The very first run (no checkpoint) starts `POSTER_RECONCILE_LOOKBACK_DAYS` (2) back — that env is now only the INITIAL checkpoint.
  So if CUP is down for 4, 7 or 40 days, the first passes after it returns resume from the last successful checkpoint and import everything importable exactly once. Receipts CUP decided on purpose (no client, unlinked client, unpaid, refund-shaped, CUP-created) are final for the checkpoint (the overlap re-reads the most recent ones; older gaps go through the reviewed admin import). It counts receipts NO webhook had announced (`missedWebhooks`), never overlaps itself, never throws (the scheduler does not await it),
  and writes nothing — not even the checkpoint — while `POSTER_SYNC_ENABLED` is off.
- **Operator interlock.** `POSTER_SYNC_ENABLED` (default OFF, env only). Off: the receiver still verifies and durably queues; nothing is fetched or imported; the loop does not run; a backlog is processed when it is enabled.
- **Admin ("Poster POS Import" -> Continuous sync).** `GET /admin/poster/sync-status` (configuration flags — never the secret, queue counts, oldest wait, last webhook / processing, 24 h outcomes, duplicate deliveries, last reconciliation, alerts), `GET /admin/poster/webhook-events` (paginated <= 50, filter by status / transaction), `POST /admin/poster/webhook-events/:id/retry` (DEAD only).
  Alerts: secret not set, sync off, DEAD events, oldest queued > 15 min, no checkpoint yet, checkpoint lag above 3 intervals + overlap, an unresolved reconciliation error ("checkpoint NOT advanced"), a held checkpoint, missed webhooks recovered, removed-but-imported receipts. The Recovery-checkpoint card shows the checkpoint, the lag, the last successful check, the last check and the last error (marked resolved after a later success). The panel shows the webhook URL to paste into Poster.
- **Verification (no tests written or run; throw-away harness deleted).** 48 in-process checks x 3 runs (fake Poster for edge cases; Poster writes and Telegram calls blocked and counted = 0): signature (valid, wrong, other secret, malformed x9, other entity, structured data, no secret 503, pinned account), dedupe (5 retries = 1 row), DB failure -> HTTP 500 then retry ok, every receipt class through the SAME Phase 19 rules,
  settling deferral, Poster down (backoff, one call for three events), DEAD + admin retry (non-admin 403), not found / removed, REMOVED_IMPORTED flag (row untouched), crashed lease reclaimed and a live lease not stolen, compare-and-set claims disjoint, no overlap, sync OFF / backlog, reconciliation (one list read, idempotent, Poster down, lost webhook), downstream (Analytics POS == stored rows, Customer 360), no duplicate rows, the real automatic wake-up
  (~1 s), 200 events. 20 HTTP checks against REAL Poster on copies of the real DB: real signed webhooks over HTTP imported #21 and #22 automatically (canonical read), the boot reconciliation recovered #25 (no webhook had announced it), a CUP-created receipt (#4) was NOT imported, events queued while the flag was OFF were processed after a restart (#23, #28), tampered / wrong / missing signatures,
  non-JSON, oversized (413), GET 404, replay harmless, admin routes 401 for no token / customer / staff / invalid / wrong-secret / expired, 400 on bad query, no secret in any response. The verification found and fixed a real bug: text/plain and form-labelled bodies were rejected.
- **Performance.** Receiver 4.5 ms and 1 SQL statement per event (200 events 0.9 s); processor 200 events = 200 Poster reads, ~28 ms and ~18 SQL statements per event, 10 ticks of <= 25. A quiet tick is one indexed query. Poster reads per event: 1 (`dash.getTransaction`), plus at most 20 incoming-order lookups per receipt for still-unlinked CUP orders (cached after the first hit); reconciliation: 1 list read per pass.
- **Real environment now.** Migration applied to the real DB (backup `prisma/dev.db.pre-phase20.bak`); the new table is empty; every other table is identical to the post-Phase-19 state. The real backend runs the Phase 20 code with the flag OFF and no secret (the webhook route answers 503, stores nothing; admin routes 401 without a token). Nothing was registered in Poster and no real webhook has been received — **a real Poster-originated webhook has not been observed** (it needs the owner's application).

**Phase 20 hardening — verified (manual, no tests; throw-away harness deleted).** 32 checks on a copy of the dev DB (fake Poster emulating the behaviours measured live: UTC+3 business-day filing with a night offset, ascending `next_tr` cursor, page cap, late-appearing receipts; Poster writes and Telegram calls blocked = 0): flag off writes nothing; first run initial lookback; resumes from the checkpoint (dateFrom = checkpoint - overlap - 1 day, not now - 2 days); overlap
recovers a receipt that closed 30 min before the checkpoint but reached Poster late (and 3 h late with a 240-min overlap; outside it is a documented limit); Poster down -> checkpoint unchanged, error recorded, next pass resumes and the error is marked resolved; a failed write holds the checkpoint at that receipt, the others import, the retry succeeds; a settling receipt holds it; **CUP offline 4 days (97 receipts, 3 chunks) and 7 days (169 receipts, 4 chunks): one pass imports every
importable receipt and reaches now; 40 days: 12 chunks (23.5 days) then the next pass finishes — 480 receipts, each exactly once**; cursor paging with a 7-per-response cap (8 pages); a night receipt filed under the previous business day is found; a cursor-ignoring Poster cannot loop us; 430 receipts in one chunk continue past the per-step cap; a crash between an import and the checkpoint write, two simultaneous passes, and a webhook-imported receipt all produce 0 duplicates;
run() survives a failing checkpoint read; Admin shows checkpoint / lag / last error / alerts. Then REAL Poster, read-only, on a copy without imports: a checkpoint 5 days back caught up exactly the 7 known receipts (#11 #21 #22 #23 #25 #28 #30) in 8 GET reads and a second pass imported nothing.
**Real environment:** untouched by this pass — no migration (Settings only), no real Poster data written, the real DB unchanged, and the running real backend (booted before the current `.env` was edited) reports sync OFF / no secret / no checkpoint. **NOTE: `.env` now contains `POSTER_SYNC_ENABLED="true"` and a 32-character `POSTER_APPLICATION_SECRET` (file modified 2026-09-21 23:56, not by Claude); a backend RESTART would therefore activate the sync.**

### Phase 20 — activation steps (owner)

1. **A stable public URL for the backend.** Poster must reach `https://<host>/webhooks/poster`. A Cloudflare *quick* tunnel changes its address on every restart, which would silently break the registration; use a named tunnel / a real domain. (Until then the reconciliation still recovers every sale within its lookback.)
2. In the Poster developer dashboard, for the application: **Webhooks -> "URL for webhooks"** = that URL, select **only the `transaction` entity** (other entities are acknowledged and ignored anyway), and make sure the application is **connected in the Marketplace for the CUP Coffee account**.
3. Copy the application's **secret** into the backend `.env` as `POSTER_APPLICATION_SECRET` (optionally `POSTER_ACCOUNT` = the account name). Restart the backend. Admin -> POS Import -> Continuous sync should show "secret configured".
4. Set `POSTER_SYNC_ENABLED=true` and restart. Make one supervised test sale at the POS for a customer linked to a Poster client; after the settling delay (default 10 min, `POSTER_IMPORT_SETTLE_SECONDS`) it appears in Customer 360 / Analytics; the events table shows the webhook. **Loyalty 2.0 is ON in the real DB, so an imported sale after its accrual start also accrues points / cashback / achievements once (by design).**
5. Watch the panel's alerts for a few days (especially "Reconciliation recovered N receipt(s) that no webhook had announced" and the checkpoint lag). The first pass creates the checkpoint 2 days back (`POSTER_RECONCILE_LOOKBACK_DAYS`); from then on it only moves forward.

## Phase 19 — POS Import Activation & Attribution Data Quality: COMPLETE (first real import executed with owner approval)

The Phase 11.2 import engine is now safe to activate, and the owner can see, review and control every step. The implementation was finished and verified WITHOUT importing; the owner then approved the import explicitly and it was executed (see "Real import — executed"). **Every further import needs a new explicit approval.**

- **One engine, no second import path.** `PosterTransactionImportService` = `analyze()` (the read-only classification of one bounded window; used by the preview, the data-quality report and the import) + `run()` (analyze, then — only if every gate
  passes — the writes the analysis planned). Preview and import therefore cannot disagree. Nothing calls `run()` except the Admin endpoint: **no startup / cron / login / restart / post-mapping import exists.**
- **Endpoints (all AdminAuthGuard + admin role):** `POST /admin/poster/import-transactions` (preview by default; extended), `GET /admin/poster/spot-mapping`, `GET /admin/poster/import-data-quality`, `GET /admin/poster/import-history` (paginated, <= 50 rows).
  Only the POST can write, and only through the gates below.
- **Preview** (dryRun default, writes nothing — proved by before/after counts of every protected table incl. the link cache): scanned; an exclusive partition into IMPORTABLE / ALREADY_IMPORTED / CUP_ORIGINATED / POSSIBLE_CUP_ORIGIN / UNRESOLVED / UNSUPPORTED_LINE /
  UNMAPPED_BRANCH / UNMAPPED_CUSTOMER / UNPAID / TOO_RECENT / REFUND_UNVERIFIED / OTHER (counts and revenue per category), plus per receipt: Poster id, date, spot + branch, customer (display name), total, paid, status, product lines, reason, decision.
- **Real-import gate (every item is a 400 raised before the first write):** `dryRun:false` AND `confirm:true`; explicit `since` + `until` (no default window) <= 31 days; explicit `limit` 1-100; `acknowledgeRefundPolicy:true`; `expectedImportable` = the importable count of the
  preview the operator reviewed (a changed window state => refused, "run the preview again"); no receipt from an unmapped / inactive Poster spot in the window; admin role. A malformed / non-boolean flag is 400.
- **Branch mapping.** The mapping IS `Branch.posterSpotId` (required, unique, written only by the existing Poster spot sync). The mapping report compares Poster's spots (read-only `access.getSpots`) with CUP's branches: MAPPED / UNMAPPED_POSTER_SPOT /
  UNMAPPED CUP BRANCH / DUPLICATE (structurally impossible — the unique index rejects it; checked anyway) + inactive branches + name drift. **No PATCH endpoint was added** (D19-4). Real result: spot 1 -> branch "iwyoqar" (Poster now calls spot 1 "Cup Coffee
  Jizzzax": the branch name is stale, the id mapping is right), spot 2 -> "Cup Coffee Samarqand"; nothing unmapped.
- **Attribution (unchanged rules, made visible).** Customer = Poster client_id -> `Customer.posterClientId`, else the receipt is UNMAPPED_CUSTOMER and skipped (no customer is ever created); branch = spot_id -> `Branch.posterSpotId` (unmapped / inactive => skipped, never
  assigned elsewhere); product = product_id -> `Product.posterProductId` (unmapped => UNRESOLVED audit row, never guessed; a Poster modifier => UNRESOLVED). CUP-created receipts are recognised through `poster_incoming_order_links` (documented
  incoming_order.transaction_id) and skipped; as a safety net an UNDOCUMENTED `application_id` on a receipt CUP could not link causes a skip (POSSIBLE_CUP_ORIGIN) — used only to skip, never to import or attribute.
- **Refund / return: outcome B — REFUND_UNVERIFIED.** Read-only inspection of Poster (45 days, statuses 1 / 2 / 3): no deleted receipt (status 3) and no negative amount / quantity exists, so refund / return semantics cannot be verified and are NOT invented. A receipt
  with a negative amount or quantity is excluded (never a negative sale); Poster's status-3 receipts are counted and an already-imported receipt that Poster later lists as deleted is reported (`importedButDeletedInPoster`), never reversed. Every real import requires
  the operator's acknowledgement. What is unknown: how Poster represents a refunded CLOSED receipt.
- **Atomicity / idempotency / resume.** A receipt (header + all lines) is written in ONE database transaction; an item-level failure rolls the header back and is thrown (it is no longer mistaken for "already imported" — a P2002 only means "duplicate" when it names
  `posterTransactionId`). A failure on one receipt is reported FAILED and the batch continues; re-running the same import skips the completed receipts and writes only the missing ones. The unique Poster transaction id is the dedupe authority. An UNRESOLVED audit row is
  upgraded in place once its product is mapped.
- **Data-quality report + import history.** Mapping counts; customer link stats; product line mapping; stored rows by status, unresolved reasons, imported revenue / paid, per branch, imported rows without lines (must be 0); a live scan of one bounded window (categories, attributed vs
  unattributed receipts and revenue, receipts without / with an unlinked Poster customer, partly-paid receipts, refund policy); and the events that carry no purchase link (loyalty ledger rows without an order, reward / promotion redemptions without an order, referrals not tied
  to a purchase) — never assigned to a branch. The history is the imported-transaction table itself (importedAt + status + source make an import traceable — **no import-run table was added**).
- **Admin UI ("Poster POS Import").** Staged: 1 mapping, 2 preview (dates + limit, counts, filterable paginated receipt table, refund box), data quality, import history (filters: date, branch, status, customer; server-side pagination), 3 import. Loading only READS. The Import step is locked until a
  preview of the CURRENT dates / limit exists, it has importable receipts, none are unmapped-branch and the refund policy is acknowledged; the button only opens a confirmation dialog ("This action writes POS transaction data into CUP.") that needs its own checkbox; only that dialog
  sends dryRun:false + confirm:true. Filters, refresh and navigation never write. Verified at desktop / tablet / phone (no overflow, dialog fits) with error + retry per section.
- **Downstream effect of an import (measured on a copy of the real DB with real Poster data; POS purchases are the canonical purchase source).** Analytics V1: revenue +8 100, orders +7, customers unchanged, POS source 7 / 8 100; Branch Intelligence: the branch's POS share 25.3 %, sum(branch) + unmapped == total;
  Customer 360: CUP 4 / 23 900 unchanged + POS 7 / 8 100 = 11 / 32 000, no receipt counted twice; Growth: frequency 4 -> 11, monetary 23 900 -> 32 000, recency 3 -> 0 days. **Rewards: the real "5+1" program (Coffee, created by the owner on 2026-09-21) would show 1 -> 6 available
  rewards for the only linked customer** (33 paid coffee units = 7 CUP + 26 POS; reward progress counts every imported paid unit regardless of the program start date). The import ITSELF grants nothing: no reward redemption, no promotion redemption, no referral, and no legacy (CUP-order) points — the legacy earn rule only runs for CUP orders. **Correction:** in the REAL environment Loyalty 2.0 is ON (the owner enabled it on 2026-09-21 17:26 with accrualStartsAt = that moment), so the existing
  Loyalty 2.0 sync job (it processes every canonical purchase once, unique per source purchase) accrues points / cashback / achievements for imported purchases made after accrualStartsAt. The copy-DB verification ran with Loyalty 2.0 off and therefore did not show this. CRM automation (still off) would see a PURCHASE_COMPLETED
  event stamped with the IMPORT time, and a referral is rejected as PRIOR_PURCHASE if an imported purchase predates its attribution (POS-only qualification, first-purchase-only, window and duplicate imports verified on the copy).
- **Performance (copy DB).** Preview SQL statements: 8 / 8 / 10 for 6 / 200 / 1 000 receipts (the +2 is Prisma splitting an IN list at SQLite's 999-parameter limit; no per-receipt query); latency 6 / 10 / 19 ms; Poster reads per preview: 1 receipt list + 1 deleted list + one incoming-order lookup per
  still-unlinked CUP order (<= 100; 6 today, cached in `poster_incoming_order_links` by the first real import); a 100-receipt import ~430-500 ms (~3.4 statements per receipt); data quality 19 ms (stored) / 17-23 statements live; history page 3-8 ms; mapping 2 statements.
- **Verification (no tests written or run):** 71 service-level checks on a throw-away copy (real Poster reads, fake Poster for edge fixtures, all Poster writes and Telegram calls blocked and counted = 0), 10 HTTP security / validation checks (9 as scripted + the 10th, `confirm:true` without `dryRun:false`, returns a 201
  PREVIEW that writes nothing — the script expected 200), Admin UI walk-through incl. a full confirmed import on the copy. The verification found and fixed a real bug: reversal-shaped receipts were categorised OTHER instead of REFUND_UNVERIFIED.
- **Real DB during development:** unchanged (no migration): customers 2, orders 6, orderItems 12, loyaltyTransactions 2 (balance sum 150), rewardRedemptions 0, rewardPrograms 1 (the owner-created "5+1"), posterImportedTransactions 0, items 0, links 0, referrals 0, referralRewards 0, staff_scan_events 8. The import that followed is recorded below.

### Real import — executed 2026-09-21 (owner-approved)

The owner approved the import in chat; a fresh preview was re-run on the real backend, matched the reviewed set exactly, and the gated import ran once at 2026-09-21T18:08:37Z (window 2026-08-22..2026-09-21, limit 100, expectedImportable 7). Result: **7 imported, 0 failed, 0 unresolved**: Poster #11, #21, #22, #23, #25, #28, #30 — 7 rows / 8 lines, total 8 100, paid 7 800, all branch "iwyoqar", all customer Шохкадам; 6 CUP-order links cached (orders 3-8 -> receipts 4, 12, 13, 14, 15, 19). Real DB after: posterImportedTransactions 7, items 8, posterIncomingOrderLinks 6, and — through the existing Loyalty 2.0 sync, 1.5 s later — loyalty_accruals 1, cashback_transactions 1 (15 so'm), loyaltyTransactions 3 (+1 point "Purchase" for #25 only; the other 6 predate accrualStartsAt), balance 151, 2 achievements unlocked (Morning Lover, Weekend Visitor; 0 points). Everything else unchanged (customers 2, orders 6, orderItems 12, rewardRedemptions 0, referrals 0, referralRewards 0, staff_scan_events 8, promotionRedemptions 6). No Telegram message, no Poster write.

The pre-import preview of 2026-08-22..2026-09-21 (Poster read on 2026-09-21) found **7** importable receipts, not 6: Poster #11, #21, #22, #23, #25, #28, #30 — all spot 1 (branch "iwyoqar"), all customer Шохкадам (Poster client 2), all Cappuccino (product 3), total 8 100 so'm
(paid 7 800; #11 has a free line: total 1 800, paid 1 500). #25 was closed after the earlier preview. 6 receipts are CUP-originated (#4, #12, #13, #14, #15, #19); 12 are unattributed customers (8 without a Poster client, 4 with an unlinked client) = 9 900 so'm; 5 are unpaid; 0 refund-like; 0 deleted.
Importing would also (a) cache 6 CUP-order -> receipt links in `poster_incoming_order_links`, (b) raise the customer's "5+1" available rewards from 1 to 6, (c) make Analytics / Branch Intelligence show POS data.

## Phase 18 — Branch Intelligence: COMPLETE

A descriptive, deterministic, per-branch view of what already exists: `GET /admin/branch-intelligence/overview` (AdminAuthGuard only) -> Admin page "Branch Intelligence". **No new table, no migration, no cache, no
queue, no ML / prediction, no ranking, score, tier, "best" / "worst" or winner / loser label** — branches are listed by name and figures sit side by side.

- **API:** `period = today | yesterday | last7 | last30 | custom` (+ `startDate` / `endDate`, max 366 days) and an optional `branchId`. The period rules are Analytics V1's own — the resolver moved verbatim into
  `analytics-period.ts` (`resolveAnalyticsRange`) and both modules call it; business time = `BUSINESS_TIMEZONE_OFFSET_MINUTES` (UTC+5), zero-filled days. Without `branchId`: one row per ACTIVE branch (zeros included) plus any
  inactive branch that had activity in the period, ordered by name then id: revenue, orders, customers, average check, new / returning customers, revenue and order share, active days, last purchase, CUP / POS mix, repeat-customer
  rate, top product. With `branchId`: that branch's revenue / orders / customers by day, activity, retention, cross-branch purchasing, CUP vs POS, products and categories, loyalty, rewards, promotions, referrals, growth and an overview
  snapshot. The response also carries the exact wording of every definition (`definitions`).
- **Code:** `src/modules/branch-intelligence/*` (repository = bulk SQL, service = composition, controller = zod .strict() query), `admin/src/pages/BranchIntelligencePage.tsx`, `admin/src/lib/adminBranchIntelligence.ts`, sidebar entry in
  `AdminLayout.tsx`. Reused, never re-implemented: Analytics V1 (period resolver, item aggregates, parity), Growth Intelligence (lifecycle / RFM / signals / opportunities, branch-scoped), Rewards availability service.
  Minimal refactors: `AnalyticsModule` now exports its repository + service; `GrowthIntelligenceService.overview` accepts `allowInactiveBranch` (+ `findBranch`) so a deactivated branch stays viewable historically.
- **Canonical purchase:** CUP order with status sent_to_poster / accepted / preparing / ready / completed UNION imported POS purchase with status IMPORTED (pending / failed / cancelled / uncertain / UNRESOLVED / unpaid are out) —
  the same list Analytics, Customer 360, Loyalty 2.0 and Growth use. Poster is never called; products come from stored order / POS lines.
- **Branch attribution:** the branch STORED on the purchase (`Order.branchId`; POS = the branch mapped from the Poster spot to `Branch.posterSpotId` at import time). Never inferred from customer, staff, product or time. A purchase with no
  branch is counted in the all-branches totals (as in Analytics V1) and in NO branch row; the all-branches view shows it as "Not tied to a branch" (orders + revenue), so sum(branch) + unmapped == Analytics V1 total.
- **New vs returning:** new = the customer's first qualifying purchase EVER (any branch, any source; ties broken by time, source, id) fell at this branch inside the period; returning = every other purchaser at the branch;
  new + returning = customers. Analytics V1's wording (no sale anywhere before the period start) is exposed next to it (`customers.analyticsV1`) — the two differ only for a customer whose first purchase was at ANOTHER branch inside the
  period. The all-branches split equals Analytics V1 exactly.
- **Cross-branch purchasing** (purchase records only; says nothing about physical movement): customers with purchases at 2+ mapped branches in the period; customers whose latest purchase in the period was here; purchases here that directly
  followed a purchase at another mapped branch (an unmapped predecessor is not counted). Not called "migration".
- **Attribution limits (conservative — nothing is invented):** loyalty points ledger rows are attributed only through their order (`loyalty_transactions.orderId` -> order branch); rows with no order are shown as unattributed (all-branches numbers).
  Loyalty 2.0 accruals and cashback are attributed through the SOURCE purchase (CUP order or POS purchase -> its branch). Reward and promotion redemptions only through their own order (no order = unattributed). Referrals through the
  qualifying purchase key (`CUP_ORDER:<id>` / `POS:<id>`) -> that purchase's branch; the rest is "qualified elsewhere / unattributed". Reward availability is customer-level progress of the branch's customers and is labelled that way.
- **Growth block** = Phase 15 code and thresholds, computed from this branch's purchases only, **as of today** with the configured default lookback — it does not follow the period filter (labelled in the UI).
- **Performance (copy DB, bulk SQL — branches are GROUP BY, never loops):** overview = **7 SQL statements at every branch count** (6 / 16 / 66 / 166 branches); branch detail = **55 statements** at 16 / 66 / 166 branches. Latency at
  ~215 customers / 16 branches: 15 ms / 58 ms; at ~5 015 customers / 66 branches: 244 ms / 276 ms; at ~5 115 customers / 166 branches: 266 ms / 309 ms (overview / detail); over HTTP ~260-365 ms / ~305-350 ms. The heaviest statement
  is the per-branch customer window query (~229 ms at 5 100 customers, 17 000 purchases); totals ~82 ms; growth ~17 ms. No cache was added (nothing measured warranted one).
- **Admin UI:** period / branch / custom-date filters (active branches only in the selector; an inactive branch is listed and labelled in the comparison table and can be opened from it), 6 KPI cards, branch comparison table (name order,
  no rank column; scrolls inside its own wrapper), daily revenue / orders charts (zero days kept, "No purchases in this period" note), customer behavior + retention + cross-branch, product intelligence (top by quantity / revenue,
  categories, CUP vs POS), loyalty & rewards & promotions & referrals (with the unattributed counts), growth intelligence (lifecycle, RFM matrix, signals, opportunities), a factual branch overview snapshot, and a Definitions panel.
  Empty, loading (skeleton), error + Retry and invalid custom range states. All-branches daily revenue uses Analytics V1's own series. Building this exposed that the Admin shell had a fixed 220 px sidebar at every width (~155 px of content on a
  phone), so a `max-width: 760px` rule now stacks the sidebar above the content — no other width changed. The Staff panel got **no** branch analytics.
- **Security:** AdminAuthGuard only. No token, invalid token, wrong-secret token, expired admin token, a CUSTOMER JWT and a STAFF JWT are all **401**; a valid admin session is 200. Invalid period, malformed / impossible dates, reversed range, > 366
  days, custom without dates, an injection-shaped / unknown / oversized `branchId` and any unknown parameter are **400**. Only GET exists (POST / PUT / PATCH / DELETE and other sub-routes are 404). The payload carries no customer id, phone,
  Telegram id, Poster id or secret (customers only as display names inside the Phase 15 opportunity rows).
- **Verification (throw-away copy of the real DB; no tests were written or run):** 66 service-level checks — an independent per-customer recomputation vs the bulk aggregate and Analytics V1 parity (revenue, orders, customers, new / returning, per
  branch and all branches, for today / yesterday / last7 / last30 / custom), hand-computed scenarios (CUP-only, POS-only and mixed customers, one customer at 2+ branches, a first purchase made at another branch, non-qualifying CUP orders and UNRESOLVED / PENDING POS rows excluded, reward / free / unmapped-product
  lines excluded from products, a quiet branch with zeros, an inactive branch with history, a very long branch name; unmapped purchases are covered by the sum(branch) + unmapped == total parity check), loyalty / reward / promotion / referral attribution, growth parity with `GrowthIntelligenceService.overview`, date validation and the 10 / 50 / 100+
  branch x 200 / 5 000 customer measurements — all pass; 14 HTTP checks (13 as scripted; the 14th, `startDate` without `period=custom`, answers 200 because dates apply only to custom — the Analytics V1 convention — not a defect); Admin UI at desktop,
  tablet 768 and phone 375 (no horizontal overflow, long branch / product names, large numbers, zero-value charts, empty / loading / error / retry, invalid and valid custom range). Every Telegram Bot API call and Poster request was blocked and counted: 0 attempted.
- **Real DB:** unchanged (no migration). Before == after: customers 2, orders 6, orderItems 12, loyaltyTransactions 2 (balance sum 150), rewardRedemptions 0, rewardPrograms 0, posterImportedTransactions 0, referrals 0, referralRewards 0,
  staff_scan_events 8. The real backend was only restarted and probed unauthenticated (401); no authenticated Branch Intelligence request was made against the real DB.

## Phase 17 — Analytics Dashboard V1: COMPLETE

Read-only admin analytics: `GET /admin/analytics/overview` (AdminAuthGuard) → `AnalyticsService` → `AnalyticsRepository` (all
Prisma) → Admin page "Analytics". Period (Today / Yesterday / Last 7 / Last 30 / Custom), branch filter, KPIs (revenue, orders,
customers, average check), daily revenue chart, CUP vs POS source, top 5 products, new vs returning customers.

- Code: `src/modules/analytics/*`, `admin/src/pages/AnalyticsPage.tsx`, `admin/src/lib/adminAnalytics.ts`, sidebar entry in
  `admin/src/components/AdminLayout.tsx`.
- New env: `BUSINESS_TIMEZONE_OFFSET_MINUTES` (default 300 = UTC+5). No migration, no new tables.
- Data included: qualifying CUP orders + POS transactions with status `IMPORTED`. POS tables are empty in the real DB, so today
  the dashboard shows CUP data only and "No imported data yet" for POS. It picks up imported POS rows automatically once they
  exist (proved on a throw-away DB copy: +6 orders / +6 600 so'm, a customer present in both sources counted once).
- Verification done: API values vs an independent recomputation (all periods/branches/custom ranges), 401 for customer / staff /
  missing token, 400 for bad input, real-DB baseline counts unchanged, UI viewed against real data and the POS-included copy,
  error + Retry state exercised. No tests were written or run (standing rule).

## Real-data facts (as of end of Phase 19)

customers 2, orders 6 (5 qualifying), orderItems 12, loyaltyTransactions 2 (balance sum 150), rewardRedemptions 0,
rewardPrograms 1 (the owner-created "5+1" Coffee program, 2026-09-21), promotions 4, posterImportedTransactions 7 (+ items 8, CUP-link cache 6; imported 2026-09-21), loyaltyTransactions 3 (balance 151), loyalty_accruals 1, cashback 15 so'm. Money is whole-UZS integers == Poster wire integers (factor 1).

## Open items / limitations

- Poster POS import: the first real import ran on 2026-09-21 (Poster tx 11, 21, 22, 23, 25, 28, 30). Future receipts are imported only through the gated Admin flow with a new explicit approval; receipts of unlinked / anonymous customers are (by design) never imported.
- Refund / return behaviour of POS sales is UNVERIFIED (Phase 19 policy REFUND_UNVERIFIED: negative-amount receipts excluded, nothing reversed automatically); analytics counts every `IMPORTED` row as a sale.
- Order stuck in `pending` (real order #8): `pending` is not in `POLLABLE_ORDER_STATUSES`, so an order whose first Poster poll
  returns status 0 never advances and is never counted. Not fixed (out of scope; flagged as a separate task).
- Analytics day grouping uses two SQLite-specific raw queries (`strftime`); a database change would need those two rewritten.
- Not implemented (out of Phase 17 scope): RFM, LTV, churn, cohorts, retention, forecasting, exports, scheduled reports.
- Phase 13 limitations: deliveries are recorded on `AutomationExecution`, not `CampaignRecipient` (the Campaign model is one-shot: unique campaign+customer);
  default `CART_EXPIRY_MS` is 1 h, so an abandoned-cart delay must be < 60 min unless that setting is raised; a scheduled-segment run materialises its
  whole audience through the existing `getAllMatchingCustomerIds` (Phase 5 design); segment membership metrics are CUP-order-derived (POS not in
  segments yet); personalisation applies to automation sends only (manual campaigns still send raw text); known-but-unavailable variables render empty/0;
  uncertain Telegram outcomes are recorded FAILED and never retried; attempted sends count toward cooldown / frequency / daily cap; Preview of a
  DRAFT/PAUSED automation assumes activation `maxEventAgeHours` ago; birthday detection scans once per business day; a changed cart quantity is not
  tracked (CartItem has no updatedAt); real Telegram delivery through automations is unverified (stub only).
- Phase 14 limitations: qualification is time-driven by the background job (default 60 s), so a reward appears about a minute after the qualifying purchase, not instantly (there is
  still no order-lifecycle hook); rewards are POINTS only; a SKIPPED reward decision (cap reached, zero value) and a closed referral (REJECTED / EXPIRED) are final — raising the cap or
  changing a rule later never pays or reopens them; reward values are read when the reward is granted, not when the referral qualified; eligibility and PRIOR_PURCHASE only see purchases CUP
  knows about (the real POS import has not run); fraud rules are deterministic only (self, duplicate, circular, prior purchase) — a shared phone is NOT blocked because phone numbers are not
  unique in the registration architecture, and there is no IP / device logic; attribution works only through the bot's `/start` deep link (no `startapp` Mini App link); the customer GET
  lazily creates the referrer's own code (an idempotent write on a read path); no CRM trigger consumes the referral events yet; refund reversal is not modelled (a refunded first purchase
  keeps its reward, as in earlier phases); the minimum purchase is compared in the same unit as Loyalty 2.0 (whole so'm).
- Phase 15 limitations: the reward-availability figure loads the qualifying order-item rows (the canonical Phase 13 query) so it grows with purchase history — it only runs while a
  reward program is active; Segments (existing design) still evaluate every customer in memory, growth fields included; the customer's lifetime figures in a branch view are branch-scoped, not
  lifetime overall; a purchase with 0 revenue counts as a purchase (canonical definition); segment growth fields cannot choose their own lookback (they use the configured default);
  REWARD_AVAILABLE has no recorded "earned at" moment (detectedAt is null); signals are recomputed on request, so there is no history of signals that have since stopped being true; LOYALTY_LEVEL_UP
  and LOYALTY_UPGRADE appear only while Loyalty 2.0 is on; the default thresholds were chosen without real purchase history (2 real customers) and must be tuned; no Phase 13 trigger consumes the
  candidate feeds yet; refund / return reversal is still not modelled, so a refunded sale keeps counting.
- Phase 16 limitations: signal / opportunity reasons are English sentences produced by the server (Admin wording) shown next to Uzbek labels in the Staff app; name search is ASCII-case-insensitive only (SQLite LIKE — a Cyrillic name typed in a
  different case may not match) and a last-4-digits phone search is not supported; the existing lazy loyalty-code creation on the search path (Phase 11) is unchanged; Recent is per staff account (its audit trail), not per device;
  a branch-scoped lifecycle describes the customer at that branch only; the 2 / 200 / 5 000 measurement used ~60 / ~260 / ~5 060 customers (the 2 real customers plus verification fixtures); the 60 s audit de-duplication window and the
  20-row search / page caps are constants, not Admin settings; no authenticated Staff request was made against the real DB, so the live login -> profile path was exercised on the copy only.
- Phase 18 limitations: POS purchases reach a branch row only after the real POS import has run AND the Poster spot is mapped to a Branch (`Branch.posterSpotId`) — both are still owed, so today every branch figure is CUP-only and any
  unmapped purchase appears only in the all-branches totals; loyalty points without an order, reward / promotion redemptions without an order and referrals whose purchase key cannot be resolved are never given a branch (shown as unattributed); reward availability is
  customer-level, not something the branch earned; the growth block is as of today with the default lookback, not the selected period; branch shares are percentages of MAPPED-branch totals (unmapped is reported separately); "returning" differs from Analytics V1 only
  for customers whose first purchase was at another branch inside the period (both are shown); a cohort-by-first-purchase-month view was not built; the all-branches daily chart is revenue only (Analytics V1's series — daily orders / customers exist per branch);
  branch detail costs ~55 SQL statements (constant) and ~300 ms at ~5 100 customers, dominated by one customer-window query — fine now, worth caching only if the customer base grows by an order of magnitude; the 1-decimal percentages can show 0% for a very small branch
  among many; refund / return reversal is still not modelled; branch metrics inherit the Phase 11.2 POS-import semantics untouched.
- Phase 19 limitations: refund / return of a CLOSED receipt is unverified (no example exists in the account) and an imported receipt is never reversed automatically; Analytics V1 counts the QUANTITY of a POS line whose paid amount is 0 (a free line, e.g. #11) while its revenue is the paid amount
  (reward progress counts paid units only) — a 1-unit difference today, left unchanged; a real import also writes 6 CUP-order link rows; the CUP-originated safety net relies on an undocumented Poster field (application_id) and only ever skips; preview calls Poster once per still-unlinked CUP order (<= 100)
  until the first real import caches the links; the mapping is created only by the existing Poster spot sync (the spot-sync and catalog-sync routes `POST /branches/sync` / `POST /catalog/sync` are pre-existing UNAUTHENTICATED routes — not changed by this phase, flagged for a security review); branch "iwyoqar" carries a
  stale name (Poster calls spot 1 "Cup Coffee Jizzzax") until a spot sync runs; history filters use UTC calendar days; customer-name filter is a substring match; data-quality live scan is bounded to one window (<= 31 days / 1 000 receipts); no import-run table (traceability = imported rows' importedAt / status).
- Phase 20 limitations: it is not active in the real environment until the owner completes the activation steps, and a real Poster-originated webhook has not been observed (Poster documents neither when a `transaction` webhook fires nor its retry interval; the design does not depend on either — every event is a hint, the receipt is re-read, the reconciliation is the safety net);
  a sale appears in CUP only after the settling delay (default 10 min) — lowering it is possible but it exists so a CUP-created receipt's link can resolve first (an undocumented application_id safety net skips unlinked ones); receipts of anonymous / unlinked Poster customers are never imported (the reconciliation re-reads them only inside its overlap window, so link the customer soon or use the reviewed admin import);
  refunds / returns are still unverified: a Poster-removed receipt that was imported is flagged for review, never reversed; the queue is a SQLite table drained in-process (one worker per process, safe across processes through compare-and-set; no external queue by design); DEAD events need a manual retry; the processor tick and the reconciliation are in-process timers (a stopped backend processes nothing until it starts again — the boot-time catch-up and the reconciliation then recover everything within the lookback);
  the webhook route is public by necessity (protected only by the signature; MD5 is what Poster documents); no rate limiting beyond the 1 MB body limit (no limit is documented by Poster); a webhook for another entity (incoming_order, client, ...) is deliberately ignored — CUP's own order status still comes from its polling; `POST /branches/sync` and `POST /catalog/sync` remain unauthenticated (pre-existing).
- Phase 21 limitations: NOTHING about the real POS runtime is verified — the simulator proves the widget's own logic only. The key open question is whether an ordinary `Poster.makeRequest` carries a signature (no fallback exists by design); `POS_WIDGET_PUBLIC_URL` must equal the URL Poster signs byte-for-byte; the signature does not cover the `X-Poster-*` context headers (the account pin is a secondary check) and a captured signed GET can be replayed for the same URL inside the freshness window (read-only, masked data); the widget shows the CUP display name, which can differ from the Poster client's name (client 2: phone matches, names differ); Poster order totals are not shown (units unverified); visits inherit the Phase 11.2 semantics and refunds stay unmodelled; the endpoint has no rate limit beyond the signature; the notification de-duplication is in memory; popup sizing / scrolling and Development-mode behaviour are unverified; the UI is Uzbek only; production bundle upload (`application.uploadPOSPlatformBundle`) is deliberately not scripted; Admin / Staff / Mini App were not touched.
- Scanner hardware (QR camera / Code128 / keyboard wedge) never tested on a device.
- Backups `prisma/dev.db.pre-phase11.bak` and `dev.db.pre-phase11.2.bak` can be deleted by the owner.
