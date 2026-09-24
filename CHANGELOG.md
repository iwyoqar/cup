# Changelog

## Finance V2 Step 2 — Revenue Reconciliation (2026-09-24)

New `Admin → Finance → Reconciliation` tab + `GET /admin/finance/reconciliation`: a read-only verification layer around the existing canonical revenue (`AnalyticsRepository.cupTotals`/`posTotals`, unchanged) that reuses `PosterTransactionImportService.analyze()` (the same live-Poster read-only scan the import preview already uses). Shows Poster gross qualifying sales split into CUP-originated vs independent POS (already-recognized vs pending, by reason), customer/branch attribution (unattributed is never excluded revenue), excluded transactions by reason, and a RECONCILED/MISMATCH/INCOMPLETE status from cross-checking the live scan's own "already imported" total against the canonical stored revenue for the same window.

Verification against real local data surfaced a genuine historical artifact: 8 old dev.db rows imported before the 2026-09-22 money-scale fix still carry values 100x too large (the fix was never applied retroactively, as documented). Checked production directly (read-only) and confirmed clean — 0 of 25 production rows predate the fix. Nothing was changed; per the task's own instruction, a real discrepancy is reported, not silently corrected.

`npx tsc --noEmit` / `npm run build` clean on both backend and `admin/`. No schema change. Not yet deployed.

## POS import now counts customer-unlinked receipts (2026-09-24)

`PosterImportedTransaction.customerId`/`posterClientId` are now nullable. A closed, paid receipt with no Poster client, or one whose client isn't linked to a CUP customer, is imported anonymously instead of being skipped — so Analytics/Finance revenue reflects real total sales, not just the subset attributable to a known customer. A receipt bearing Poster's `application_id` marker with no resolved customer link is still skipped (never guessed). Every per-customer consumer already filters by a specific customerId, so anonymous rows are automatically excluded from rewards/loyalty/CRM/Customer 360; `AnalyticsRepository.posCustomerIds` got an explicit non-null filter so they don't inflate the customer count.

Verified live against the real Poster account: a real import of 2026-09-01..24 grew from ~28 to 52 importable receipts; 41 of the 52 landed anonymous, 21 with a real customer; Analytics revenue and customer counts both came out correct. `npx tsc --noEmit` / `npm run build` clean on both backend and `admin/`. Postgres migration ready (`0004_pos_import_allow_anonymous`). Not yet deployed.

## Finance & Accounting Dashboard (2026-09-24)

New `Admin → Finance` section: full P&L waterfall (Revenue → COGS → Gross Profit → Operating Expenses → Operating Profit → Taxes/Interest/Other Financial Costs → Net Profit), Cash Flow, configurable Expense categories, Loans (principal vs. interest kept separate), configurable Tax rules, Investments, and Payback/ROI. 8 new Prisma models. Revenue reuses `AnalyticsRepository` verbatim (no double-counting). COGS is read live from Poster's own recipe/"Dish" data per product (`menu.getProduct`, synced every 30 min) — verified live against the real account; the real menu has no recipes configured yet, so COGS/Gross Profit show an explicit "Data incomplete" banner naming the affected products rather than guessing. Inventory-purchase cash tracking and a dedicated payroll system were found to have no underlying data anywhere (Phase 1 audit) and are explicitly left as known gaps rather than fabricated — payroll folds into a "Salaries" expense category instead.

`npx tsc --noEmit` / `npm run build` clean on both backend and `admin/`. Manually verified end-to-end in a real browser: created a real loan, tax rule, expense and investment and confirmed Overview/P&L/Cash Flow/Payback are all mutually consistent. Not yet deployed — Postgres migration is hand-authored and ready (`prisma/postgres/migrations/0003_finance_accounting_v1/`).

## Fix — real POS purchases no longer wait 10 minutes to appear in reward progress (2026-09-24)

Root cause: `POSTER_IMPORT_SETTLE_SECONDS` (10 min) was applied to EVERY closed receipt uniformly, but it only ever protected against one specific race — a CUP Mini App checkout receipt being imported as a bare POS sale before Poster reports its `incoming_order.transaction_id` link back (see `TOO_RECENT`'s own original comment: "a settling delay... it only gives Poster time to report the receipt link of a CUP-created order first"). A receipt rung up directly at the register was never at risk of that race, yet waited the same 10 minutes for no reason.

Fixed: the wait now only applies to receipts carrying Poster's `application_id` marker (undocumented, but consistently observed — verified live against 78 real transactions: every known CUP-order receipt has it, every register-rung receipt does not). A receipt without it skips straight to the normal closed/paid/client-linked checks — no wait at all.

Not changed: `POSTER_RECONCILE_INTERVAL_MS`'s 60-second floor (`env.schema.ts`, `min(60000)`) — deliberately left in place. The reconciliation loop re-scans a multi-day Poster window every tick; running it every few seconds would put continuous heavy load on Poster's API for a purely cosmetic latency gain, with a real risk of the account being rate-limited. Real observed latency for a POS-native purchase is now bounded by the reconciliation tick alone: 0–60 seconds (previously up to ~11 minutes). Sub-minute, near-instant delivery would need working Poster webhooks, which remain blocked on Poster's own side (Phase 27.1, parked).

`npx tsc --noEmit` and `npm run build` both clean.

## Behavior change — "5+1"-style rewards now count VISITS, not units (2026-09-24)

Owner decision: a customer buying 5 coffees in a single visit must NOT by itself complete a "5 visits, 6th free" cycle — only 5 separate qualifying purchases do, matching the classic punch-card model. One CUP order or one imported Poster POS transaction, containing at least one qualifying-category item, now counts as exactly 1 toward the threshold regardless of how many qualifying items or what quantity that visit contains (2 different coffees in the same receipt still count as 1 visit, per the owner's explicit choice).

Added `RewardProgressRepository.countQualifyingOccasions(ForCustomers/Tx)` (`reward-progress.repository.ts`) alongside the existing `sumQualifyingQuantity*` methods, which are kept unchanged and still mean "total units ever bought" — Loyalty2's `CATEGORY_UNITS` achievement and the CRM `LOYALTY_MILESTONE` "lifetimeCoffeeQuantity" metric still need that original meaning and were deliberately left untouched. Switched to the new occasion-counting method: `RewardProgressService.getProgress`/`getAvailableForCustomers` (customer-facing progress/eligibility), `RewardRedemptionService.createRedemptionRecord`'s transaction-consistent re-check (must match the same rule the progress display promised), and `automation-trigger.service.ts`'s `REWARD_UNLOCKED` trigger (must match the reward engine's own math or CRM messages would fire at the wrong threshold).

Verified against real local data: an existing customer's totals genuinely differ under the two rules (58 summed units vs. 14 qualifying visits), confirming the new query runs correctly against real purchase history. `npx tsc --noEmit` and `npm run build` both clean.

## Bug fix — 24 of 29 products missing from CUP's catalog (2026-09-23)

Root cause: these products all carry `menu_category_id: "0"` from Poster's `menu.getProducts` — Poster's own sentinel for "on the register's Top screen quick-access grid, filed under no category tab", not a data error (Poster reports the literal `category_name: "Top screen"` directly on each). `CatalogService.sync()` treated an unresolvable category as a skip, so all 24 (both Cappuccino sizes, Latte, Flat White, Raf, Mocha, Cortado, iced drinks, pastries, water, add-ons) were silently absent from `Product` — never importable, never reward-eligible, never visible in CUP.

Fixed: `sync()` now creates a real fallback `Category` for any `menu_category_id` not covered by Poster's category list, named from the product's own `category_name` (never invented). `PosterProduct` gained the `category_name` field. Verified live: 29/29 products now sync (previously 5/29). Continuous sync (`CatalogSyncJob`, every 5 min, already running since Phase 0) needed no changes — production self-heals on its next tick after deploy.

Owner decision applied same day: 16 of the 24 (Cappuccino x2, Latte x2, Flat White, Raf, Mocha, Cortado, iced Americano/Latte, Cold Brew, Espresso Tonic, Affogato, Pourover, guest Espresso, extra Espresso shot) are real coffee drinks and are explicitly filed into the real "Кофе" category (`TOP_SCREEN_COFFEE_PRODUCT_IDS` in `catalog.service.ts`, a named/reviewable list, not name-inference) — they now count toward the "5+1" reward. The remaining 8 (water, pastries, milk/syrup add-ons) stay under "Top screen" and do not. Verified live: "Кофе" now has 20 active products, 29/29 total still sync.

## Phase 27.1 — production Poster webhook verification (2026-09-23)

Audited and live-verified the Phase 20 webhook/reconciliation pipeline against the real production account. No architectural or code defect found — reconciliation is healthy and is the fully-working sync path today (checkpoint advancing every 60s, `ok: true`, `caughtUp: true`, nothing lost). Webhook delivery has never fired because the URL was never saved on Poster's own dashboard; attempting to save it hit an unresolved Poster-side blocker (dashboard "Check" fails even though the endpoint is independently verified healthy — 200 responses, valid TLS chain, documented response body). Two response-body experiments (`{"status":"accept"}` matching docs, then an undocumented `{"status":"200"}` probe at the owner's request) were tried live and neither changed the outcome; reverted to the documented value. Parked — `POSTER_SYNC_ENABLED` stays on, reconciliation continues as the primary mechanism in practice. Re-audited duplicate-safety guarantees (webhook dedupeKey, import pre-check, `posterTransactionId` unique constraint) — all three confirmed intact and unchanged.

`src/modules/poster-sync/poster-webhook.controller.ts` — only net change is an expanded comment documenting what was ruled out, so this isn't reinvestigated from scratch later.

## Phase 24.1 — branch-intelligence / automations made PostgreSQL-compatible, code-complete (not deployed) (2026-09-22)

Second pass on the same day: resolves the two blockers the first Phase 24 pass explicitly flagged instead of fixing.

Added
- `src/common/prisma/sql-dialect.ts` gains three helpers: `epochMsCastSql(column)` — projects a native DateTime column as an epoch-ms integer inside a CTE (Postgres: `CAST(EXTRACT(EPOCH FROM col) * 1000 AS BIGINT)`; SQLite: `CAST(col AS INTEGER)`, byte-identical to the expression it replaces); `dayBucketFromEpochMsSql(column, offsetMinutes)` — local-calendar-day bucketing for a column that is ALREADY an epoch-ms integer (the counterpart to the existing `dayBucketSql`, which instead takes a native timestamp column directly); `epochMsParam(ms)` — converts a plain epoch-ms number for a raw-SQL comparison against a native DateTime column (Postgres: `new Date(ms)`; SQLite: the number unchanged).

Fixed (`branch-intelligence.repository.ts`, Phase 18)
- `PURCHASES` CTE's two `CAST(... AS INTEGER)` (orders.createdAt, poster_imported_transactions.occurredAt) and `loyalty2Accruals`'s local `src` CTE (same two columns) now use `epochMsCastSql`. `dayExpr` (used by `activity`/`dailySeries`) now calls `dayBucketFromEpochMsSql('t', offsetMinutes)` instead of a hardcoded `strftime`.
- `topProductPerBranch`, `pointsLedger`, `rewardRedemptions`, `promotionRedemptions`, `referrals` each compare directly against a raw native DateTime column (`orders.createdAt`, `poster_imported_transactions.occurredAt`, `loyalty_transactions.createdAt`, `reward_redemptions.redeemedAt`, `promotion_redemptions.redeemedAt`, `referrals.qualifiedAt`) rather than through the `PURCHASES`/`SEQUENCED` CTE's `t` alias — every `r.from`/`r.to` parameter in those specific comparisons now goes through `epochMsParam()`.
- Every OTHER comparison in the file (`branchRows`, `totals`, `activity`'s range filter, `dailySeries`, `customerIdsAtBranch`, `customersWithLoyaltyAccount`, `loyalty2Accruals`'s range filter) compares against the CTE's own `t`/`s.t` alias, which `epochMsCastSql` already normalizes to a plain epoch-ms integer in both dialects — these needed NO change, by design.

Fixed (`automations.repository.ts`, Phase 13)
- `purchaseEventsAfter`'s two `CAST(... AS INTEGER)` (orders.createdAt, poster_imported_transactions.importedAt) and `lastPurchaseBetween`'s two (orders.createdAt, poster_imported_transactions.occurredAt) now use `epochMsCastSql`; their downstream range/cursor comparisons are against the resulting `t`/`lastAt` alias, unchanged.
- `birthdayCustomers`: the `strftime('%m-%d', ...)` WHERE-clause match now uses the existing (previously unused) `monthDaySql('"birthDate"')` helper; the SELECTed `birthDate` column's CAST now uses `epochMsCastSql` (kept as an epoch-ms integer, matching the existing `new Date(num(r.birthDate))` row mapping — no mapping-function change needed).
- `cartsInactiveBetween`'s CASE expression (`c.updatedAt` vs `MAX(i.addedAt)`) — all four `CAST(... AS INTEGER)` now use `epochMsCastSql`.
- `lastPurchaseAt` (pure Prisma `.aggregate()`, returns real `Date` objects via `.getTime()`) and `firstPurchaseTimes`/`spendUpTo`/`redemptionCountsUpTo` (pure Prisma query builder throughout) were confirmed already dialect-agnostic — no raw SQL, no change.

Preserved (explicit instruction: "preserving existing service contracts and behavior")
- `RangeMs { from: number; to: number }` and `EventCursor { t: number; src: string; id: string }` are byte-for-byte unchanged. No service, controller, or caller of either repository needed any change — the fix is entirely internal to the two repository files' raw SQL.

Verified
- Backend `tsc --noEmit` clean, `npm run build` clean, widget `tsc --noEmit`/build clean, `prisma:validate:prod` clean (schema/migrations unchanged — only application SQL changed).
- Manual verification against real `dev.db`: ran every affected method on both repositories (`branchRows`, `totals`, `activity`, `topProductPerBranch`, `dailySeries`, `customerIdsAtBranch`, `customersWithLoyaltyAccount`, `pointsLedger`, `loyalty2Accruals`, `rewardRedemptions`, `promotionRedemptions`, `referrals`, `purchaseEventsAfter`, `lastPurchaseBetween`, `birthdayCustomers`, `cartsInactiveBetween`) — all returned correct, internally-consistent output against real data (e.g. branch revenue = CUP revenue + POS revenue; reward-redemption unattributed count of 10 matches the known Phase 22.3 incident).
- Full test suite re-run: same 6 pre-existing, unrelated failing files as the established baseline (`orders-flow.integration`, `orders.service`, `session.service`, `poster.service`, `catalog.service`, `orders.service.refresh-status`) — zero new failures. Neither `branch-intelligence` nor `automations` has a dedicated spec file (both are read-only, complex raw-SQL repositories verified manually since Phase 13/18), so no tests needed updating.

Not changed
- No business logic, no reward/promotion/loyalty rules, no feature flags. Real `.env` untouched. No Supabase project, no Render service — checked again this pass, still absent from the environment.

Blocked / not deployed
- Same as the first Phase 24 pass: no Supabase project or Render service exists. Deployment requires external credentials this session does not have — see PROJECT_STATE.md for the exact manual steps.

## Phase 24 — production readiness for Render + Supabase PostgreSQL, PREPARED (not deployed) (2026-09-22)

Added
- `src/common/prisma/sql-dialect.ts`: the one place the codebase decides SQLite vs PostgreSQL, and dialect-aware SQL expressions for business-local day-bucketing, hour-of-day, weekend detection, and a DateTime query-parameter helper. Needed because Prisma's SQLite connector stores `DateTime` as an integer epoch-ms column and PostgreSQL stores a native UTC timestamp — a representation difference a syntax-only `strftime`→`to_char` translation could not paper over.
- `analytics.repository.ts` (Phase 17 daily revenue) and `loyalty2.repository.ts` (Phase 12 visit days / morning / weekend purchase counts) now use that helper. SQLite branch manually re-verified against real `dev.db` data (exact query, exact output) — not just "still compiles".
- `scripts/generate-production-schema.js`: mechanically derives `prisma/postgres/schema.prisma` (PostgreSQL datasource) from `prisma/schema.prisma` (SQLite, unchanged, still the only hand-maintained schema) — one source of truth, zero drift risk, since the generated file is never hand-edited.
- `prisma/postgres/migrations/0001_init/migration.sql`: the full initial PostgreSQL schema (every table/index/FK), generated via `prisma migrate diff --from-empty --to-schema-datamodel` (no live database connection required or used). Syntactically valid, `prisma validate`-clean; **not yet applied to any real database** (no live PostgreSQL was available to test against in this session).
- `package.json`: `render:build` / `render:start` (the actual commands `render.yaml` uses — generate the prod schema, `prisma generate`/`migrate deploy` against it, then start) plus standalone `prisma:generate:prod` / `prisma:migrate:prod` / `prisma:validate:prod`. Fixed a real, pre-existing bug in passing: `main`/`start` pointed at `dist/main.js`, which has never existed (`tsconfig.json`'s `rootDir` produces `dist/src/main.js` — every local restart all project has needed the manual `node dist/src/main.js` workaround until now).
- `render.yaml`: a Render Blueprint (`autoDeploy: false`). No Render-managed database — `DATABASE_URL` is `sync: false` (the external Supabase connection string, set manually, never committed). Every reward/promotion/sync/checkout operator flag explicitly `"false"`.
- `GET /health/db`: a real readiness probe (`SELECT 1`, identical SQL on both dialects) — distinct from the existing bare liveness `GET /health`, which is byte-for-byte unchanged so anything already pointed at it keeps working.
- `app.enableShutdownHooks()` in `main.ts`: SIGTERM (what Render/any container platform sends on every deploy/restart) was previously not handled at all — Prisma's `onModuleDestroy`/`$disconnect()` never ran on a platform-initiated shutdown.
- `.env.example` files (admin/staff/frontend) gained a one-line note on production/build-time URL behavior — no dev default removed or changed.

Found, flagged, NOT fixed in this pass (resolved same day — see "Phase 24.1" entry above)
- `branch-intelligence.repository.ts` (Phase 18) and `automations.repository.ts` (Phase 13) also use SQLite epoch-ms arithmetic, but pervasively — `RangeMs`/`EventCursor` pass raw epoch-ms numbers across the repository/service boundary, not just inside one self-contained query. A correct fix means changing a completed phase's data contract end-to-end, unverifiable without a live PostgreSQL instance (none available this session) — exactly the "revisit a completed phase" this task explicitly ruled out. Both features already ship read-only/OFF, so this has zero current production impact on SQLite; it is a concrete, named blocker for full PostgreSQL parity, not an oversight. **Fixed in the Phase 24.1 pass immediately following, without changing either contract — see above.**

Not changed
- `prisma/schema.prisma`, `prisma/migrations/` (SQLite, local dev) — completely untouched; `npm run start:dev` against `dev.db` behaves exactly as before. CORS's existing "reflect any origin" policy — reviewed, left as-is (already production-reasoned: bearer JWT, no cookies, nothing ambient to leak). Env var validation — already fail-fast since Phase 0, unchanged. No business logic, no reward/promotion rules, no Poster category mapping, no feature flags flipped. `POS_REWARD_REDEMPTION_ENABLED`/`POS_PROMOTION_REDEMPTION_ENABLED` untouched in the real `.env`.

Verified
- `prisma validate` clean for both `prisma/schema.prisma` and the freshly-regenerated `prisma/postgres/schema.prisma`. Backend `tsc --noEmit` and `npm run build` clean. Widget `tsc --noEmit` and production build clean. Full test suite re-run: same 6 pre-existing, unrelated failing files as every prior phase's baseline (`orders-flow.integration`, `orders.service`, `session.service`, `poster.service`, `catalog.service`, `orders.service.refresh-status`) — nothing newly broken by this phase.
- No source file anywhere (backend or any frontend) hardcodes a `localhost`/tunnel URL — confirmed by a full-repo grep; everything already flows through env vars.

Blocked / not deployed
- No Supabase project exists yet; no Render service exists yet. The generated PostgreSQL migration has never been applied to any real database. `branch-intelligence`/`automations` repositories were not PostgreSQL-safe at the end of this pass — resolved in Phase 24.1, immediately following. Nothing was deployed.

## Phase 23 — promotion redemption on the POS widget, IMPLEMENTED, PARTIALLY BLOCKED (2026-09-22)

`FREE_PRODUCT` and `LOYALTY_POINTS` promotions have a verified-safe Poster mutation path (`FREE_PRODUCT` reuses Phase 22's already-live-verified REST call exactly; `LOYALTY_POINTS` needs no Poster mutation at all). `PERCENT_DISCOUNT`/`FIXED_DISCOUNT` have no known Poster mechanism — no API exists to set an order or line discount — and are explicitly marked unsupported, always resolving `BLOCKED_NO_VERIFIED_POSTER_MUTATION`. Full account: `docs/PHASE-23-PROMOTIONS.md`.

Added
- `PromotionRedemptionAttempt` (migrations `20260922085034_phase23_promotion_redemption_attempts`, `20260922085221_phase23_promotion_attempt_name_snapshot`, both additive): mirrors `RewardRedemptionAttempt` exactly, including its own `redeemedForPosterOrderId` unique-column backstop for "one promotion per Poster order" — a SEPARATE invariant from Phase 22.3's reward rule (a reward and a promotion may each be redeemed once on the same order).
- `POST /pos-widget/promotions/redeem`, `PosPromotionRedemptionGuard`, `PosWidgetPromotionRedemptionService`/`.repository.ts`, `PosterPromotionMutationService` — same three-phase transaction discipline as Phase 22/22.3 (claim in a short tx → Poster mutation entirely outside any tx → commit in a short tx), same Poster-order-identity resolution (widget's ms-timestamp claim → REST `transaction_id` via `date_start` match, never trusted directly).
- `PosWidgetPromotionRedemptionService`'s commit phase reuses the EXISTING, UNMODIFIED `PromotionRedemptionService.redeem()` (called outside any transaction, since it isn't transaction-aware — its own retry loop already protects `usageLimitPerCustomer` across any caller). The rare case where Poster confirms but `redeem()` then can't commit (a concurrent non-POS redemption exhausted the usage limit in that exact gap) goes to `UNKNOWN` for reconciliation — never `FAILED` (would wrongly imply nothing happened), never faked as `REDEEMED`.
- Widget: "Promolar" card gains a "Qo'llash" button per eligible promotion, shown only for `FREE_PRODUCT`/`LOYALTY_POINTS` (never for the two unsupported types, so the widget never invites a guaranteed-to-fail click) → confirm ("Bu aksiyani ushbu buyurtmaga qo'llaysizmi?") → applying → success ("Aksiya qo'llandi.") / already-applied / rejected / unknown, exact Uzbek copy as specified. Fixed a pre-existing display bug in the process: the benefit-text helper checked for `'POINTS'` instead of the real `'LOYALTY_POINTS'` benefit type, so that promotion type's description never rendered.
- `PosWidgetOverviewService`: promotions gain `promotionId` (same reasoning as rewards' `programId`) and are now wrapped as `{ redemption: { enabled }, items }`, matching the `rewards` shape.
- `PromotionsModule` exports widened (`PromotionEligibilityService`, `PromotionRedemptionsRepository`, `PromotionsRepository`) and `toRecord` exported from `promotions.service.ts`, mirroring exactly what Phase 22 did for `RewardProgramsModule`.
- `test/integration/promotion-redemption.spec.ts` (12 tests) and `test/unit/pos-widget-promotion-guard.spec.ts` (5 tests) — explicitly requested for this pass. Found and fixed a real cross-file test-isolation bug in the process: `test/db-test-helper.ts`'s shared `cleanDatabase()` now also clears reward/promotion attempt and redemption tables (previously each spec file cleaned only its own, which could leave the other's rows behind and break a later file's cleanup depending on run order).

Not changed
- The reward mutation mechanism, `POS_REWARD_REDEMPTION_ENABLED` (left exactly as found), reward-earning logic, existing customer balances, existing reward or promotion redemption records, Phase 20/21/22/22.3, loyalty calculations. `test/integration/reward-redemption-one-per-order.spec.ts` re-run unchanged as a regression check — still 9/9.

Blocked
- No real Poster mutation was performed during this implementation (the backend was down the entire time this was built). `POS_PROMOTION_REDEMPTION_ENABLED` stays `false`. `PERCENT_DISCOUNT`/`FIXED_DISCOUNT` have no path to production without a genuinely new Poster capability. `FREE_PRODUCT`'s mechanism is proven (reused from Phase 22) but not yet exercised end-to-end through this specific flow on a real order — recommended before enabling.

## Phase 22.3 — safety fix: one Poster order = maximum one reward redemption (2026-09-22)

Fixes a real incident: 10 sequential (non-racing) redemption clicks on one Poster order each independently succeeded — every
click was individually a valid, legitimately-earned reward, but nothing capped how many of a customer's banked rewards could be
spent on ONE order. ~10 free drinks were given away for real on two now-closed Poster orders. Full account: see the Phase 22.2
state memory and this file's Phase 22.2 entry below for the go-live context this fix was needed for.

Added
- Migration `20260922083012_phase22_2_one_reward_per_poster_order` (additive): `RewardRedemptionAttempt.redeemedForPosterOrderId String? @unique` (the DB-level backstop — only ever set on a REDEEMED row, to its own `posterOrderId`) and an index on `[posterOrderId, status]`.
- `RedemptionFailureReason` gains `REWARD_ALREADY_REDEEMED_FOR_ORDER`.
- `PosWidgetRewardRedemptionRepository.findRedeemedForPosterOrderTx` / `.findUnresolvedForPosterOrderTx` — the two new per-order checks, run inside the same short "claim" transaction (Phase A) as the existing customer+program concurrency guard, before an attempt is ever marked `POSTER_MUTATING`.
- Widget: `redeemedOrderId` in local state hides the "Sovg'ani ishlatish" button once the current order is known to have used its one reward; a dedicated Uzbek message ("Bu buyurtma uchun sovg'a allaqachon ishlatilgan.") for the new failure reason. Cosmetic only — the server enforces the rule regardless.
- `test/integration/reward-redemption-one-per-order.spec.ts` (NEW — explicitly requested for this pass, unlike the rest of Phase 22): 9 tests against the real SQLite test DB (only `PosterRewardMutationService.applyToOrder` mocked), covering first/second/different-order redemption, idempotent replay, a true concurrent race, Poster rejection, an UNKNOWN result (including that it blocks further attempts on the SAME order too), and the "10 banked, only 1 spendable per order" scenario end to end.

Changed (minimal)
- `markRedeemedTx` now also takes `posterOrderId` to write the new backstop column.

Not changed
- The Poster mutation mechanism itself (`PosterRewardMutationService.applyToOrder`), reward-earning logic, existing customer balances, existing redemption records, `POS_REWARD_REDEMPTION_ENABLED` (left exactly as it was — still `true` from the earlier go-live approval, untouched by this pass), any Poster data (no real mutation was performed during this implementation — the backend was down the entire time this was built).

## Phase 22.2 — real Poster mutation implemented and live-verified, ships OFF pending go-live approval (2026-09-22)

Added
- `PosterService.getOpenTransactions` (`dash.getTransactions status=1`, read-only) and `PosterService.addTransactionProduct` (`transactions.addTransactionProduct`, the second and only other Poster mutation this codebase makes, classified success/definite-failure/ambiguous-failure exactly like `createOrder`).
- `PosterRewardMutationService.applyToOrder()`: a real implementation. Resolves the widget's claimed order (a ms-timestamp) to a REST `transaction_id` by matching `date_start` among currently-open transactions (never trusting the widget's own id mapping), mutates via `addTransactionProduct(price: 0)`, then re-reads the order and only reports `confirmed` if the zero-priced line is genuinely present, the total is unchanged, and no pre-existing line moved.
- `RewardRedemptionAttempt` gains real use of its `POSTER_MUTATING` status (previously reserved, unused).
- `PosWidgetModule` now imports `PosterModule` — a deliberate, scoped reversal of Phase 21's "no Poster-facing module" rule, used only by `PosterRewardMutationService`.

Fixed (found before it ever shipped, not in production)
- The first cut of the three-phase redemption flow would have run the Poster mutation (1-3 real HTTP calls) inside the same short-lived SQLite transaction used to claim the attempt row — the same class of bug already hit once this phase for a cheaper case (an audit call), except this time with real network latency against a 5s transaction timeout. Restructured into three phases: a short DB transaction claims the attempt (create + eligibility + concurrency check + mark `POSTER_MUTATING`), the Poster mutation runs entirely outside any transaction, and a second short DB transaction commits the terminal outcome.

Verified
- **Live, real Poster account, owner-approved, one disposable unpaid test order (txn 46):** a just-opened order became discoverable over REST within one 20s poll; `transactions.addTransactionProduct(price: 0)` against it succeeded, the free line appeared on the cashier's own register screen in real time (owner-confirmed by eye), and a REST re-read matched exactly (zero-priced line present, order total unchanged). See `docs/PHASE-22-AUDIT.md` §15.
- **HTTP pipeline, DB copy, flag on, real API token, no real order touched:** a redemption request with a deliberately-unresolvable `posterOrderId` correctly ran the full three-phase flow, made real (harmless — no match found) Poster REST calls, and resolved to `UNKNOWN` with zero `RewardRedemption` rows; a replay of that same attempt returned the identical state without any further Poster call.
- Backend + widget `tsc --noEmit` and production builds both clean.

Not changed
- `POS_REWARD_REDEMPTION_ENABLED` / `POS_PROMOTION_REDEMPTION_ENABLED` — both still absent from the real `.env`, both default `false`. No real customer redemption was ever attempted; the only real mutation was the one owner-approved test call against the disposable order. Phase 20 sync, Phase 19 import, the money-unit fix, category-mapping bug, checkout, promotion redemption — untouched.

Not yet done (recommended before enabling in production)
- An end-to-end `confirmed` test through the actual HTTP endpoint / real widget (only the raw REST mutation itself was tested live; the owner asked to leave test order #46 untouched afterward, so the full pipeline's confirmed path is proven by code + the DB-copy test above, not by one more live call).
- §7's POST-body Poster signature question is still unverified against a real signed POST.

## Bug fix — Poster money-unit normalization was wrong by 100x (2026-09-22)

Fixed
- `src/modules/poster/poster-money.ts`: `POSTER_PRICE_UNITS_PER_CUP_UZS` was `1`, should be `100`. Poster's wire unit is kopecks/tiyin (documented: "цена в копейках"); the Phase 10.1 decision to treat it as 1:1 with CUP so'm was made against a placeholder/test catalog and never re-verified against a real menu. Re-verified live (2026-09-22): Poster Management shows "Капучино 250 мл — 24 000.00 СУМ"; `menu.getProducts` returns raw `"2400000"` for that product; `dash.getTransaction` returns the identical raw scale for real transaction sums (confirming product price and transaction money are ONE Poster representation, not two). `2 400 000 / 100 = 24 000` — exactly Poster's own displayed price.
- This is the ONE conversion boundary in the codebase (verified: no frontend formatter in Mini App / Admin / Staff / POS widget divides or multiplies; `catalog.service.ts`'s `extractPriceMinor`, the transaction normalizer's `totalMinor`/`paidMinor`/line prices, and the reward-line reverse conversion in `orders.service.ts` all already routed through this single function). One constant change fixes catalog product prices and Poster-imported transaction money together; no per-call-site changes needed.

Verified (read-only against the real Poster account, and against a disposable DB copy on a spare port — never the live backend)
- Americano 250 ml: raw `1800000` → `18 000` so'm (matches Poster's real menu). Americano 350 ml: `2200000` → `22 000`. Espresso: `1500000` → `15 000`. All 29 live catalog products' raw prices divide evenly by 100.
- Confirmed harmless to Poster-side money: CUP never sends its own price to Poster for a normal order line (Poster prices every line from its own catalog); the only price CUP ever sends is the reward line's explicit `0`, unaffected by any factor.

Found, NOT fixed (separate, pre-existing, out of scope for a money-unit bug)
- ~24 products, including both Cappuccino sizes (Poster ids 37, 38), fail catalog sync entirely with `Unknown menu_category_id "0"` and are simply absent from CUP's `Product` table — a category-mapping issue, unrelated to money. The three most-recent real Poster receipts (ids 35, 36, 37, 2026-09-21) are `UNRESOLVED`/`UNMAPPED_PRODUCT` for the same reason, so their (currently wrong-scale, pre-fix) stored amounts were never counted by Analytics/Growth/Loyalty (only `status: IMPORTED` rows are). They must not be resolved/reimported until the category-mapping bug is fixed — and if reimported, must be reimported AFTER this money fix is deployed, not before, or they will import at the old 100x-too-large scale.
- All currently `IMPORTED` (i.e., live-counted) historical `PosterImportedTransaction` rows predate the real catalog and are Phase 9/10 test-era artifacts (amounts 300–2700, dated 2026-09-18/19/21) — already known test noise, not real money either way; left untouched, not backfilled.

Not changed
- No historical `Product.priceMinor` or `PosterImportedTransaction(Item)` rows were rewritten — the fix corrects the conversion for everything computed FROM NOW ON (next catalog sync, next Poster import), not retroactively. Phase 19/20 import/sync mechanisms, checkout, reward/promotion redemption, and every other money *contract* (percentages, basis points, discounts) are untouched — only the wrong constant. No tests written, modified, or run.

Pending (blocked — could not restart the live backend from this session; production-deploy actions are gated)
- The fix is built (`dist/`) but the **real backend process on :3000 is still running the OLD code** (it was started via `ts-node src/main.ts`, no hot-reload) — Product.priceMinor in the real DB is still wrong until it is restarted. **A human needs to restart it** (`npm run start:dev`, or however it's normally deployed), then either wait for the automatic catalog sync (`CATALOG_SYNC_INTERVAL_MS`, 5 min) or call `POST /catalog/sync` once to refresh prices immediately.

## Phase 22 — reward redemption implementation, ships OFF, blocked by Poster (2026-09-22)

Added
- `RewardRedemptionAttempt` model (`prisma/schema.prisma`, migration `20260922032032_phase22_reward_redemption_attempts`): the POS-originated redemption-attempt lifecycle, kept separate from the CUP-order-only `RewardRedemption`/`orderId`. Statuses REQUESTED → FAILED / UNKNOWN / REDEEMED, unique on `attemptId` (idempotency) and on `redemptionId`.
- `POST /pos-widget/rewards/redeem` (`pos-widget.controller.ts`, `pos-widget-reward-redemption.service.ts`, `.repository.ts`, `.types.ts`): resolves customer/program/product server-side, re-validates eligibility (reuses `RewardEligibilityService` — no second eligibility engine), enforces one-in-flight attempt per customer+program, checks `PosterRewardMutationService.isSupported()` (see below), records the attempt, audits `REWARD_REDEMPTION_REQUESTED/CONFIRMED/FAILED/UNKNOWN`. Guarded by a new `PosRewardRedemptionGuard` (flag check, then the same Poster signature auth as GET, extended to also cover the POST body).
- `PosterRewardMutationService`: `isSupported()` always returns `false` — no Poster mutation mechanism (addProduct / setOrderBonus / REST addTransactionProduct / native promotion) has been verified safe to make a product free on a real open order (see `docs/PHASE-22-AUDIT.md`). `applyToOrder()` exists for shape only; provably unreachable today, makes no Poster call.
- `POS_REWARD_REDEMPTION_ENABLED` / `POS_PROMOTION_REDEMPTION_ENABLED` env flags (`env.schema.ts`, `.env.example`), both default `false`, independent of `POS_WIDGET_ENABLED` and each other.
- Widget (`pos-widget/`): reward card gains a "Sovg'ani ishlatish" button (shown only when `redemption.enabled`) → product picker (if >1 eligible product) → confirmation ("SOVG'ANI ISHLATISH?" / product / "Mijoz uchun: BEPUL") → applying (controls disabled, no double-submit) → result (success / Poster-rejected / UNKNOWN "holatini aniqlab bo'lmadi, qayta bosmang" / generic failed with a per-reason message). `cupPost` added alongside the existing `cupGet`.
- `main.ts`: the Phase 20 JSON-tolerant content-type parser allowlist extended to also cover `/pos-widget/rewards/redeem` (same undocumented-Content-Type risk as Poster webhooks).

Changed (minimal, additive)
- `RewardRedemptionService.createRedemptionRecord` now returns the created id and accepts `orderId: string | null` (POS redemptions have no CUP order). Existing CUP-checkout callers unaffected.
- `RewardProgramsModule` exports widened so `PosWidgetModule` can reuse `RewardProgramsRepository`/`RewardEligibilityService` instead of a duplicate implementation.
- `pos-widget/overview` now includes `programId` per program, `eligibleProducts` as `{posterProductId, name}[]` (was `name[]`), and `rewards.redemption.enabled`.

Fixed (found during this phase's own manual verification, not present before)
- The first version of the redeem transaction called the audit service (non-tx PrismaService) from inside `prisma.runTransaction(...)`; under SQLite that outer-connection write contended with the open transaction and reliably exceeded Prisma's 5s interactive-transaction timeout, turning every redemption into a 500. Fixed by moving both audit calls and the (non-tx) eligibility read outside/after the transaction; the transaction now touches only `reward_redemption_attempts` (and, on the currently-unreachable confirmed path, `reward_redemptions` via the already-tx-safe `createRedemptionRecord`).

Not changed
- Phase 20 continuous sync/webhooks/reconciliation, Phase 19 POS import, Analytics V1, Branch Intelligence, Customer 360, CRM automation, Referral, existing Phase 8 reward-progress logic, Phase 21 customer identification / signature guard for GET / `showApplicationIconAt` / `applicationIconClicked`, inventory (Poster remains sole source of truth — CUP never writes it). No tests written, modified, or run.

Blocked (see `docs/PHASE-22-AUDIT.md` and the Phase 22 report)
- No Poster API is verified safe to make a reward product free on the customer's *currently open* real POS order. Every real redemption attempt today deliberately resolves to `FAILED` / `BLOCKED_NO_VERIFIED_POSTER_MUTATION` — the reward is never consumed, no fake success is ever returned. `POS_REWARD_REDEMPTION_ENABLED` stays `false` in the real environment; promotion redemption is not implemented at all (flag reserved).

## Phase 22 — reward redemption audit + experiment prep (2026-09-22)

Added
- `docs/PHASE-22-AUDIT.md`: current reward architecture, PosterService capabilities, verified vs. unverified Poster mechanisms, the `RewardRedemption` limitation, Phase 21 integration points, three candidate approaches (POS-native mutation / REST open-order mutation / Poster-native promotion + import), risks, blocking questions, decision matrix scaffold.
- `scripts/phase22-experiments/` (NOT part of the application; not built, not imported by `src/` or `pos-widget/`): read-only REST helper mirroring `PosterService`'s own auth/error-classification conventions; Experiment 3 tooling (open-order REST visibility, read-only); Experiment 1/2 browser-console script for the real POS (`orders.addProduct` / `orders.setOrderBonus`, double-gated: explicit approval in chat + an in-browser confirm()); Experiment 4 REST-mutation script (prepared, NOT executed, gated behind `--confirm` plus a typed confirmation phrase).

Executed (read-only only)
- A plumbing dry run against an already-closed, previously-imported receipt (#11) to prove auth/parsing.
- A same-day transaction-list snapshot (13 ids), read-only, as Experiment 3's "before" picture.

Not changed / not executed
- No backend, schema, widget, or reward-service code. No real order mutation. `pos-widget/src/poster.ts`'s `PosterApi` still cannot express any forbidden call. No tests written or run.

## Admin Panel UI/UX redesign (2026-09-22)

UI only — no backend, API contract, schema, auth, analytics calculation, Poster, Phase 20 or Phase 21 change.

Added (admin/)
- A design system that reuses the customer Mini App's own tokens verbatim (`ui/base.css`: black / white / cream / terracotta, serif titles, 8 / 12 / 16 radii, 120–220 ms motion; 22 tokens verified identical to `frontend/src/styles/global.css`) and a component library (`ui/`): AdminShell (Sidebar + TopBar + profile menu), PageHeader, SectionCard, StatCard, DataTable, StatusBadge / HealthBadge, EmptyState / LoadingState / ErrorState, SearchInput, FilterBar, DateRangePicker, Modal, ConfirmDialog, Tabs, Pagination, ChartContainer / BarChart / HBarList, HealthList, icons.
- One navigation config (`lib/nav.ts`, 20 pages in 7 groups) that drives the sidebar, breadcrumb and every page header.
- Pages: a real Dashboard (from the existing analytics + sync status), Sales and Analytics (two views of one page), Continuous Sync (moved out of POS Import, as a health panel), Branch Configuration, System Health, Errors, Audit, Loyalty (tabs over the two existing loyalty pages).
- `lib/health.ts` (system status from /health + sync-status only; anything the API cannot report stays "Unknown"), `lib/useAnalyticsOverview.ts`, `lib/errors.ts`.

Changed
- Every existing page moved onto the shared components / tokens (Customers, Segments, Rewards, Promotions, Campaigns, Staff, Referrals, CRM Automation, Growth, Branch Intelligence, POS Import, Login); the POS Import confirmation is now the shared Modal with the same content and gates. Old brown shell and the per-page header CSS were removed.
- Responsive: full sidebar >= 1100 px, icon rail 761–1100 px, drawer <= 760 px; secondary table columns hide on phones.

Not changed: any API call, response shape, business rule or calculation; the staged POS import workflow; the Retry action for dead webhook events.
Removed: `components/AdminLayout.tsx` (replaced by `ui/Shell.tsx`).

## Phase 21 - popup scrolling (2026-09-22)

Fixed (pos-widget CSS only)
- Real POS: the customer card was cut off at the bottom of Poster's popup and could not be scrolled (Poster clips the popup content and gives no scrollbar; the widget was a `min-height: 100vh` box that grows with its content). `.cw` is now a fixed-height column (`height: min(100vh, 560px)`), header and footer stay put and only `.cw__body` scrolls. Verified in a browser against an emulated clipped 520 x 600 popup: body scrollable, last card and footer reachable, header stays.
- Not changed: any logic, the backend, auth, Phase 20. The reward is still display-only by design (redeeming is not part of Phase 21).

## Phase 21 - widget reads makeRequest answers in either form (2026-09-22)

Fixed (pos-widget only)
- In the real POS the widget showed "CUP javobi tushunarsiz" for EVERY answer although the backend returned valid JSON (200 FOUND / NOT_FOUND / NOT_LINKED / AMBIGUOUS, signed, verified in the proxy log). `cupGet` treated `answer.result` as an already-parsed object; Poster documents `makeRequest`'s `result` only as "Response body" (`makeApiRequest`, by contrast, is documented to JSON.parse). `poster.ts` now accepts the parsed object OR the raw JSON text; anything else still fails softly.
- Reproduced before the fix (a fake `Poster.makeRequest` returning the JSON as text gave exactly that message with the shipped bundle) and verified after (both forms show the customer; non-JSON / `null` / number / `false` still give a readable soft failure).
- TEMPORARY diagnostic: `[CUP widget] first makeRequest answer: { code, resultType, resultLength, parsesAsJson }` (shape only, never content) tells which form the real POS uses; a later non-200 answer is logged with `console.error`.
- Also `scripts/serve-dev.mjs`: one log line per request and the Private-Network-Access preflight header. Unchanged: the backend, auth, Phase 20, `showApplicationIconAt`, event handlers. No tests written or run.

## Phase 21 - Poster application page (2026-09-22)

Added (pos-widget only)
- `pos-widget/connect/index.html`: the development page Poster opens for the application ("Подключить" / Manage Platform): `?poster_url=&account_number=&lang=` validated and shown via `textContent`, uz/ru/en, ignores and strips `code`, frameable, strict CSP, sends `hideSpinner`. No build step, no network calls, no secret.
- `scripts/serve-dev.mjs` now serves exactly `/` (that page) and `/bundle.js` (the widget), each on an exact-path allow-list; GET/HEAD only.

Cause of the earlier `Cannot GET /`: Poster opens the tunnel root and the tunnel pointed at the NestJS API, which has no route at `/`. No env variable was involved.

Not changed: the backend, `PosterService`, Phase 20, Phase 21 API contracts, `showApplicationIconAt` / `applicationIconClicked`, the widget bundle (byte-identical), loyalty logic. No tests written or run.

## Phase 21 - widget initialisation reliability (2026-09-22)

Changed (pos-widget only)
- First real Poster Development-mode run: no CUP item in the order (•••) menu and no request reached CUP. Cause: `poster()` read only `window.Poster` (Poster's own code uses the bare global `Poster`) and `start()` latched `started = true` before checking Poster and swallowed every init error.
- `poster.ts`: resolve the bare `Poster` identifier first (`typeof` + try/catch), `window.Poster` as fallback; `posterProbe()` diagnostic. `store.ts`: init is now idempotent steps (settings, `showApplicationIconAt`, four `Poster.on`, `getActiveUser`), each marked done only after success, missing/failed steps retried on a bounded timer, `syncFromOrder()` once; failures are `console.error` (temporary diagnostics). `main.tsx`: the last-resort catch logs.
- Unchanged: the `showApplicationIconAt({ order: 'CUP', functions: 'CUP' })` call, every event handler, the backend, auth, tests (none written or run). Build + typecheck only; not yet re-run in the real POS.

## Phase 21 — Poster POS Widget + CUP Operational Integration (2026-09-22)

Added
- `pos-widget/` — a READ-ONLY Poster POS platform plugin (Vite + React + TypeScript) building one IIFE `dist/bundle.js` with CSS injected and no secret. Customer detection on `orderClientChange` / `orderOpen` (the active order is authoritative), stale-response protection (generation counter + server-echoed `ref`), fallback lookup by CUP code / phone / mobile barcode scan (display only — never attaches a customer), 14 UI states, a non-blocking reward notification and a 520x600 popup. A typed `PosterApi` wrapper contains only the permitted Poster APIs. Local Poster simulator (`simulator/`) and a `/bundle.js`-only dev server (`npm run serve`).
- `src/modules/pos-widget/` — `GET /pos-widget/ping` and `GET /pos-widget/overview` (state FOUND / NOT_FOUND / NOT_LINKED / AMBIGUOUS). Auth = Poster's request signature (`md5(fullUrl + X-Poster-Time + POSTER_APPLICATION_SECRET)`, timing-safe compare), freshness window, pinned account; fails closed. Composes existing read services; audit via `staff_scan_events` (`POS_WIDGET_CUSTOMER_VIEW`, 60 s de-duplication, no PII).
- Env (all optional, OFF by default): `POS_WIDGET_ENABLED`, `POS_WIDGET_ACCOUNT`, `POS_WIDGET_PUBLIC_URL`, `POS_WIDGET_SIGNATURE_MAX_AGE`.
- `docs/PHASE-21-POS-CAPABILITY.md`.

Changed (small, additive)
- `CustomersRepository.findByPosterClientId`, `CatalogRepository.findActiveProductNamesByCategoryIds` (read-only lookups); `phoneVariants` in `staff-customers.service.ts` is now exported; `PosWidgetModule` registered in `app.module.ts`; env schema entries.

Not changed
- No schema change / migration, no Poster write, no Telegram message, no loyalty / reward / promotion change, no order created, Phase 20 sync untouched, Admin / Staff / Mini App untouched, no test created or modified. Nothing uploaded to Poster; the widget is not enabled anywhere.

## Phase 20 hardening — checkpoint-based reconciliation (2026-09-21)

Changed
- `PosterReconcileService` no longer reads "now - 2 days": it resumes from a durable checkpoint (Setting `poster.sync.reconcileCheckpoint`) minus `POSTER_RECONCILE_OVERLAP_MINUTES` (new, default 60), works in 2-day close-time chunks (<= 12 per pass, checkpoint saved per chunk), pages each chunk with Poster's documented `next_tr` cursor, filters on each receipt's exact `date_close`, and advances the checkpoint only over fully decided ground (held in front of a settling receipt, a failed write or the per-step cap; never backwards; not advanced when a pass fails).
  A CUP outage of any length is caught up from the last successful checkpoint. `POSTER_RECONCILE_LOOKBACK_DAYS` is now only the initial checkpoint. The 10-minute interval, the Phase 19 engine, the idempotency on posterTransactionId and webhooks-as-primary are unchanged.
- `PosterService.getClosedTransactions` accepts an optional `nextTr` cursor (read-only). `run()` can no longer throw or leave its guard set.
- Admin: `sync-status.reconciliation` = { checkpoint, lagSeconds, lastSuccessAt, lastError{at,message,resolved}, last pass }, new alerts, a "Recovery checkpoint" card; `config.reconcileOverlapMinutes`.

Not changed
- No schema change / migration, no real Poster data written, `POSTER_SYNC_ENABLED` not touched by this pass, real DB untouched.

## Phase 20 — Poster Webhook Continuous Sync & Reliability (2026-09-21)

Added
- `PosterSyncModule` (`src/modules/poster-sync/`): public `POST /webhooks/poster` (documented Poster signature, durable dedupe, acknowledge-after-commit), `PosterSyncProcessorService` (lease-based queue, coalescing, backoff, DEAD), `PosterReconcileService` (missed-webhook recovery), scheduler, and Admin `GET /admin/poster/sync-status`, `GET /admin/poster/webhook-events`, `POST /admin/poster/webhook-events/:id/retry`.
- Table `poster_webhook_events` (additive migration `20260921190000_phase20_poster_webhooks`); `PosterService.getTransactionById` (read-only `dash.getTransaction`).
- Env: `POSTER_SYNC_ENABLED` (default off), `POSTER_APPLICATION_SECRET`, `POSTER_ACCOUNT`, `POSTER_SYNC_TICK_MS`, `POSTER_RECONCILE_INTERVAL_MS`, `POSTER_RECONCILE_LOOKBACK_DAYS`, `POSTER_WEBHOOK_MAX_ATTEMPTS`.
- Admin: "Continuous sync" panel on the POS Import page (status, alerts, events, retry).

Changed (behaviour-preserving)
- `PosterTransactionImportService`: the classification and the atomic write phase are now shared functions (`classify()`, `persist()`) used by the reviewed admin import AND the automatic sync (`importTransactions()`); the admin import, its gates and its output are unchanged (verified: same preview on real data).
- `PosterImportModule` exports the import engine and repository; `main.ts` parses any Content-Type as JSON on the webhook route only (other routes keep 415).

Not changed
- Phase 19 gates, refund policy (REFUND_UNVERIFIED), attribution rules, analytics / loyalty / reward / referral logic, Staff / Mini App. Nothing is imported automatically until the operator sets `POSTER_SYNC_ENABLED=true`; no Poster write, no Telegram message; the real DB's business data is unchanged (only the new empty table was added, with a backup).

## Phase 19 — POS Import Activation & Attribution Data Quality (2026-09-21)

Added
- `GET /admin/poster/spot-mapping`, `GET /admin/poster/import-data-quality`, `GET /admin/poster/import-history` (Admin-only, read-only); `PosterSpotMappingService`, `PosterImportQualityService`, `PosterImportHistoryService`, `PosterImportReportRepository`.
- Import preview categories, per-receipt detail (date, branch, customer, total, paid, products, reason, decision), REFUND_UNVERIFIED policy, POSSIBLE_CUP_ORIGIN safety skip, deleted-receipt (status 3) warning, per-receipt FAILED / resumable batches.
- Real-import gate: `acknowledgeRefundPolicy`, `expectedImportable`, explicit window and limit (<= 100 receipts, <= 31 days), no unmapped / inactive branch in the window.
- `PosterService.getDeletedTransactions` (read-only), `PosterNegativeAmountError`, optional `PosterTransaction.application_id` type.
- Admin "Poster POS Import" rebuilt as a staged workflow (mapping, preview, data quality, history, confirmation dialog); `.pi` styles.

Changed (behaviour-preserving except where stated)
- `PosterTransactionImportService` split into `analyze()` (read-only) + `run()`; the CUP-link cache is now saved only after the gates pass. **A real import now needs the extra gate fields above** (previously dryRun:false + confirm:true was enough); a preview limit above 1 000 is clamped, a write limit above 100 is a 400.
- `createTransaction` is one explicit DB transaction and no longer treats an item-level unique violation as "already imported".
- Import lookups return display names (admin-only preview); negative amounts / quantities are REFUND_UNVERIFIED (were INVALID_TRANSACTION).

Not changed
- Analytics, Branch Intelligence, Customer 360, Growth, reward progress, referrals, Loyalty 2.0, CRM automation and legacy points logic — imported purchases flow through them unchanged. No schema change, no migration, no import-run table, no auto-import.
- Development and verification did not import. **After the owner's explicit approval the first real import was executed (7 receipts, 8 100 so'm, 2026-09-21)**; the existing Loyalty 2.0 sync then accrued 1 point / 15 so'm cashback and 2 achievements for the purchase made after its start. No Poster write, no Telegram message.

## Phase 18 — Branch Intelligence (2026-09-21)

Added
- `GET /admin/branch-intelligence/overview` (`BranchIntelligenceModule`: repository with bulk SQL, service, controller) — per-branch comparison (all branches) and single-branch detail (revenue / orders / customers by day, retention, cross-branch purchasing,
  CUP vs POS, products and categories, loyalty, rewards, promotions, referrals, growth, overview snapshot) with the definitions served next to the data.
- Admin page "Branch Intelligence" (`BranchIntelligencePage.tsx`, `adminBranchIntelligence.ts`, sidebar entry, `.bi` styles): filters, KPIs, branch table, charts, customer behavior, product intelligence, loyalty & rewards, growth intelligence, snapshot, definitions.
- `resolveAnalyticsRange` in `analytics-period.ts` (the ONE shared period resolver); `GrowthIntelligenceRepository.findBranch`; `ViewOptions.allowInactiveBranch`.

Changed (additive, behaviour-preserving)
- `AnalyticsService` resolves periods through the shared `resolveAnalyticsRange` (moved verbatim); `AnalyticsModule` exports its repository and service; `GrowthPage` exports `RfmMatrix` for reuse.
- Admin shell: below 760 px the sidebar stacks above the content (it was a fixed 220 px column at every width). No other width is affected.

Not changed
- Analytics V1 output, Growth Intelligence output, Staff panel (no branch analytics added), POS import (Phase 11.2), loyalty / reward / referral rules, Branch status. No schema change, no migration, no cache. No Poster call, no Telegram message, no loyalty / reward /
  referral mutation, no POS import. The real DB is unchanged.

## Phase 16 — Staff Panel 2.0 (2026-09-21)

Added
- `StaffProfileService` + `GET /staff/customers/by-code/:code/profile`, `GET /staff/customers/by-code/:code/activity`, `GET /staff/recent`; Search 2.0 on `GET /staff/customers/search` (20 rows, phone formats, @username, level / lifecycle / last purchase).
- Branch scope rules for Staff (default own branch, `scope=all`, `branchId` own-only -> 403, admin / unassigned may choose); `PROFILE_VIEW` audit event (60 s de-duplicated) and a Recent list derived from it.
- Staff web app: hash routes (scan / customers / recent / customer), tabs, the customer service profile (rewards, loyalty + Loyalty 2.0, promotions, customer state, activity with pagination, referral, Poster), scope switch, empty / loading / error states.
- `RewardProgramsService.redemptionSummaryForCustomer`, `ReferralsService.getStaffView`, `StaffRepository.hasRecentEvent / recentViewedCustomerIds / customersByIds`.

Changed (additive, behaviour-preserving)
- Customer 360 activity feed (`CustomerActivityRepository / Service`) and `GrowthIntelligenceService.getCustomerBlock` accept an optional branch; `StaffSearchResult` gained fields (the original three are unchanged);
  `customers.repository.searchForStaff` also selects the Telegram username; `PromotionEligibilityService` checks segment membership for the one customer (same evaluator, same result, far cheaper).
- Staff frontend: the Phase 11 scan-card screen was replaced by the profile (the Phase 11 API endpoint it used is untouched).

Not changed
- Staff authentication, roles, Poster mapping flow, StaffScanEvent schema. No schema change, no migration. No Poster call, no Telegram message, no loyalty / reward / referral mutation, no POS import. The real DB is unchanged.

## Phase 15 — CRM / Growth Intelligence (2026-09-21)

Added
- `src/modules/growth-intelligence/`: types, pure rules (RFM scoring, lifecycle precedence, signals, opportunities), settings (`growth.*`), the single bulk purchase aggregate, service, admin controller
  (`/admin/growth/{settings,branches,overview,candidates}`).
- Admin "Growth Intelligence" page (KPIs, lifecycle distribution, RFM matrix + histograms, signals, opportunities, top lists, editable thresholds, period + branch filters);
  Customer 360 `growth` block; compact "Lifecycle · RFM" column in the Customers list (`growth` on each row).
- Segments: growth fields (lifecycleState, rfmScore, rfmTotal, R/F/M scores, recencyDays, daysSince*, frequency, monetary, lifetimeRevenue, lifetimePurchases, growthSignal) with value validation;
  the Admin segment builder offers them (lifecycle / signal as selects).
- Read-only CRM trigger candidate feeds (CUSTOMER_AT_RISK / DORMANT / HIGH_VALUE / SECOND_PURCHASE_DUE / BIRTHDAY_UPCOMING).

Changed (additive, behaviour-preserving)
- `RewardProgressService.getAvailableForCustomers`, `RewardRedemptionsRepository.countsForCustomers`, `RewardProgramsService.availableRewardsForCustomers` (bulk counterparts of the per-customer reward math);
  `Loyalty2Module` exports `Loyalty2LevelsService`; `SegmentsService` / evaluator / allowlist extended (existing segments unchanged); `AdminCustomersService` adds `growth`.

Not changed
- No schema change, no migration, nothing stored. Loyalty balances, rewards, referrals, campaigns and CRM automation are untouched; no Poster call, no Telegram message, no POS import. The real DB is unchanged.

## Phase 14 — Referral System (2026-09-21)

Added
- Schema (additive migration `20260921125905_phase14_referrals`): nullable columns on `referrals` (referralCode, attributedAt, registeredAt, qualifiedAt, rewardedAt, closedAt,
  closeReason, qualifyingPurchaseKey, qualifyingAmountMinor, checkedAt, updatedAt) + indexes; tables `referral_codes` and `referral_rewards`.
- `src/modules/referrals/`: code helpers, settings, attribution, pure qualification rules, qualification job + reconciler, reward service (exactly-once), events, read
  models, customer controller (`GET /referrals`, `/referrals/history`), admin controller (`/admin/referrals/{settings,summary,'',:id}`).
- Telegram: `/start ref_<code>` attribution (`TelegramRegistrationService.handleStart(profile, payload?)`), phone registration advances ATTRIBUTED -> REGISTERED, the bot
  pushes its username into `ReferralBotIdentityService`.
- Env `REFERRAL_RUN_INTERVAL_MS` (default 60000) and optional `TELEGRAM_BOT_USERNAME`; `SettingsService.getString/setString`.
- Admin "Referrals" page (dashboard, rules, filterable list, read-only detail); Customer 360 `referral` block; Mini App referral section with Telegram share.

Changed (additive, behaviour-preserving)
- `LoyaltyService.creditPointsTx` returns the ledger row id (was void); `Loyalty2Repository.qualifyingPurchasesForCustomers` (bulk, same definition) and the shared
  `comparePurchases`; `Loyalty2Module` exports `Loyalty2Repository`; `TelegramModule` imports `ReferralsModule`; the legacy `loyalty2.referralEnabled` label in Admin.

Not changed
- Loyalty balances, reward engine, promotions, checkout, Campaigns / CRM automation. No Poster call, no POS import, no Telegram message, no real referral or reward.
  The program ships OFF; the real DB holds no referral row, code or reward.

## Phase 13 — CRM Automation & Customer Engagement (2026-09-21)

Added
- Schema (additive migration `20260921115933_phase13_crm_automation`): tables `automations`, `automation_executions`, `automation_send_slots`, `crm_daily_slots`.
- `src/modules/automations/`: config (strict per-trigger schemas, message-variable allowlist), time helpers (business timezone, quiet hours, birthday, schedule),
  settings, repository, events, triggers (7 read-only bounded evaluators), eligibility, message personalisation, execution (claim / reserve / deliver),
  runner, dry-run preview, service, controller (`/admin/crm/*`).
- Triggers: FIRST_PURCHASE, REWARD_UNLOCKED, BIRTHDAY, INACTIVE_CUSTOMER, ABANDONED_CART, LOYALTY_MILESTONE, SCHEDULED_SEGMENT with idempotent trigger keys.
- Guards: Telegram account, segment, cooldown, frequency cap, global daily cap, quiet hours (deferral); DB-level reservation rows for concurrency safety.
- Gates: Admin `crm.automation.enabled` (default off) + env `CRM_AUTOMATION_SEND_ENABLED` (default false). Env `AUTOMATION_RUN_INTERVAL_MS` (default 60000).
- Admin "CRM Automation" page (settings, list, create/edit, detail, preview, execution history); Customer 360 "CRM automation activity" (`crmActivity`).

Changed (additive, behaviour-preserving)
- `CampaignMessagingService.deliver` (public single-send; `sendOne` reuses it); `CampaignsModule` exports its services; `CampaignsService.delete` maps a foreign-key
  violation to a friendly conflict; `SegmentsService.filterCustomersInSegment`; `RewardProgressRepository.sumQualifyingQuantityForCustomers`; `Loyalty2Module`
  exports `Loyalty2SettingsService`; `AdminCustomer360` gains `crmActivity`.

Not changed
- Campaign engine behaviour, segments, rewards, loyalty balances, promotions, checkout. No Poster call, no Telegram message, no order, no reward or loyalty
  mutation. The real DB holds no automations; CRM ships OFF.

## Phase 12 — Loyalty 2.0 (2026-09-21)

Added
- Schema (additive migration `20260920182323_phase12_loyalty2`): `customers.birthDate` (nullable) and tables `loyalty_levels`, `loyalty_accruals`,
  `cashback_transactions`, `achievements`, `customer_achievements`, `loyalty_level_ups`, `birthday_reward_claims`, `referrals`.
- `src/modules/loyalty2/`: math (levels, XP, streak, birthday, cashback, points), settings, levels, achievements, progress, profile (read model),
  sync (idempotent writer), history (cursor feed), birthday, defaults seeder, background job, customer + admin controllers.
- API: `GET /loyalty/overview`, `GET /loyalty/history`, `PUT /loyalty/birthday`; `/admin/loyalty2/{settings,levels,achievements}`.
- Env `LOYALTY2_SYNC_INTERVAL_MS` (default 120000).
- Admin "Loyalty 2.0" page (program switches, levels editor, achievements editor); Customer 360 `membership` block.
- Mini App: premium loyalty view (level, XP bar, points + cashback wallets, streak, birthday, achievements, history) that falls back to the
  existing points section while the program is off.

Changed (additive, behaviour-preserving)
- `LoyaltyService.creditPointsTx` (the same EARN ledger write inside a caller transaction); `LoyaltyModule` exports `LoyaltySettingsService`;
  `RewardsModule` exports `RewardProgressRepository`; `afterCursor` exported from the customer-activity repository; `PUT` added to the
  Mini App and Admin HTTP clients.

Not changed
- Existing loyalty points, reward engine, promotions, checkout/idempotency, analytics definitions; no Poster call, no Telegram message, no order
  created. The program ships OFF; the real DB holds only the seeded configuration.

## Phase 11.4 — Unified Customer 360 (2026-09-20)

Added
- Admin Customer 360 unified summary (CUP + imported POS): totals, average check, first/last purchase, CUP/POS breakdown,
  unified favorite branch, active reward count, loyalty balance, promotion count; plus recent loyalty ledger, reward history,
  read-only applicable promotions, matching active segments and a recent-activity timeline (all additive fields).
- `GET /admin/customers/:id/activity` — bounded cursor-paginated unified activity (CUP, POS, loyalty, reward redemptions).
- Bounded reads: `CustomerMetricsService.getSummaryForCustomer` / `getRecentOrdersForCustomer`,
  `SegmentsService.listMatchingForCustomer`, `PosterImportedActivityService` first/last/per-branch figures.
- Rebuilt Customer 360 page (KPIs, source breakdown, rewards, activity table with Load more, promotions, segments, Uzbek
  empty/error states, responsive).

Changed
- `profile.phone` in Customer 360 is masked. `PromotionsModule` now exports `PromotionsService` (read-only reuse).
- Admin layout: `.admin-content { min-width: 0 }` so wide tables scroll inside their wrapper.

Not changed
- No migration, no Poster call, no Telegram message, no loyalty/reward/order mutation, real POS import not run.

## Phase 11.3 — POS → Reward Integration (2026-09-20)

Changed
- Reward progress now derives from ONE unified purchase history: qualifying CUP order items + qualifying imported Poster POS
  items (`RewardProgressRepository.sumQualifyingQuantityWith`, two local aggregate queries). Both the customer-facing progress
  (`GET /loyalty/rewards`, eligibility) and the in-transaction redemption re-check use it, so a reward can be earned from any mix
  of CUP and POS coffees and redeemed once. The 5+1 (X+Y) semantics, redemption records and API/UI contract are unchanged.
- Admin Customer 360: additive `rewards` block (per active program: qualifyingCount / threshold / availableRewards) from the same
  reward service, and the Activity note now states that POS purchases count toward rewards but add no loyalty points.

Rules (see DECISIONS.md D113-*)
- Only POS rows with status `IMPORTED` (paid, resolved, customer-linked, non-CUP-originated) with a mapped product in the program's
  qualifying category, whole positive quantity and a paid line count. Reward items, unresolved/skipped/unpaid POS rows and
  cancelled/failed/uncertain/pending CUP orders never count. `posterTransactionId` uniqueness prevents double counting.

Known limitation
- Poster refund/return behaviour is unverified; POS purchases are never subtracted, so a refunded POS sale keeps its reward credit.

Not changed
- No schema migration, no new endpoint/service/table, no Poster call, no Telegram message, no loyalty-points change, and the real
  POS import was NOT run (real DB: posterImportedTransactions 0, rewardPrograms 0, rewardRedemptions 0).

## Phase 17 — Analytics Dashboard V1 (2026-09-20)

Added
- `GET /admin/analytics/overview` (admin session only): revenue, orders, customers, average check, daily revenue,
  CUP/POS source breakdown, top 5 products, new vs returning customers. Query: `period` (today | yesterday | last7 | last30 |
  custom), `startDate`/`endDate` (custom), `branchId`.
- `src/modules/analytics/` — `AnalyticsRepository` (Prisma aggregations), `AnalyticsService`, `AnalyticsController`,
  `analytics-period.ts` (business-day boundaries).
- Env `BUSINESS_TIMEZONE_OFFSET_MINUTES` (default 300).
- Admin: "Analytics" page and sidebar entry — filters, KPI cards, SVG revenue chart, source panel, customers panel, top products
  table, loading skeleton, empty state, error state with Retry.

Not changed
- No schema migration, no new tables, no loyalty / reward / Poster / Telegram behaviour changes, no POS import performed.

## Phase 11.2 — Poster POS transaction import foundation (2026-09-20)
- `src/modules/poster-import/`, admin `POST /admin/poster/import-transactions` (preview by default), tables
  `poster_imported_transactions`, `poster_imported_transaction_items`, `poster_incoming_order_links` (empty in the real DB).

## Phase 11.1 / 11 — Customer identity, Staff Panel, POS import design
- `Customer.loyaltyCode`, QR + Code128 in the Mini App, `staff/` app with own JWT, Poster client linking.
  See `docs/PHASE-11-CUSTOMER-IDENTITY.md`, `docs/PHASE-11.1-POS-IMPORT-DESIGN.md`.

## Earlier phases (0 – 10.1)
- Poster catalog/order integration, Telegram bot + Mini App, cart/checkout, loyalty, promotions, campaigns, reward programs,
  admin panel; money unit settled (Phase 10.1). See `docs/PHASE-0-PLAN.md`, `docs/PHASE-1-DESIGN.md`.
