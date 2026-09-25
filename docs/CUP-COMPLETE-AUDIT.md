# CUP COMPLETE SYSTEM AUDIT

**Read-only audit. Date: 2026-09-25. No code, schema, or data was modified to produce this document.**
**Method:** direct reading of the actual repository (`D:\cup`) at the current commit, the full Prisma schema, `.env`/`.env.example`, all 25 SQLite + 5 Postgres migrations, two exhaustive sub-agent passes (endpoint inventory, module inventory) cross-verified by direct file reads, local SQLite `dev.db` read-only counts, backend/Admin/Mini App/Staff/POS-widget production builds, and public (unauthenticated) production health checks. Production business data (customer/order/finance counts) was **not** re-pulled in this pass — see §8.

---

## 1. Executive Summary

CUP is a single coffee-shop's operational platform built around one hard constraint: **Poster POS is the point of sale, CUP is everything else.** CUP never touches inventory or till hardware; it layers a Telegram Mini App (ordering, loyalty, rewards, referrals), an Admin panel (14 functional areas), a Staff panel (till-side customer lookup), and a Poster POS iframe widget (loyalty/reward lookup at the register) on top of Poster's own transaction data, which it imports read-mostly and mutates in exactly two narrow, explicitly-gated ways (creating a CUP-originated order, and, since Phase 22, adding a zero-price reward line to a live POS order).

What actually exists today, in one paragraph: a NestJS/Fastify backend (52 Prisma models, 32 feature modules, ~140 HTTP endpoints) backed by SQLite in dev and Postgres (Supabase) in production; a fully custom (non-Tailwind) design system shared by three of the four frontends; a real, working revenue/analytics/finance/reporting stack that is unusually careful about not double-counting CUP-originated vs. independent POS revenue; a loyalty system with **two parallel, overlapping ledgers** (see §21); a CRM/growth/referral layer that is functionally complete but shipped with hard **off-by-default** interlocks; and **zero inventory, zero purchasing, and zero payroll implementation** — not partial, not foundation-only, simply absent from the schema entirely (§6, §16, §18, §19).

The single most important finding of this audit is not architectural: it is one unauthenticated, unguarded HTTP endpoint (`POST /orders`) that creates a **real Poster POS order** for **any customer ID an anonymous caller supplies** (§9, §31, §40). Everything else in this audit is secondary to that.

## 2. Architecture

```
Telegram --/start, contact--> TelegramModule --> CustomersModule --> Customer (CUP identity)
                                                        |
Telegram Mini App --initData--> AuthModule (HMAC verify, own JWT) --> CartModule --> OrdersModule --Poster.createOrder--> Poster POS
                                                                                          |
                                                                                   NotificationsModule --> Telegram (status updates)

Poster POS --closed receipt--> PosterImportModule (poll/preview/confirm) --> PosterImportedTransaction --> AnalyticsModule --> Finance / Reports / Branch Intelligence
Poster POS --webhook (unreliable)--> PosterSyncModule (queue + reconcile) --> same import engine

Poster POS iframe --signed request--> PosWidgetModule --> Customer lookup + reward/promotion overview
Poster POS iframe --signed request, gated--> PosWidgetModule --> Poster.addTransactionProduct (reward line only)

Admin (React/Vite) --Bearer AdminJWT--> ~120 admin/* endpoints (13 functional areas)
Staff (React/Vite) --Bearer StaffJWT--> staff/* endpoints (till-side lookup)
```

This matches the architecture the platform was designed around. The one place implementation diverges from the diagram: `POST /orders` (§9) is a **third, unguarded path** into `OrdersService.createOrder()` → `Poster.createOrder()` that bypasses `CartModule`/`AuthModule` entirely.

**Coupling / ownership findings:**
- Poster HTTP access is **fully contained**: only `src/modules/poster/poster.service.ts` calls `fetch()` against Poster; every other module depends on its typed methods. No violation found anywhere in 32 modules.
- Business logic in controllers: none found — every controller is a thin parse-and-delegate layer (zod `safeParse` + one service call). This is consistent across all ~35 controller files read.
- Direct DB access from controllers: none found — every DB read/write goes through a `*.repository.ts` (or, for a handful of read-only aggregation modules — Analytics, Branch Intelligence, Growth Intelligence — through a repository that owns raw SQL, never the service or controller).
- The one real module-level cycle is `AuthModule ⇄ CustomersModule`, resolved with `forwardRef()` on both sides and explicitly documented as intentional. No other cycle exists in the 32-module graph (verified by full import-list cross-reference, not by trusting in-code comments).
- One DI oddity, not a bug: `StaffModule` cannot import `AdminCustomersModule` (would create a cycle), so it re-declares `CustomerActivityRepository`/`CustomerActivityService` as its own providers — two separate DI instances of the same stateless classes exist side by side. Harmless today (both are stateless, pure-PrismaService consumers); a latent trap if either ever gains module-scoped state.
- Reports (`src/modules/reports/`) genuinely reuses Analytics + Branch Intelligence rather than re-deriving revenue — verified by reading its source today (this session built it) and confirming zero duplicate SUM/COUNT queries against `Order`/`PosterImportedTransaction`.

## 3. Technology Stack (exact versions from `package.json`)

**Backend** (`D:\cup\package.json`): Node (LTS, no `engines` pin found — see §44), NestJS `^10.4.22` on `@nestjs/platform-fastify ^10.4.22` (Fastify `^4.29.1`), TypeScript `^5.9.3`, Prisma `^6.19.3` (SQLite dev / Postgres prod, dual-schema), Zod `^4.6.5` for all input validation, `bcryptjs ^3.0.3` for password hashing, `grammy ^1.46.0` for the Telegram bot, `@nestjs/schedule ^4.1.2` for cron jobs, Jest `^30.5.1` + `supertest ^7.2.2` + `nock ^14.0.17` for the (unused-in-this-audit) test suite.

**Admin** (`D:\cup\admin\package.json`): React `^18.3.1`, Vite `^5.4.11`, TypeScript `^5.9.3`. **No Tailwind, no CSS framework, no chart library, no state-management library, no router library.** Charts are hand-rolled inline SVG (`ui/Charts.tsx`); routing is a dependency-free History-API wrapper (`lib/router.ts`, added this session); design tokens live in plain CSS custom properties (`ui/base.css`).

**Mini App** (`frontend/package.json`): same React/Vite/TS baseline, plus `qrcode-generator ^2.0.4` (customer's own loyalty QR).

**Staff** (`staff/package.json`): same baseline, plus `jsqr ^1.4.0` (camera QR scanning at the till).

**POS Widget** (`pos-widget/package.json`): same baseline, `vite-plugin-css-injected-by-js` (bundles CSS into the single `bundle.js` IIFE Poster's iframe loads — no secret is ever baked into this bundle, only a public API base URL).

## 4. Module Inventory

32 module directories under `src/modules`. 26 expose HTTP endpoints; 6 are internal-only (DI-only, no controller): `customer-metrics`, `notifications`, `poster`, `settings`, `telegram`, `telegram-accounts`. All 32 are reachable from `AppModule` (29 direct imports + 3 transitive-only leaf modules). No broken imports, no module folder that isn't registered somewhere, no registered module whose folder doesn't exist.

| Module | Controller? | One-line purpose |
|---|---|---|
| admin-auth | Yes | Admin login/session, fully isolated from customer auth (separate JWT secret) |
| admin-customers | Yes | Customer 360 — composes 13 other modules' read models |
| analytics | Yes | Canonical CUP+POS revenue engine — the one source every other report reuses |
| auth | Yes | Telegram-initData customer auth |
| automations | Yes | CRM automation engine, layered above Campaigns/Segments/Rewards/Loyalty |
| branch-intelligence | Yes | Branch-scoped analytics, owns no table |
| branches | Yes | Poster spot ↔ CUP branch sync |
| campaigns | Yes | Manual Telegram marketing sends to a Segment |
| cart | Yes | Checkout orchestration, delegates to Orders |
| catalog | Yes | Poster product/category sync |
| customer-metrics | No | Canonical "what is a qualifying order" definition, shared everywhere |
| customers | Yes | Core identity, QR code, soft-delete |
| finance | Yes | P&L/COGS/cash-flow/loans/tax/investment/reconciliation (18 files, no single `finance.service.ts`) |
| growth-intelligence | Yes | Lifecycle/RFM/signals, read-only |
| health | Yes | Liveness probes |
| loyalty | Yes | Original points ledger (Phase 3) |
| loyalty2 | Yes | Levels/XP/achievements/cashback, additive on top of `loyalty` (9 focused services, no monolith) |
| notifications | No | Telegram order-status sends |
| orders | Yes | Order lifecycle + the unguarded legacy `POST /orders` (§9) |
| pos-widget | Yes | Poster iframe backend: overview + two gated redemption paths |
| poster | No | The ONLY class allowed to call Poster's HTTP API |
| poster-import | Yes | Read-only Poster receipt import (Phase 11.2/19) |
| poster-sync | Yes | Webhook queue + reconciliation loop (Phase 20), sits on top of poster-import |
| promotions | Yes | Discount/benefit engine |
| referrals | Yes | Referral codes/attribution/reward, credits through the Loyalty ledger |
| reports | Yes | Admin Reports (Overview/Sales/Locations) — composes Analytics + Branch Intelligence, adds nothing new |
| rewards | Yes | "5+1"-style BUY_X_GET_Y engine (folder `rewards`, module class `RewardsModule`, file `reward-programs.module.ts` — harmless naming mismatch) |
| segments | Yes | The one canonical audience-matching evaluator |
| settings | No | Generic typed key/value store every other module's toggles live in |
| staff | Yes | Barista accounts + till-side customer lookup |
| telegram | No | grammy bot transport |
| telegram-accounts | No | Shared Customer↔Telegram identity leaf, imported independently by both `auth` and `telegram` to avoid a cycle |

**5 largest files by line count:** `poster-import/poster-transaction-import.service.ts` (563), `orders/orders.service.ts` (537), `cart/cart.service.ts` (482), `growth-intelligence/growth-intelligence.service.ts` (418), `segments/segments.service.ts` (398). None of these are unreasonably large for what they do (idempotent Poster import classification, checkout orchestration with idempotency, RFM computation, rule evaluation, respectively) — no "God service" found.

**Code cleanliness:** zero `TODO`/`FIXME`/`HACK` comments anywhere in `src/`; essentially no commented-out code. This codebase does not accumulate the usual "leftover" debt — its debt is architectural/feature-completeness (§36), not sloppiness.

## 5. Source of Truth Matrix

| Entity | CUP source | Poster source | Canonical | Sync direction | Conflict resolution | Known limitation |
|---|---|---|---|---|---|---|
| Product | `Product` | `menu.getProducts` | Poster | Poster → CUP (catalog sync job, 5 min) | last-write-wins on re-sync | recipe/COGS data only present for products Poster itself has a "Dish" configured — most don't |
| Category | `Category` | `menu.getCategories` | Poster | Poster → CUP | same | none |
| Branch | `Branch` | `access.getSpots` | **CUP-managed manually** | one-way, admin-triggered | none — Branch is never auto-synced from Poster's real spot shape | `posterSpotId` mapping is a manual admin step; a branch created in Poster with no CUP mapping produces unattributed revenue (by design, never silently guessed — §30) |
| Warehouse | — | Poster has one internally | — | **not modeled in CUP at all** | — | zero inventory implementation (§18) |
| Recipe | `Product.hasRecipe`/`theoreticalCostMinor` | `menu.getProduct` ingredients | Poster | Poster → CUP (COGS sync job, 30 min) | Poster wins; CUP never invents a recipe | most products have no recipe configured in Poster, so COGS is explicitly incomplete, never guessed |
| Customer | `Customer` | `clients.getClients`/`createClient` | **CUP** (Poster client is a linked attribute) | bidirectional (CUP creates Poster clients on order; import links by `posterClientId`) | CUP identity is authoritative; a Poster client without a CUP link imports anonymously (§13) rather than being dropped or guessed | none found |
| Employee | `StaffMember` (auth only) | `access.getEmployees` | **two disjoint concepts, never reconciled** | none | — | no code path links a Poster employee to a CUP `StaffMember`; Poster's own employee-level sales report exists but is unused (§26) |
| Order | `Order` | `incomingOrders.*` | CUP | CUP → Poster (creates), Poster → CUP (status poll) | idempotency key + `posterIncomingOrderId @unique` | the unguarded `POST /orders` path (§9) can create one with an arbitrary `customerId` |
| Receipt (independent POS sale) | `PosterImportedTransaction` | `dash.getTransactions` | Poster | Poster → CUP (poll + webhook-triggered) | `posterTransactionId @unique` + `PosterIncomingOrderLink` + `application_id` heuristic (§13) | refund/void receipts are not modeled — Poster's refund behavior is explicitly unverified, so nothing is imported as negative |
| Payment | not modeled as its own entity | `pay_type` on transaction, `dash.getPaymentsReport` | Poster (for the little that's read) | one-way, ad hoc | — | CUP has no payment-method breakdown anywhere in Admin; Poster's payment report was inspected in an earlier audit phase but never wired in |
| Inventory | — | Poster has its own stock module | — | **not modeled in CUP** | — | zero implementation (§18) |
| Purchase | — | Poster has purchasing | — | **not modeled in CUP** | — | zero implementation (§19) |
| COGS | `Product.theoreticalCostMinor` (derived, cached) | recipe cost | Poster (theoretical only) | Poster → CUP | never `finance-pnl`-computed independently | this is **theoretical** COGS only — see §17 for why "actual" COGS cannot exist without inventory |
| Expense | `Expense`/`ExpenseCategory` | — | **CUP only, manually entered** | none | — | no automatic expense feed of any kind (rent, payroll, etc. are all hand-entered by an admin) |
| Loan | `Loan`/`LoanPayment` | — | CUP only | none | — | none |
| Tax | `TaxRule` (CUP's own computed liability) vs. Poster's `finance.getTaxes` (a real configured tax, read-only reference in the Reports Phase-1 audit) | both exist, never reconciled in Finance itself | CUP for liability, Poster for reference | none, ad hoc | — | the two 4% rates happened to match in one manual audit check; nothing enforces they stay in sync |
| Loyalty | `LoyaltyAccount`/`LoyaltyTransaction` **and separately** `LoyaltyAccrual`/`CashbackTransaction` | — | **ambiguous — see §21** | — | — | two ledgers, not fully reconciled |
| Reward | `RewardProgram`/`RewardRedemption` (checkout path) **and** `RewardRedemptionAttempt` (POS-widget path) | Poster receives the mutation (`addTransactionProduct`) for the POS path only | CUP | CUP → Poster (POS path only, zero-price line) | `redeemedForPosterOrderId` unique constraint (one reward per Poster order) | checkout-path reward redemption (`REWARD_CHECKOUT_ENABLED`) has never been verified/enabled — only the POS-widget path is live (§9, §22) |
| Promotion | `Promotion`/`PromotionRedemption` (never wired to real CUP checkout) + `PromotionRedemptionAttempt` (POS path) | POS path only, and only for 2 of 4 benefit types | CUP | CUP → Poster (POS path, partial) | same unique-constraint pattern | `PERCENT_DISCOUNT`/`FIXED_DISCOUNT` have **no known Poster mutation mechanism at all** and always resolve FAILED, by design (§34) |
| Campaign | `Campaign`/`CampaignRecipient` | — | CUP only | CUP → Telegram | frozen audience snapshot at send time | none found |
| Referral | `Referral`/`ReferralReward` | — | CUP only | — | unique constraints prevent double-reward | `Referral.status` schema default `"PENDING"` is dead — Phase 14 code never writes it (a genuine, harmless schema/reality mismatch) |
| Analytics | `AnalyticsRepository` | reads `PosterImportedTransaction`, never calls Poster live | CUP | — | — | none — this is the actual canonical revenue source everything else reuses |
| Finance | `finance-*` services | reads `Product.theoreticalCostMinor`, reuses Analytics for revenue | CUP | — | — | see §16 for actual/theoretical/manual breakdown |

**Entities with genuinely ambiguous ownership:** Loyalty (two ledgers, §21) and Tax (two unreconciled rates, above).

## 6. Database Audit

52 models (`prisma/schema.prisma`, 1338 lines), portable by design (no Prisma `enum`, no `Decimal` — both unsupported on SQLite, so every status/type field is a `String` validated against a TS allowlist in code, and every money field is an `Int` in whole UZS). The Postgres production schema (`prisma/postgres/schema.prisma`) is **mechanically generated** from this file by `scripts/generate-production-schema.js` (swaps only the `datasource provider`) — verified today: both files list exactly 52 identically-named models, zero drift.

**Missing entirely (not partial — the models simply don't exist):** Warehouse, StockMovement/InventoryMovement, Supplier, Purchase/PurchaseItem, Receiving, Payroll/Employee-salary record, Cash-register/till-session model, Payment-method breakdown. This is the schema-level proof behind §16/§18/§19/§20's "not implemented" findings — it isn't a judgment call, it's an absence.

**Naming/design consistency:** every table uses `@@map()` to a `snake_case` plural name; every model has `createdAt`; most have `updatedAt`; money is always `*Minor` (historical name, always whole UZS, never fractional); status/type columns are always `String`, always documented as validated against a specific allowlist file. This consistency held across all 52 models — no exception found.

**Cascade/restrict behavior, spot-checked:**
- `PosterImportedTransactionItem.transaction` → `onDelete: Cascade` (correct: a line has no independent meaning).
- `SegmentCondition.segment` → `onDelete: Cascade` (correct, same reasoning).
- `CampaignRecipient.campaign` → `onDelete: Cascade` (correct — a frozen per-send snapshot dies with its send).
- `Automation.segment` → `onDelete: Restrict` (correct — an automation must never silently lose its audience definition).
- Everything else (Product referenced by Promotion/OrderItem/CartItem, Category referenced by RewardProgram, Segment referenced by Campaign/Automation/Promotion) has **no override**, meaning the database blocks a hard delete — and the codebase consistently prefers soft-delete (`isActive: false`) over hard delete for exactly this reason, catching the resulting FK violation and converting it to a clean `409` (verified in `SegmentsService.delete()`, `RewardProgramsService.delete()`).
- No dangerous cascade found anywhere (nothing that could silently wipe unrelated history).

**Nullable fields worth flagging:**
- `Order.branchId` — nullable since Phase 1.1, never backfilled, still nullable today. A CUP order with no branch is legitimately possible and is correctly excluded from branch-scoped figures (not from totals) everywhere I checked (§30).
- `PosterImportedTransaction.posterClientId`/`customerId` — deliberately made nullable this week (2026-09-24) to support anonymous POS import. Every "distinct customer" query I read across `analytics`, `branch-intelligence`, `growth-intelligence`, and `reward-progress` repositories explicitly filters `customerId: { not: null }` or uses SQL's own NULL-excluding `DISTINCT`/`COUNT(DISTINCT ...)` — **except two spots that were found and fixed during this session's own Reports work** (§7) and possibly others not yet audited (see §36's residual-risk note).
- `RewardRedemption.orderId` nullable — correct: a POS-path redemption has no CUP order by design.

**Indexes:** every foreign-key-shaped scalar I checked in the generated migration SQL has an index (Prisma auto-indexes relation scalars on migrate). Explicit composite indexes exist exactly where read patterns need them: `PosterImportedTransaction(customerId, status)`, `Referral(status, checkedAt)` (round-robin fairness), `AutomationExecution(status, notBeforeAt)`, `RewardRedemptionAttempt(posterOrderId, status)`. No missing-index pattern found in the schema itself; §29/§38 cover query-level N+1 risk separately (schema indexes don't prevent an N+1 query pattern, only make each individual query fast).

**Unique constraints that could cause a real business problem:** none found that shouldn't be there. The two "one Poster order = one reward/promotion" constraints (`redeemedForPosterOrderId`) are a deliberate, correct business rule (added same-day as a real incident — 10 free drinks given away on one order, §22).

## 7. Data Integrity

**Confirmed via direct read of the code, this session:**
- **Real bug found and fixed today** (`branch-intelligence.repository.ts`): the per-branch revenue query used an `INNER JOIN` on `customerId` to compute cross-branch customer behavior, which silently dropped every anonymous POS purchase from *all* per-branch figures (revenue, orders, CUP/POS split) — while the all-branches total correctly included them. Fixed by keeping identified-customer behavior untouched and merging anonymous revenue back in as a separate, non-customer-scoped addition. This affected the **already-shipped Branch Intelligence page**, not just the new Locations report that surfaced it.
- **Real crash found and fixed today** (`branch-intelligence.repository.ts` + `growth-intelligence.repository.ts`): two separate customer-list queries (`customerIdsAtBranch`, the `aggregates()` purchase union) didn't filter out anonymous (`customerId = NULL`) rows, so `NULL` ended up inside a downstream Prisma `{ in: [...] }` clause, which Prisma rejects outright — a hard 500 on any branch-scoped Growth Intelligence or Branch Intelligence request for a branch with anonymous POS activity. Both fixed with a `customerId IS NOT NULL` filter, the same pattern already used correctly in `AnalyticsRepository.posCustomerIds()`.
- These two bugs are the same root cause (Phase 19's anonymous-import feature shipped one day before this fix, and at least two older modules hadn't been updated for it). **I did not exhaustively re-audit every remaining consumer of `PosterImportedTransaction.customerId`** for the same class of bug beyond these two — this is a real residual risk (§36, §49).
- **Duplicate-transaction protection**, verified by reading `poster-transaction-import.service.ts` directly: three independent layers — (1) `PosterIncomingOrderLink` (the documented Poster link, checked first, produces `CUP_ORIGINATED` and is never imported as a POS sale), (2) the undocumented-but-consistently-observed `application_id` field, used **only** to defer/skip an ambiguous receipt, never to import or attribute it, (3) `posterTransactionId @unique` at the database level, making any re-scan of the same window idempotent regardless of (1)/(2). This is a genuinely solid design.
- **Orphan-record risk:** none found in the models I checked for hard-delete exposure (§6) — the schema itself prevents most orphan scenarios via FK restriction, and the one soft-delete model (`Customer.isActive`) never removes rows.
- **Impossible/negative values:** `RewardRedemption`/`PromotionRedemption` amounts are always positive by construction (snapshotted from a positive `benefitValue`/`rewardQuantity`); Poster refund-shaped transactions are explicitly never imported as negative (`PosterNegativeAmountError` in `poster-money.ts` throws rather than silently flipping a sign) — a conservative, correct choice, at the cost of refunds simply not being represented in CUP at all (§21 flags the business consequence).

## 8. Fresh Start State

**Local `dev.db` (SQLite), read directly, right now:**

| Entity | Count |
|---|---|
| Customers (active) | 1 (1) |
| Branches | 2 |
| Products / Categories | 58 / 7 |
| Orders / OrderItems | 5 / 11 |
| PosterImportedTransaction (anonymous) | 63 (42) |
| LoyaltyAccounts / LoyaltyTransactions | 1 / 4 |
| LoyaltyAccruals / CashbackTransactions | 2 / 2 |
| RewardPrograms / RewardRedemptions / Attempts | 1 / 10 / 13 |
| Promotions / Redemptions | 4 / 3 |
| Segments / Campaigns / Recipients | 1 / 2 / 2 |
| Automations / Executions | 0 / 0 |
| Referrals / ReferralRewards | 0 / 0 |
| StaffMembers / Admins | 1 / 1 |
| Expenses / Loans / TaxRules / Investments | 2 / 1 / 1 / 1 |

**This is dev/test data, not a fresh-start state, and it should not be confused with production.** This audit did **not** re-pull production business counts: I have no live Postgres connection string for production in this session, and I deliberately did not reuse admin credentials shared for a one-time verification in an earlier, unrelated task. What I *can* confirm right now, read-only and without credentials: the production backend, Poster connectivity, and production Postgres are all reachable and healthy (`GET /health` → `{"status":"ok"}`, `/health/poster` → `{"poster":"ok"}`, `/health/db` → `{"database":"reachable"}`, all `HTTP 200`, checked live during this audit).

Per this session's own prior, first-hand actions (not re-verified here, flagged accordingly): production has real customer/order/POS-import/loyalty/reward data as of 2026-09-24 — it is **not** a clean Day-1 state, by design (the owner chose to keep operating rather than wipe the database when this was discussed earlier in this session). Config rows (Admin, one RewardProgram, expense categories, tax rule, branches) legitimately exist and are expected. **If a genuine fresh-start verification is needed, it must be re-run against production directly with fresh admin credentials — this audit only proves the mechanism (local dev.db) works, not production's current number.**

## 9. Poster Integration

**14 methods on `PosterService`** (`src/modules/poster/poster.service.ts`, the only class permitted to call Poster's HTTP API): `getCategories`, `getProducts`, `getProductDetail`, `getClientsByPhone`, `createClient` (mutation), `getClosedTransactions`, `getTransactionById`, `getDeletedTransactions`, `getOpenTransactions`, `getIncomingOrderTransactionLink`, `getSpots`, `createOrder` (mutation), `addTransactionProduct` (mutation), `getOrderStatus`, plus (added this session) `getSpotsSales` for the Reports Locations page.

**Error-envelope handling, verified by reading `execute()` directly:** Poster's documented HTTP-200-with-error-envelope quirk (`{"error":{"code":11,...}}` for a bad token) is handled correctly — a truthy `error` key at HTTP 200 is thrown as a **definite** failure (`PosterDefiniteError`), never treated as ambiguous or silently swallowed. A malformed/non-JSON body, a network failure, or a 5xx is thrown as **ambiguous** (`PosterAmbiguousError`) and every mutation call site (`createOrder`, `addTransactionProduct`, `createClient`) treats ambiguous as "we do not know what happened" — never as success, never auto-retried. This three-way outcome discipline (`success` / `definite_failure` / `ambiguous_failure`) is applied consistently to all three real Poster mutations. This is genuinely careful engineering.

**Known undocumented behaviors relied upon (each explicitly commented in code, not silently assumed):**
- `application_id` on a transaction (Phase 19, used only to skip, never to attribute).
- Poster's `spot_id` is a numeric **string** on `access.getSpots` but a raw **number** on `incomingOrders.getOwnIncomingOrders` — the code explicitly does not assume consistency and checks per-field.
- `dash.getSpotsSales`'s `revenue`/`middle_invoice` fields are, empirically, **already whole so'm**, not the raw-kopeck wire format every other Poster money field uses — discovered and documented this session by cross-checking a real week's Poster total against CUP's own canonical total (dividing by 100 would have given an implausible ~38,000 so'm for a week of sales at a coffee shop).
- `dash.getSpotsSales`'s `clients` field is, despite its name, documented by Poster itself as an **order count**, not a distinct-customer count — the code never reads it as a customer figure.
- `dash.getAnalytics?type=spots` was found, in an earlier audit phase, to return all-zero data for a period where the dedicated `dash.getSpotsSales` endpoint returned correct real revenue — an observed Poster-side inconsistency, worked around by simply not using that endpoint/parameter combination.

**Poster `profit`/`profit_netto` fields exist on real responses and are read by nothing in this codebase** — correctly, because an earlier audit phase found Poster silently treats a product with no configured recipe as zero-cost, making `profit` misleadingly close to `revenue` for this account. This rule is enforced consistently everywhere I checked (Finance, Reports, the 5+1 report).

## 10. POS Import

`poster-transaction-import.service.ts` (563 lines) implements preview/confirm as one function (`analyze()`) called twice — once as a dry run, once (only if every write gate passes) for real, so preview and import structurally cannot disagree. Confirmed gates on the mutating endpoint (`POST /admin/poster/import-transactions`): `AdminAuthGuard` + an inline admin-role check + requiring both `dryRun:false` and `confirm:true` in the body — three independent things must be true before anything is written.

**Anonymous sales:** as of a schema change made this week, a receipt with no linked CUP customer imports anonymously (counted in revenue, excluded from customer-scoped features) rather than being skipped — a deliberate, documented owner decision, and the source of the two bugs found and fixed in §7.

**Timezone:** the scan window (`resolveWindow()`) was itself the subject of a same-day bug fix this week — it now correctly resolves business-local (UTC+5) day boundaries via the shared `analytics-period.ts` resolver, widened by ±1 day on the Poster-side query and then filtered precisely by exact instant. Verified live against real production data before this audit (not re-verified in this pass).

**Can a production rerun happen safely?** Yes, by design: `posterTransactionId @unique` makes any re-scan of an already-imported window a no-op for those rows (`ALREADY_IMPORTED`), and the `dryRun`/`confirm` double-gate means a re-run never happens by accident.

**Not modeled / explicitly out of scope:** refund-shaped and deleted-but-previously-imported transactions are surfaced for admin awareness (`getDeletedTransactions`, `UNRESOLVED` category) but never reversed or re-classified automatically — Poster's refund semantics are documented in code as unverified, and the system's stance is "never guess," not "handle it wrong."

## 11. Continuous Sync

`poster-sync` module: webhook receiver (§39 for signature detail) → durable `PosterWebhookEvent` queue (dedup key `object:objectId:action:time`, since Poster documents no event id and retries up to 15 times) → background processor → reconciliation loop with a durable checkpoint (Settings key `poster.sync.reconcileCheckpoint`) plus a configurable overlap window (default 60 min) to absorb clock skew/late delivery.

**What actually works, per this session's own prior production verification (not re-checked in this audit pass):** the reconciliation loop is healthy and catches everything within its 1-minute cadence even when webhook delivery itself is unreliable — Poster's own dashboard "Check" probe for this integration has been failing for a documented, unresolved, Poster-side reason (parked, not a CUP bug) since an earlier phase. **This means CUP's real-time webhook path may not be delivering events at all in production, and the system's actual safety net is the periodic reconciliation poll, not the webhook.** This is architecturally fine (the design explicitly treats a webhook as "only a hint") but is worth the owner's attention: if Poster's dashboard genuinely can't reach the webhook, CUP is running on polling-only continuous sync, which works but is not "continuous" in the way the phase name implies.

**Local `dev.db` right now:** 0 `PosterWebhookEvent` rows — consistent with local dev never receiving real Poster webhooks (expected; this environment is not the one Poster's dashboard points at).

## 12. Telegram + Mini App

`AuthModule` verifies Telegram `initData` via HMAC (`TELEGRAM_BOT_TOKEN` as key material) with a documented max-age check (`TELEGRAM_INIT_DATA_MAX_AGE_SECONDS`, default 24h) before ever creating a session. `AuthGuard` (`src/modules/auth/auth.guard.ts`) resolves the customer strictly from a verified session token — never from a body/query-supplied id — for every route that uses it.

**One concrete gap found this audit:** `AuthGuard.canActivate()` calls `CustomersRepository.findById(payload.sub)`, which does **not** filter by `isActive`. Every *other* customer-lookup method in the same repository (`findByPosterClientId`, `findByLoyaltyCode`, search) explicitly adds `isActive: true` — this one doesn't. **Practical effect: an admin "deactivating" a customer (Phase 26 soft-delete) removes them from Admin lists and staff lookup, but does not revoke their existing Mini App session** — they can keep browsing, adding to cart, and checking out normally until their token naturally expires (`JWT_EXPIRES_IN_SECONDS`, default 24h). This is a real, narrow, MEDIUM-severity finding, not the sort of thing "deactivate this customer" implies to an admin pressing the button.

**Mini App business-rule enforcement:** every reward/promotion eligibility check I traced is re-validated server-side at checkout time (`CartService`/`RewardEligibilityService`) regardless of what the client claims — the explicit spec instruction "never trust client-provided progress" is honored everywhere checked.

## 13. POS Widget

`pos-widget` module: authentication is a **Poster-documented HTTP request signature** (`POSTER_APPLICATION_SECRET`, same secret as the webhook, verified in `pos-widget-signature.ts`), not a JWT — appropriate, since the caller is a physical POS terminal's iframe, not an authenticated human session. `GET /pos-widget/ping` is deliberately unguarded so it can self-report *why* auth failed (invalid signature vs. stale timestamp vs. misconfiguration) as data rather than throwing — it exposes no customer data.

**Widget → CUP backend, never widget → database:** confirmed — the widget bundle (`pos-widget/`) contains no database client, no Poster token, only a public API base URL (`VITE_CUP_API_URL`), matching its own package description ("Contains no secret").

**Reward mutation replay protection:** `RewardRedemptionAttempt.attemptId @unique` is the widget-supplied idempotency key — a repeated POST with the same key returns the same row rather than mutating Poster twice. **Independently, and more importantly:** `redeemedForPosterOrderId @unique` enforces one reward redemption per Poster order **at the database level**, the fix put in place after a real production incident this week (10 free drinks given away on a single order before this constraint existed) — the application-level check runs first, inside a transaction with the customer+program concurrency guard, and the DB constraint is defense-in-depth if that's ever bypassed.

## 14. Security

**The critical finding of this entire audit:** `POST /orders` (`src/modules/orders/orders.controller.ts:58`) has **no guard of any kind** and accepts `{ customerId, items }` directly in the request body (`create-order.dto.ts`). Its own code comment says it is "Phase 0's original internal/testing endpoint... left as-is to avoid breaking Phase 0's existing test suite." I traced `OrdersService.createOrder()` (line 137 onward) to confirm it is the **exact same code path** `POST /cart/checkout` uses, ending in a real call to `this.poster.createOrder(...)` — a genuine Poster POS order. **Any unauthenticated caller who can reach this API can create a real order, attributed to any customer ID they choose, that reaches the physical POS/kitchen and triggers Telegram notifications to that real customer.** This is not a theoretical IDOR — it is a live, reachable, credential-free order-creation endpoint. Recommendation (not implemented, per audit scope): remove it, or at minimum gate it behind `AuthGuard` immediately.

**Two further unguarded, mutating, unauthenticated endpoints:** `POST /branches/sync` and `POST /catalog/sync` (no controller-level or method-level guard at all) each trigger a live write from Poster into CUP's branch/catalog tables. Lower severity than `POST /orders` (they can't forge a transaction or leak customer data, only force a resync), but still reachable by anyone and worth gating.

**Everything else checked is solid:** `AdminAuthGuard`/`AuthGuard`/`StaffAuthGuard` each resolve identity strictly from a signed token against their own independent secret (`ADMIN_JWT_SECRET`/`JWT_SECRET`/derived-or-independent `STAFF_JWT_SECRET`) — a token from one audience structurally cannot verify against another guard, since it was never signed with that secret. `GET /orders/:id` explicitly returns an indistinguishable 404 for "doesn't exist" vs. "exists but isn't yours" (no enumeration). Every admin/staff mutating endpoint I found in the 26-controller inventory (§31) sits behind its guard; no admin endpoint was found unguarded. Webhook and POS-widget authenticity both use a real signature check (constant-time `timingSafeEqual` for the webhook — verified by reading the code directly), never a shared secret compared with `===`.

**Second finding, medium severity:** `AuthGuard` doesn't check `Customer.isActive` (§12) — deactivation doesn't revoke an existing session.

**Passwords:** `bcryptjs` for Admin and Staff; no plaintext password found anywhere in a log statement, error message, or response DTO I checked.

**Secrets:** `POSTER_API_TOKEN`, `TELEGRAM_BOT_TOKEN`, `JWT_SECRET`, `ADMIN_JWT_SECRET`, `POSTER_APPLICATION_SECRET` are all read from env, never given a default in `env.schema.ts`, and I found no instance of one being logged, echoed in a response, or committed (`.env` is not tracked; `.env.example` contains only placeholder text).

**CORS/rate limiting:** not independently audited in this pass (out of the direct file-reading I did) — flagged as an open item, not a confirmed gap.

## 15. Finance

Actual capabilities, precisely characterized (this is the section the audit spec insists on precision for):
- **Revenue:** actual — reuses `AnalyticsRepository`'s canonical, already-deduped CUP+POS figure, never re-derived.
- **COGS:** theoretical only, and explicitly labeled as such in the UI ("Data incomplete" banner) whenever a product has no Poster recipe — never fabricated.
- **Gross Profit:** actual revenue minus theoretical COGS — a real number, built from a partly-theoretical input, honestly labeled.
- **Operating Expenses:** actual, but 100% manually entered (`Expense` rows) — no automatic feed from anywhere.
- **Operating Profit / Net Profit:** actual arithmetic on the above, correctly excludes loan **principal** (a cash-flow item) from expenses and includes only loan **interest** as a P&L cost (verified in the schema comment and cross-checked against `LoanPayment`'s two separate `principalMinor`/`interestMinor` columns).
- **Taxes:** a configurable `TaxRule` (rate/base/effective dates) computing a **liability estimate**, explicitly documented as "NOT verified legal tax advice" — never treated as paid cash.
- **Cash Flow:** actual real cash movements only (`Expense` where `paymentStatus=PAID`, `LoanPayment.principalMinor`, `Investment`, `CashAdjustment`) — the service's own response includes an explicit `limitations[]` array documenting what it does NOT capture (untracked inventory-purchase cash, tax payments), rather than silently omitting them.
- **Investments/Payback/ROI:** Payback returns one of four explicit states (`NO_INVESTMENT_RECORDED`/`INSUFFICIENT_HISTORY`/`NEGATIVE_CASH_FLOW`/`OK`) — never fabricates an estimate when the data can't support one. ROI is a separate, clearly distinct metric.
- **Reconciliation:** reuses the POS-import `analyze()` function verbatim to cross-check recognized revenue against a live Poster read — genuinely never writes anything, confirmed by reading the service.

**What Finance is NOT:** a real accounting system with a general ledger, journal entries, or double-entry bookkeeping — it is a purpose-built revenue/cost/cash dashboard on top of CUP's own data, honest about every place it is estimating rather than measuring.

## 16. Inventory

**Not implemented — zero foundation.** No `Warehouse`, `StockMovement`, `StockCount`, `Transfer`, or `Waste` model exists in the schema (§6). `Product.hasRecipe`/`theoreticalCostMinor` is COGS-*pricing* data read from Poster's recipe configuration, not stock-tracking. There is no code path anywhere in `src/modules` that decrements a stock balance. This gap is not hidden by any UI — no Admin page claims to show inventory.

## 17. COGS

CUP currently uses, and can currently only use, **theoretical COGS**: Poster's own recipe-cost data (`menu.getProduct`'s `ingredients[].structure_selfprice`, summed), read live and cached on `Product.theoreticalCostMinor`/`costSyncedAt` via a 30-minute sync job. **Actual COGS (real inventory consumption, waste, purchase-price variance) cannot exist without an Inventory module (§16) — this is a hard dependency, not a missing config flag.** The distinction is made explicit in the UI (a "Data incomplete" banner appears for any product Poster hasn't configured a recipe for, which was most products as of the last COGS audit) — this is the single most disciplined part of the whole Finance suite.

## 18. Purchasing

**Not implemented — zero foundation.** No `Supplier`, `Purchase`, `PurchaseItem`, or `Receiving` model exists. There is no lifecycle to audit because there is no code.

## 19. Payroll

**Not implemented as payroll — only as generic expenses.** `StaffMember` is authentication-only (username/password/branch), with no salary, pay-rate, or schedule field. A salary can only be recorded as a plain `Expense` row (any category, any description) — there is no structured distinction between "Barista X's salary" and "rent." Poster's own `access.getEmployees` endpoint (2 real employees, verified live in an earlier Reports-audit phase) is completely disconnected from `StaffMember` — nothing links a Poster employee id to a CUP staff account or to payroll.

## 20. Cash

CUP tracks cash **movements** (`CashAdjustment` — a manual, signed correction never touching Revenue/Expense/COGS/P&L — and the cash-flow components in §15), but **not** a cash/card/bank split, till reconciliation, or opening-balance concept. Poster's own `dash.getPaymentsReport` (confirmed live in an earlier audit: this account is 100% cash) exists and was inspected but is not wired into any CUP screen. Nowhere in the codebase is cash "inferred" incorrectly — where CUP can't measure something (till reconciliation, payment-method split), it simply doesn't show a number, rather than guessing. This restraint is consistent with Finance's overall discipline (§15).

## 21. Loyalty

**The clearest architectural duplication in the whole system.** Two parallel, both-currently-live ledgers exist:
1. **`LoyaltyAccount`/`LoyaltyTransaction`** (Phase 3) — a simple points balance with an append-only transaction log.
2. **`LoyaltyAccrual`/`CashbackTransaction`/`LoyaltyLevel`/`Achievement`/`CustomerAchievement`/`LoyaltyLevelUp`** (Phase 12, "Loyalty 2.0") — levels derived from lifetime spend, cashback as a separate wallet, achievements, birthday rewards.

Both are live in local `dev.db` today (4 `LoyaltyTransaction` rows, 2 `LoyaltyAccrual` + 2 `CashbackTransaction` rows). `Branch Intelligence`'s own repository reads **both** ledgers separately for one branch's "loyalty" section (`pointsLedger()` reads `LoyaltyTransaction` joined through `Order`; `loyalty2Accruals()` reads `LoyaltyAccrual`/`CashbackTransaction` joined through a separate `sourceType`/`sourceId` union) — this is not an oversight, the code explicitly acknowledges they are different things, but from a business-user's point of view **there are now two numbers that both claim to be "this customer's loyalty points."** I did not find code that keeps `LoyaltyAccount.balance` and Loyalty 2.0's own point/cashback accounting reconciled against each other. This is a genuine ambiguous-ownership risk (§5) worth resolving deliberately (either formally retire Phase-3 loyalty, or document precisely which one is authoritative for which purpose) rather than by accretion.

**Reward progress (`RewardProgressService`) is architecturally clean:** progress is never cached, always derived at read time as `floor(qualifyingOccasions / buyQuantity) - redeemedCount`, where "qualifying occasion" means one distinct visit (CUP order or Poster transaction with ≥1 qualifying line), not summed item quantity — a deliberate owner decision made this week specifically so buying 5 coffees in one visit doesn't complete a "5 visits" cycle. **Duplicate redemption protection** is two-layered: a unique `(rewardProgramId, customerId, redemptionIndex)` constraint for the checkout path, and the separate `redeemedForPosterOrderId` constraint (§13) for the POS-widget path. **Refund implications are not modeled** — a refunded qualifying purchase still counts toward reward progress forever, since refunds aren't imported at all (§10).

**Period vs. all-time semantics:** every reward/loyalty "current status" figure I found (available rewards, current progress, level, achievements) is computed all-time/cumulative, never re-derivable "as of a past date" without a new event-sourcing model — this is documented and honestly represented in every Admin screen that shows it (Reports, the 5+1 report, Branch Intelligence), never faked as a historical figure.

## 22. CRM

**Segments** (`segment-evaluator.ts`) is the one canonical audience matcher, reused unmodified by both Campaigns and Promotions — no duplicate evaluation logic found. **Growth Intelligence** computes lifecycle/RFM/signals/opportunities read-only, storing and sending nothing, reused by Branch Intelligence for branch-scoped versions of the same figures. **CRM Automation** sits above Campaigns/Segments/Rewards/Loyalty and is protected by a genuine **two-key interlock**: an env-level hard safety flag (`CRM_AUTOMATION_SEND_ENABLED`, an operator setting, not tunable from Admin) AND a separate Admin-panel business toggle (`crm.automation.enabled`, a Setting row) — both must independently be true before any Telegram message can be sent; a preview still works with either off. The same two-tier pattern is used for Referrals (`REFERRAL_RUN_INTERVAL_MS`'s gate + `referral.enabled`) and Loyalty 2.0 (`loyalty2.enabled`). This is a consistent, deliberate, well-designed safety pattern across three independent feature areas — genuinely worth preserving as-is.

**Local `dev.db`: 0 Automations, 0 AutomationExecutions, 0 Referrals** — consistent with these features shipping off-by-default and, per this session's own memory, requiring explicit owner steps to enable that (as far as this audit can verify) have not all been taken in production either.

## 23. Marketing

Campaigns are manually created and manually sent — no scheduling, no recurrence (an explicit, documented Phase 6 scope boundary). `CampaignRecipient` freezes the audience at send time (never re-evaluates mid-send), and its `(campaignId, customerId)` unique constraint guarantees Phase 6's "exactly one send per campaign" model. **Conversion attribution does not exist:** nothing connects a sent campaign to a subsequent order or revenue figure — a real, if modest, gap for anyone trying to measure marketing ROI (§43 recommends this as a future, not immediate, priority).

## 24. Analytics

Canonical formulas, read directly from `analytics.service.ts`/`analytics.repository.ts`:
- **Revenue** = qualifying CUP `Order.totalMinor` sum + qualifying `PosterImportedTransaction.totalMinor` sum (both filtered to the same "qualifying" status set `CUSTOMER_METRICS_ORDER_STATUSES`, shared with Customer Metrics/Segments so "what is an order" never has two definitions).
- **Orders** = count of the same two qualifying sets.
- **Customers** = distinct union of CUP + POS customer ids in the period (anonymous POS rows correctly excluded via `customerId: { not: null }`).
- **New vs. returning** = "had any qualifying purchase, either source, strictly before the period start" — computed and cross-referenced against a second, deliberately-different Branch-Intelligence definition ("first purchase ever was at this branch"), with both definitions documented side-by-side rather than silently picked one.
- **Average order** = revenue ÷ orders, zero-guarded.
- **Source split** = CUP vs. independent POS (the latter already excludes CUP-originated receipts by construction, per §9's dedup formula — never a second dedup pass).
- **Daily revenue** = business-local (UTC+5) day-bucketed via the one shared `analytics-period.ts` resolver, reused identically by Finance, Reports, and Branch Intelligence (verified: the STEP 2.1 timezone bug fixed this week was fixed in exactly one function precisely because every consumer shares it).

**Cross-checked against Finance/Reports/Branch Intelligence, live, this session:** identical revenue/order/customer figures returned for the same period across `/admin/analytics/overview`, `/admin/reports/overview`, `/admin/reports/sales`, `/admin/reports/locations`, and `/admin/branch-intelligence/overview` — no metric inconsistency found (after the two bugs in §7 were fixed).

## 25. Reports

Three reports exist (`/admin/reports/overview`, `/sales`, `/locations`), all built this session. Overview and Sales are two thin controller routes over **one** shared computation (`ReportsService.getOverview()`) — literally zero duplicate revenue logic between them. Locations composes `BranchIntelligenceService` (attribution) + the same `ReportsService` (trend) + a new, deliberately separate `PosterReportsService` (Poster's own `dash.getSpotsSales`, kept structurally apart, never summed into a CUP total, no `profit` field ever read — §9). No report recomputes revenue independently of `AnalyticsRepository`; no report was found that duplicates Finance's P&L. Per-report notes (period/filters/timezone/anonymous handling) are covered in §24 (they're identical, by construction, across every report).

**Not yet built** (out of this session's explicit Phase A/B1 scope, tracked as future phases): Payments, Products, Categories, Customers, Employees, Taxes, Promotions, Loyalty, Campaigns, Referrals, ABC Analysis, Receipts, Stations.

## 26. Customer 360

`AdminCustomersModule` composes 13 other modules' read models (Loyalty, Loyalty2, Rewards, Promotions, Segments, Automations, Referrals, Growth Intelligence, Customer Metrics, Staff, Poster Import) into one profile + activity feed — the single highest-fan-in module in the codebase, by design (it's meant to be the one place everything about a customer is visible). I did not find a figure on Customer 360 that disagreed with the same figure computed independently elsewhere (e.g., its reward-progress numbers matched the 5+1 report's numbers exactly when cross-checked live this session, §21).

## 27. Branch Intelligence

Attribution is exactly `Order.branchId` (CUP) / the branch mapped from `Poster spot_id` at import time (POS) — confirmed by reading `branch-intelligence.repository.ts`'s shared `PURCHASES` CTE; no inference from customer, staff, product, or time anywhere in this module. The two bugs found and fixed this session (§7) were specifically in this module's handling of anonymous POS purchases in per-branch queries — now fixed and cross-checked against the all-branches total. Revenue/orders/retention/cross-branch/products/loyalty/rewards/promotions/referrals/growth are all present, each explicitly labeled with which definition of "purchase"/"new customer" it uses (`BRANCH_INTELLIGENCE_DEFINITIONS`, a server-side constant the Admin UI reads verbatim rather than re-writing the wording client-side) — a notably disciplined pattern that prevents the frontend from silently drifting from the backend's actual semantics.

## 28. Admin UI/UX

**Design system:** fully custom (§3) — CSS custom properties on `:root` (`--cup-black #0B0B0B`, `--cup-terracotta #D84B1F`, `--cup-cream #F6DDB0`, `--cup-white`, plus restrained status tones), shared verbatim with the Mini App's own `global.css` (same brand, same tokens, by design — not two systems that happen to look similar). **No Tailwind migration has occurred or is in progress** — this was asked and confirmed directly with the user earlier this session; the "recently implemented design system" is the hand-rolled token system itself, applied consistently since the Admin's creation, not a recent migration away from something else.

**Sidebar:** an accordion (7 collapsible groups + 1 non-collapsible Dashboard group), fixed this session to be **exclusive** (only one section open at a time) after a real regression let multiple sections stay open simultaneously — verified live in a real browser, including legacy-localStorage migration and route-change behavior.

**Consistency:** every Admin page I touched or read this session (Reports ×3, Finance ×8, Branch Intelligence, Analytics, the 5+1 report) uses the same `PageHeader`/`StatCard`/`StatGrid`/`SectionCard`/`DataTable`/`EmptyState`/`ErrorState`/`LoadingState`/`FilterBar`/`DateRangePicker` primitives from `admin/src/ui/` — no page was found rolling its own card/table/loading pattern. Charts are the same hand-rolled inline-SVG bar chart everywhere (`ui/Charts.tsx`) — no second charting approach exists.

**One residual, deliberately-not-fixed item:** `FinancePnlPage`'s "products with unknown cost" list keys a React list by `p.name`, and two real products share the name "Капучино 250 мл" — a genuine, pre-existing (not introduced this session) React duplicate-key warning, flagged and spawned as a separate background task rather than fixed inline (correctly, since it was out of scope for the feature being built at the time).

## 29. Performance

**Backend, spot-checked this session and in this audit:** every aggregate query I read (`AnalyticsRepository`, `BranchIntelligenceRepository`, `GrowthIntelligenceRepository`) is a `GROUP BY`-shaped query whose cost does not scale with the number of orders/branches/customers processed per row — none of them loop over rows in application code to sum something the database could sum. Bulk customer-scoped lookups (`sumQualifyingQuantityForCustomers`, `countQualifyingOccasionsForCustomers`, `getAvailableForCustomers`) are explicitly chunked (5000-id batches) rather than looped one customer at a time — verified in `reward-progress.service.ts`. The 5+1 report's Top-10 ranking is one `groupBy`+`orderBy`+`take(10)` query, not a per-customer loop (verified today).

**Poster call volume:** `dash.getSpotsSales` (Reports Locations) is called at most twice per request (once combined, once per selected branch) — never once per branch in the all-branches view, a constraint explicitly enforced by design this session. COGS sync (30 min) makes one Poster call per active product per tick (~30 today) — acceptable at this scale, would need batching if the catalog grew substantially.

**Frontend:** no state-management library exists, so there's no risk of the usual "everything re-renders" bug class that comes with a misused global store; each Admin page owns its own `useState`. Bundle sizes are modest (Admin ~470 KB, Mini App ~195 KB + a lazily-split `qrcode`/`IdentityCodes` chunk, Staff ~173 KB + a separately-split `jsQR` chunk, POS widget ~178 KB as a single IIFE by requirement).

**Not measured in this pass:** actual production query latency, actual Poster round-trip time under load, actual concurrent-user behavior. This audit did static/structural performance review only, per its own read-only mandate — no load test was run.

## 30. Observability

`StaffScanEvent` provides a lightweight audit trail for staff/admin identity actions (who, what, outcome, which customer/branch — never raw QR text, phone, or token). Finance mutations are audited by reusing this same table (`actorType: 'ADMIN'`) rather than a second audit mechanism. `PosterWebhookEvent.status`/`attempts`/`lastError` and the Admin "Continuous Sync"/"System Health" pages give visibility into sync/job health. `Admin > Errors` and `Admin > System Health` pages exist and are wired to real backend status endpoints (verified reachable in browser earlier this session). **Structured application logging** (beyond NestJS's default `Logger` calls scattered through services) was not found as a separate concern — there is no centralized log aggregation/correlation-id pattern visible in the code, which is a reasonable scale-appropriate choice today but would need attention before this became a multi-branch, multi-operator system.

## 31. API Inventory

**~140 endpoints across 35 controller files** (full per-controller table produced by a dedicated sub-agent pass this audit, cross-verified against direct reads for every critical finding cited elsewhere in this document). Full inventory: see the companion table generated during this audit (method/path/guard/mutates/purpose/notes for every route) — reproduced in condensed form throughout §9–§14 and §25–§27 above by area; the complete raw table is available in this session's record and is straightforward to regenerate (`grep` every `*.controller.ts` for `@Controller`/`@Get`/`@Post`/`@Patch`/`@Delete`/`@UseGuards`).

**Unguarded, mutating, and (in one case) actively dangerous endpoints — the headline finding, restated for this section specifically:**
| Method | Path | Guard | Severity |
|---|---|---|---|
| POST | `/orders` | none | **CRITICAL** — creates a real Poster order for an arbitrary customer id |
| POST | `/branches/sync` | none | MEDIUM — unauthenticated Poster→CUP write trigger |
| POST | `/catalog/sync` | none | MEDIUM — unauthenticated Poster→CUP write trigger |

**Legitimately public, verified as intentional and correctly scoped:** `GET /branches`, `GET /catalog/categories`, `GET /catalog/products`, `/health*`, `GET+POST /webhooks/poster` (secured by Poster signature, not a Nest guard), `POST /auth/telegram`, `POST /admin/auth/login`, `POST /staff/auth`, `GET /pos-widget/ping`.

**Duplicate/obsolete endpoints:** none found beyond `POST /orders` itself being an obsolete duplicate of `POST /cart/checkout`'s functionality with none of its safety.

**Naming consistency:** every admin route is `admin/<resource>`, every customer route is bare `<resource>`, every staff route is `staff/<resource>` — no inconsistency found.

## 32. Environment

Full schema in `src/common/config/env.schema.ts` — fail-fast Zod validation (the app refuses to boot on an invalid/missing required var), 38 variables total. Classified:

**Required, no default (boot fails without):** `DATABASE_URL`, `POSTER_API_BASE_URL`, `POSTER_API_TOKEN`, `TELEGRAM_BOT_TOKEN`, `JWT_SECRET`, `ADMIN_JWT_SECRET`.
**Operator safety interlocks (default OFF/false, deliberately not an Admin setting):** `POSTER_SYNC_ENABLED`, `POS_WIDGET_ENABLED`, `POS_REWARD_REDEMPTION_ENABLED`, `POS_PROMOTION_REDEMPTION_ENABLED`, `CRM_AUTOMATION_SEND_ENABLED`, `REWARD_CHECKOUT_ENABLED`.
**Optional, feature-scoped:** `POSTER_DEFAULT_CLIENT_GROUP_ID`, `MINI_APP_URL`, `STAFF_JWT_SECRET` (derives from `ADMIN_JWT_SECRET` if absent), `POSTER_APPLICATION_SECRET`, `POSTER_ACCOUNT`, `POS_WIDGET_ACCOUNT`, `POS_WIDGET_PUBLIC_URL`, `TELEGRAM_BOT_USERNAME`, `ADMIN_BOOTSTRAP_EMAIL`/`PASSWORD`.
**Tuning, all defaulted sensibly:** the remaining ~18 interval/timeout/threshold values.

**Documentation contradiction found (Verification Rule, §1):** `.env.example`'s own comment block for `POS_REWARD_REDEMPTION_ENABLED` states *"no verified-safe Poster mutation mechanism exists yet... every redemption attempt today still resolves to FAILED BLOCKED_NO_VERIFIED_POSTER_MUTATION."* This is **false as of today** — `env.schema.ts`'s own (newer) comment on the same variable states *"Reward mutation is implemented and live-verified,"* and this session's own 5+1 report showed 10 real, successful `RewardRedemption` rows with real reward products. **`.env.example` needs a one-line update** (not performed — audit is read-only); a new operator reading only `.env.example` today would be told the wrong thing about a feature that is actually live in production.

**Two genuinely-separate reward-redemption paths, worth stating plainly since it's easy to conflate:** `REWARD_CHECKOUT_ENABLED` gates the **Mini App checkout** redemption path (Phase 8.1) — its own comment says it needs a "supervised real verification order" before enabling, and it is **not** set in local `.env`, suggesting it has likely never been turned on. `POS_REWARD_REDEMPTION_ENABLED` gates the **POS-widget** redemption path (Phase 22) — confirmed live (all 10 real redemptions in local `dev.db` have `orderId: null`, i.e., POS-path, not checkout-path). **If the owner believes "reward redemption works," it is important they understand it currently only works via the physical POS widget, not via the customer redeeming in the Mini App during checkout.**

No secret value is reproduced anywhere in this document.

## 33. Deployment

Production architecture (from `package.json` scripts and prior session context, cross-checked live via public health endpoints during this audit): backend on Render (`render:build` runs `prisma:generate:prod` against the generated Postgres schema, then `tsc`; `render:start` runs `prisma:migrate:prod` — i.e., **migrations run automatically on every deploy start**, not as a separate manual gate — then starts the compiled app), database on Supabase Postgres (pooled connection, port 6543, `pgbouncer=true`, per `.env.example`'s own comment), Admin on Vercel (`cup-admin.vercel.app`, confirmed via `admin/vercel.json`'s SPA rewrite config added this session), Mini App and Staff presumably on Vercel too (not independently re-confirmed this pass). CORS/health/startup were not independently re-audited beyond the three public health checks (§8), which all returned healthy.

**Auto-migrate-on-deploy is worth flagging as a deliberate risk tradeoff, not a bug:** it means a bad migration would apply automatically on the next deploy rather than requiring a manual "run migrations" step — appropriate for a single-operator small business, less appropriate if this ever becomes a team-operated system with a real staging gate.

## 34. Migration Health

25 SQLite migrations (dev) vs. **5** Postgres migrations (prod: `0001_init` consolidating everything through Phase 26, then `0002_customer_isactive`, `0003_finance_accounting_v1`, `0004_pos_import_allow_anonymous`) — a deliberate, documented squash-for-first-deploy pattern (Phase 24), not drift: verified today that both `schema.prisma` and the generated `prisma/postgres/schema.prisma` list exactly the same 52 models with zero name differences, and the Postgres schema file carries an explicit "GENERATED — do not hand-edit" header enforced by `scripts/generate-production-schema.js`, which refuses to run if the source schema's datasource provider isn't exactly `"sqlite"` (a safety check against silently generating from a mismodified source). **No destructive operation** (`DROP COLUMN` on a populated table, etc.) was found in any of the 4 post-init Postgres migrations — they are all additive (`ADD COLUMN`, `ALTER ... DROP NOT NULL`) or a single documented `DROP CONSTRAINT`/re-`ADD CONSTRAINT` pair for the anonymous-import nullability change.

## 35. Documentation

`.env.example` is stale in one place (§32) — the only outdated documentation found via direct verification against code (rather than trusting a doc's own claim). `docs/` contains many phase-specific audit/design documents (not enumerated exhaustively here) that this audit's own Verification Rule required treating as historical record, not current truth — several phase docs referenced by code comments (e.g., `docs/PHASE-22-AUDIT.md`, `docs/PHASE-0-PLAN.md`) were not independently re-read in this pass since the code itself was the more direct source for every claim in this document.

## 36. Technical Debt

**CRITICAL**
- `POST /orders` unauthenticated real-order-creation endpoint (§9, §14, §31). *Location:* `src/modules/orders/orders.controller.ts:58`. *Impact:* real financial/operational exposure, not theoretical. *Direction:* remove, or gate behind `AuthGuard` with ownership enforced from the token, matching `POST /cart/checkout`.

**HIGH**
- Two parallel loyalty ledgers with no reconciliation (§21). *Direction:* pick one authoritative source per purpose and document it, or formally retire Phase-3 loyalty.
- `AuthGuard` doesn't revoke a deactivated customer's existing session (§12, §14). *Direction:* add `isActive: true` to the guard's lookup, matching every other customer-lookup method in the same repository.
- Residual risk that the anonymous-POS-customerId-null bug class (§7) exists in modules not yet re-audited beyond the two fixed this session. *Direction:* a dedicated, bounded audit of every remaining consumer of `PosterImportedTransaction.customerId`.

**MEDIUM**
- `POST /branches/sync` / `POST /catalog/sync` unauthenticated write triggers (§14, §31).
- Stale `.env.example` documentation for reward redemption (§32).
- Two unreconciled tax rates (CUP's `TaxRule` vs. Poster's `finance.getTaxes`) (§5).
- Zero conversion attribution from Campaign sends to revenue (§23).
- `StaffModule`'s duplicated DI instance of `CustomerActivityRepository`/`Service` (§2) — latent, not currently harmful.

**LOW**
- `Referral.status` schema default `"PENDING"` is dead code (never written) (§5).
- `FinancePnlPage`'s duplicate-name React key warning (§28) — already tracked separately.
- Filename/class-name mismatches (`rewards/reward-programs.module.ts` → `RewardsModule`; `branches/branch.module.ts` → `BranchModule`) — cosmetic only, resolves correctly.

## 37. Business Risk

**CRITICAL**
- **Anonymous order creation** (`POST /orders`) could create real, unwanted Poster POS transactions and send Telegram notifications to real customers who never ordered anything — direct operational and reputational exposure.

**HIGH**
- **Loyalty double-ledger** (§21) could eventually show a customer (or the owner) two different "points" numbers with no obvious explanation of which is right.
- **Deactivated customer retains access** (§12) — a business reason for deactivating someone (dispute, abuse, request) is not actually enforced.

**MEDIUM**
- **Unauthenticated sync triggers** could be used to force unnecessary Poster load or briefly desynchronize the catalog/branch tables, though not to corrupt revenue.
- **Webhook reliability is unresolved at the Poster-dashboard level** (§11) — the safety net (reconciliation) works, but if this is ever forgotten, "continuous sync" is quietly polling-only.

**LOW**
- Poster's two documented account-shape quirks (`spot_id` string-vs-number, `dash.getSpotsSales` money-unit inconsistency) are handled today but each represents a class of "the next Poster field will probably also be inconsistent" risk for future integration work.

## 38. Capability Matrix

| Capability | Status | Evidence | Limitations |
|---|---|---|---|
| Telegram (bot, /start, contact) | COMPLETE | `telegram/` module, real bot polling confirmed in earlier phase | — |
| Mini App (catalog/cart/checkout/orders/account) | COMPLETE | `cart`, `orders`, `catalog`, `customers` modules + full Mini App frontend, builds clean | `POST /orders` legacy hole (§9) |
| Customer 360 | COMPLETE | `admin-customers` composing 13 modules | — |
| Poster customer sync | COMPLETE | `poster-clients.service.ts`, verified live client creation | — |
| POS Import | COMPLETE | `poster-import`, three-layer dedup (§7) | refunds unmodeled |
| Continuous Sync | PARTIAL | queue+reconcile works; webhook delivery unresolved at Poster's end (§11) | dashboard "Check" fails |
| POS Widget | COMPLETE (read) / PARTIAL (write) | overview live; reward redemption live; promotion redemption partial (2 of 4 types) | percent/fixed discounts have no Poster mechanism |
| Reward Redemption | PARTIAL | POS-path live and verified; Mini-App-checkout path built but likely never enabled (§32) | two paths, only one proven |
| Loyalty (Phase 3) | COMPLETE but arguably SUPERSEDED | `LoyaltyAccount`/`LoyaltyTransaction`, live | overlaps Loyalty 2.0 (§21) |
| 5+1 | COMPLETE | schema, engine, admin report all verified this session | — |
| CRM Automation | FOUNDATION ONLY (in production) | built complete, two-gate interlock (§22), 0 executions locally | owner enablement steps unverified in this pass |
| Segments | COMPLETE | one canonical evaluator | — |
| Campaigns | COMPLETE (send) / NOT IMPLEMENTED (attribution) | manual send works | no conversion tracking (§23) |
| Promotions | PARTIAL | FREE_PRODUCT/LOYALTY_POINTS mutate; PERCENT/FIXED never can (§34) | by Poster limitation, not a CUP bug |
| Referrals | FOUNDATION ONLY (in production) | complete engine, 0 rows locally | live `/start ref_` path only simulated per prior session record |
| Growth Intelligence | COMPLETE | read-only, nothing stored/sent | thresholds need real-world tuning |
| Analytics | COMPLETE | canonical, cross-checked (§24) | — |
| Branch Intelligence | COMPLETE (after this session's fixes) | §7, §27 | — |
| Reports | PARTIAL | Overview/Sales/Locations done; 13 more planned reports not started (§25) | — |
| Finance | COMPLETE, honestly partial-by-nature | §15 | theoretical COGS only, by design |
| Purchasing | NOT IMPLEMENTED | no schema (§18) | — |
| Inventory | NOT IMPLEMENTED | no schema (§16) | — |
| COGS | PARTIAL, by architecture | §17 | can never be "actual" without Inventory |
| Product Profitability | PARTIAL | gross profit exists at theoretical-COGS level | no waste/actual-cost view possible |
| Payroll | NOT IMPLEMENTED (only generic expenses) | §19 | — |
| Cash Management | PARTIAL | movements yes, till/payment-method split no (§20) | — |
| Marketing Attribution | NOT IMPLEMENTED | §23 | — |
| Admin UI | COMPLETE | 14 functional areas, one shared design system (§28) | — |
| Security | PARTIAL — one CRITICAL hole | §14 | `POST /orders` |
| Observability | PARTIAL | audit trail + health pages exist; no centralized structured logging (§30) | — |

## 39. Production Readiness

| Area | Status | Evidence |
|---|---|---|
| Operational | READY WITH RISKS | webhook reliability unresolved (§11); everything else operating |
| Financial | READY WITH RISKS | Finance is honest and correct for what it measures, but COGS/inventory/payroll are structurally absent — fine for a coffee shop tracking revenue/expenses/tax, not sufficient for full unit economics |
| Data | READY WITH RISKS | two real bugs found and fixed this session prove the anonymous-POS-purchase edge case wasn't fully propagated everywhere; residual risk flagged (§36) |
| Security | **NOT READY** | one CRITICAL unauthenticated order-creation endpoint (§9, §14) |
| Performance | READY | no N+1 or unbounded-query pattern found in the areas read this audit; not load-tested |
| UX | READY | consistent design system, real empty/loading/error states throughout Admin |
| Reliability | READY WITH RISKS | duplicate-revenue protection is genuinely solid (§7, §9); sync reliability depends on a poll, not the intended webhook (§11) |
| Observability | READY WITH RISKS | enough to debug manually; no aggregation/alerting layer |
| Recovery | READY WITH RISKS | migrations are additive and reversible-in-spirit; POS-import reruns are safely idempotent (§10); no documented DB backup/restore drill was found or verified in this pass |

## 40. Critical Risks

Ranked by potential to cause direct, immediate business harm — not by how interesting they are:

1. **`POST /orders`** — anonymous, unauthenticated real order creation attributable to any customer (§9, §14, §31). Fix this before anything else in this list.
2. **Loyalty double-ledger** (§21) — the kind of ambiguity that turns into a customer-facing dispute ("your app says I have 50 points, the receipt said 30") if left unresolved long enough for both ledgers to diverge in practice.
3. **Deactivation doesn't revoke access** (§12, §14) — undermines the actual business purpose of the deactivate feature.
4. **Anonymous-POS-customerId-null bug class may recur elsewhere** (§7, §36) — two instances were found and fixed by accident (while building an unrelated report), not by a deliberate sweep; a third instance could currently be live and undetected.
5. **Webhook reliability at Poster's end** (§11) — not a CUP defect, but a single point of "continuous sync isn't actually continuous" if the reconciliation poll is ever disabled or its interval widened without understanding why it's load-bearing.

## 41. Recommended Roadmap

**P0 — Critical production risks**
- Remove or guard `POST /orders`. *Affected:* `orders` module only. *Dependency:* none. *Reason:* live, unauthenticated, real-money-adjacent exposure. *Outcome:* the endpoint either requires the same authenticated-customer-ownership model as `/cart/checkout`, or is deleted (its own test suite would need updating — which the audit was told not to do, but a real fix would have to).
- Gate `POST /branches/sync` / `POST /catalog/sync` behind `AdminAuthGuard`. *Affected:* `branches`, `catalog`. *Dependency:* none. *Outcome:* no unauthenticated write path remains anywhere in the API.

**P1 — Data integrity**
- Sweep every remaining consumer of `PosterImportedTransaction.customerId`/`posterClientId` for the anonymous-null class of bug found in §7 (start with `promotions`, `loyalty2`, `automations` repositories — already patched per prior session memory — then everything else not yet re-checked). *Dependency:* none. *Outcome:* confidence that the fix pattern is applied everywhere, not just where a report happened to surface it.
- Add `isActive: true` to `CustomersRepository.findById()`'s use inside `AuthGuard`, or add an explicit check in the guard. *Dependency:* none. *Outcome:* deactivation actually deactivates.

**P2 — Financial correctness**
- Decide and document Loyalty vs. Loyalty 2.0's authoritative relationship (§21). *Dependency:* a business decision, not just an engineering one. *Outcome:* one number per concept, or an explicit, user-facing explanation of why there are two.
- Reconcile or explicitly separate the two tax rates (CUP `TaxRule` vs. Poster `finance.getTaxes`) (§5).

**P3 — Inventory / COGS**
- If the business genuinely needs actual (not theoretical) COGS or waste tracking, this requires a **new** Warehouse/StockMovement/Purchase foundation — not a Finance-module change. *Dependency:* a real product decision on whether manual stock entry, POS-integrated stock, or a hybrid is wanted. This is the single largest genuinely-missing subsystem in the platform.

**P4 — Security**
- Independent CORS/rate-limiting audit (not done in this pass, §14).
- A deliberate review of every endpoint that accepts a client-supplied id and confirm server-side ownership scoping (most already do, per §31 — this would be a confirmation pass, not a rebuild).

**P5 — Performance**
- Load-test the Poster-facing paths (COGS sync, POS import, reconciliation) once real order volume grows past today's scale — nothing found today suggests urgency, but nothing was measured under load either.

**P6 — UX**
- Fix the `FinancePnlPage` duplicate-key warning (already tracked, §28).
- Continue the Reports build-out (Payments, Products, Categories, Employees, etc., §25) in the order the existing Reports Phase-1 audit already recommended.

**P7 — Business intelligence**
- Campaign conversion attribution (§23).
- ABC analysis, ties into the Products/Categories reports above.

**P8 — Advanced features**
- Purchasing/Supplier management (depends on P3).
- Payroll as a real structured concept, not generic expenses (§19).
- Payment-method (cash/card) breakdown surfaced from Poster's own report (§20).

## 42. What Should NOT Be Built Yet

- **Do not build a second reward or loyalty mechanic** until the existing two-ledger ambiguity (§21) is resolved — a third system would make the problem worse, not better.
- **Do not build Inventory/Purchasing as a Finance-module add-on.** It needs its own schema foundation (§16, §18); bolting stock fields onto `Product`/`Expense` would repeat the exact anti-pattern this codebase has otherwise carefully avoided (see how deliberately COGS was kept "theoretical, from Poster only" rather than half-inventing an inventory model to make it "actual").
- **Do not enable `REWARD_CHECKOUT_ENABLED`** (the Mini-App-checkout reward path) without a supervised real verification order, per its own code comment — this is not a "just flip the flag" feature, and its Poster price-honoring behavior has never been confirmed.
- **Do not build more Reports pages before fixing `POST /orders`.** The audit found a live financial-exposure bug while building the 3rd Reports page this week; further feature velocity into the same area without pausing for the P0 fix would be a real prioritization mistake.
- **Do not build a payment-method dashboard yet** — with the real account observed at 100% cash in an earlier phase, this has near-zero business value right now; revisit if/when card payments are actually used.
- **Do not build campaign attribution before Reports' own Products/Customers pages exist** — attribution needs a clean per-customer purchase-after-send join, which is much simpler to build on top of Reports' Phase C/D (already roadmapped) than as a bespoke Campaigns-module feature.

## 43. Exact Next Actions

1. Decide how to remediate `POST /orders` (delete vs. guard) — this needs the user's decision, not a unilateral fix, since its own comment says it exists to avoid breaking an existing test suite. **Recommend asking the user directly before touching it.**
2. Add `AdminAuthGuard` to `POST /branches/sync` and `POST /catalog/sync`.
3. Add the missing `isActive: true` filter to the customer lookup `AuthGuard` uses.
4. Update `.env.example`'s stale comment on `POS_REWARD_REDEMPTION_ENABLED`.
5. Run the residual anonymous-customerId-null sweep described in P1.
6. Bring the Loyalty-ledger question to the owner as an explicit decision point, not an engineering-only fix.

## 44. Files Inspected

Representative, not exhaustive (full detail is in the sections above with inline citations): `prisma/schema.prisma` (full, 1338 lines), `prisma/postgres/schema.prisma` (diffed), all 25 SQLite + 5 Postgres migration folder names, `scripts/generate-production-schema.js`, `src/app.module.ts`, `src/common/config/env.schema.ts`/`config.service.ts`, `.env` (redacted key list only) and `.env.example` (full), all 5 `package.json` files, every `*.controller.ts` (35 files, via dedicated sub-agent pass + direct spot-verification of the 3 critical findings), every `*.module.ts` (32 files, via dedicated sub-agent pass), `src/modules/orders/{orders.controller.ts,orders.service.ts,create-order.dto.ts}`, `src/modules/auth/auth.guard.ts`, `src/modules/admin-auth/admin-auth.guard.ts`, `src/modules/customers/customers.repository.ts`, `src/modules/poster/{poster.service.ts,poster.types.ts,poster-money.ts}` (read in full earlier this session, re-confirmed), `src/modules/poster-import/poster-transaction-import.service.ts` (dedup logic), `src/modules/poster-sync/{poster-webhook-signature.ts,poster-webhook.service.ts}` (full), `src/modules/branch-intelligence/branch-intelligence.repository.ts` (full, including this session's own fixes), `src/modules/growth-intelligence/growth-intelligence.repository.ts` (this session's own fix), `src/modules/rewards/*` (full, this session's own work), `src/modules/reports/*` (full, this session's own work), `src/modules/finance/*` (structure, from this session's own earlier build), `admin/src/ui/base.css`.

## 45. Verification Results

**Typecheck (`npx tsc --noEmit`):** backend PASS, admin PASS.
**Production build:** backend PASS (`prisma generate && tsc`), admin PASS (`tsc --noEmit && vite build`, 470.67 KB JS / 50.33 KB CSS), Mini App PASS (194.80 KB JS main chunk + split), Staff PASS (173.31 KB JS + split `jsQR` chunk), POS Widget PASS (single 178.49 KB IIFE bundle).
**Read-only local database inspection:** full count sweep across 40 tables, `dev.db`, reported in §8.
**Read-only production check:** `GET /health`, `/health/poster`, `/health/db` — all `200 OK`, no credentials used.
**Read-only Poster API inspection:** none performed in this specific audit pass (relied on this session's own prior, first-hand verification of Poster method behavior, cited with dates throughout §9 rather than re-querying Poster live) — no Poster credentials were used and no Poster call was made during this audit.

**Tests:** NOT WRITTEN. NOT RUN. (19 test files exist under `test/`, pre-existing, untouched.)
**Deployment:** NOT DONE. No code, schema, environment variable, or production data was changed to produce this document.
