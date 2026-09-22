# Architecture Decisions

## Phase 17 — Analytics Dashboard V1

**D17-1 Business timezone is a fixed offset, default UTC+5.** `BUSINESS_TIMEZONE_OFFSET_MINUTES` (default 300). The business is
in Uzbekistan (no DST), and no timezone setting existed. A day is `[local 00:00, next local 00:00)`, start-inclusive and
end-exclusive, so no sale can fall in two days. The chart is zero-filled per business day. A DST-observing zone would need a real
tz library instead.

**D17-2 What counts as a sale.** CUP: orders in the same statuses the existing Customer Metrics use (sent_to_poster, accepted,
preparing, ready, completed), revenue = `Order.totalMinor`, time = `Order.createdAt`. POS: `PosterImportedTransaction` with
status `IMPORTED` only, revenue = `totalMinor`, time = `occurredAt`. UNRESOLVED / IGNORED / skipped rows and Poster receipts that
CUP itself created are never counted, so nothing is double counted.

**D17-3 Aggregate in the database, one repository.** Prisma only in `AnalyticsRepository`; Prisma `aggregate`/`groupBy` for
totals, customers and products; ~13 queries per request in two `Promise.all` waves (plus product names), no per-row loops. The
frontend formats and draws; it performs no business calculation.

**D17-4 Raw SQL only for day grouping.** Prisma cannot group by a computed local day, so `cupDailyRevenue`/`posDailyRevenue`
use `strftime('%Y-%m-%d', ts/1000 + offset, 'unixepoch')` (SQLite stores DateTime as epoch-ms). This is the only
non-portable SQL and is parameterised (`Prisma.sql`). No materialized views, snapshots, Redis or jobs.

**D17-5 Customers are distinct across sources; new/returning uses global history.** A customer with a CUP order and a POS
purchase in the period counts once. "Returning" = had any qualifying sale (any branch, either source) strictly before the period
start; everyone else active in the period is "new". New + returning always equals customers. History is intentionally global even
when a branch filter is on, so a customer is not "new" to a branch merely because they first bought elsewhere.

**D17-6 Money.** Whole-UZS integers end to end; analytics never divides by 100 (Poster conversion happened at the Poster
boundary, factor 1). Average check = `Math.round(revenue / orders)`, 0 with no orders.

**D17-7 POS product revenue uses the line paid amount.** POS KPI revenue uses the transaction `totalMinor`; POS product revenue
uses `posterPayedSumMinor` (observed equal to the line total). POS lines with no mapped product are excluded from top products
(but still counted in revenue). CUP top products count paid units only (`isRewardItem = false`).

**D17-8 Branch filter never leaks.** Branch = `Order.branchId` / `PosterImportedTransaction.branchId`. An unmapped POS
transaction (null branch) appears only under "All branches", never under another branch.

**D17-9 No migration.** Analytics reads existing tables; POS data appears automatically once import rows are `IMPORTED`. The UI
shows "No imported data yet" only when no `IMPORTED` row exists at all — it never fabricates data.

**D17-10 Security.** `AdminAuthGuard` only; customer and staff JWTs use different keys/audience so they get 401. No customer
parameter is accepted; the response exposes no customer IDs, Poster tokens or transaction IDs. Custom ranges are validated
(valid dates, start ≤ end, ≤ 366 days) and unknown branches return 400.

**D17-11 Admin UI error handling.** On a failed request the page hides the previous figures (so a stale period is never shown
under a new filter) and shows a friendly message with Retry.

## Phase 11.3 — POS → Reward Integration

**D113-1 One engine, one change point.** No POS reward service exists. `RewardProgressRepository.sumQualifyingQuantityWith` is the
single place that decides where qualifying units come from; it now returns CUP units + imported POS units. Because both
`RewardProgressService.getProgress` and `RewardRedemptionService.createRedemptionRecord` (inside its transaction) call it, display,
eligibility and redemption safety all see the same number. Progress stays derived (`floor(total / buy) − redemptions`, `total %
buy`) — no cached progress, no snapshot table, no migration.

**D113-2 Canonical tables only; Poster is never called.** Reward calculation reads `PosterImportedTransaction(+Item)` and CUP
`Order(+Item)` from the local DB. It has no dependency on `PosterService`, and the import pipeline is unchanged
(Poster → import service → imported tables → reward engine).

**D113-3 Deduplication authority is `posterTransactionId`.** The Phase 11.2 unique index makes one Poster receipt one row, so it
contributes once. Nothing is de-duplicated by amount, time, name, phone or quantity.

**D113-4 Customer identity = the import's recorded attribution.** `PosterImportedTransaction.customerId` was resolved at import
time through `client_id → Customer.posterClientId`; `setPosterClientIfMissing` never overwrites a link, so it cannot drift. No
phone / name / amount / time / branch matching. Rewards are per customer, not per branch, so there is no branch filter; a
receipt from another mapped branch still counts for the same customer, an unmapped/inactive branch is never IMPORTED.

**D113-5 Qualification comes from the RewardProgram.** Poster `product_id → Product.posterProductId → Product.categoryId =
RewardProgram.qualifyingCategoryId`. Nothing hardcoded (no category, product, customer or branch ids). Like the CUP side,
`Product.isActive` is not filtered, so a product deactivated later does not erase earned history; there is also no date filter (a
program's `startsAt` is checked when redeeming, not when counting history — same as CUP).

**D113-6 Extra guards beyond `status = IMPORTED`.** `paidMinor > 0`, `quantity > 0`, line `posterPayedSumMinor > 0`. The import
already guarantees these, so the guards exist only so a corrupt row is excluded instead of guessed at (no partial counting of a
malformed line, no crash). A line Poster reports as paid 0 is treated as not paid — deliberately the conservative direction for a
free-item reward; whether Poster reports a discounted/complimentary line that way is unverified.

**D113-7 Refunds / returns are NOT modelled.** Poster refund behaviour is unverified (Phase 11.1/11.2). We do not assume that a
negative receipt, a Return button or any Poster status means "reversed", and we never subtract POS purchases or create negative
reward records. Imported POS purchases are treated as finalized sales. A POS sale that earned a reward and is later refunded in
Poster keeps its credit until refund semantics are verified and a reversal design is approved.

**D113-8 CUP-originated receipts stay excluded.** They are counted once as CUP orders (paid units, `isRewardItem = false`); the
import never stores them as IMPORTED. Residual risk: if a CUP order's receipt link is not yet reported when the import runs, that
receipt could be imported as POS too (timing of `incoming_order.transaction_id` is unverified).

**D113-9 Customer 360 reuses the same service.** The additive `rewards` block calls `RewardProgramsService.listForCustomer` (the
service behind `GET /loyalty/rewards`) and exposes only name, threshold, qualifyingCount, availableRewards. Existing CUP
`metrics` keep CUP-only meaning; Phase 17 analytics definitions are untouched.

**D113-10 Real data.** The real POS import was not run and no reward program was created in the real DB; all scenarios ran on a
throw-away DB copy (deleted afterwards) with a stubbed Poster reader.

## Phase 11.4 — Unified Customer 360

**D114-1 Compose, don't recompute.** The unified summary is a pure composition (`customer-summary.ts`) of two canonical sources with
the exact Analytics V1 rules; the CUP side reuses the customer-metrics repository aggregates through a new bounded
`getSummaryForCustomer` (the old `getMetricsForCustomer`, which loads the whole order list, is left untouched). Money stays integer;
the average is `Math.round(total / purchases)`.

**D114-2 Legacy fields keep their meaning.** `metrics`, `activity`, `favoriteBranch`, `recentOrders`, `recentPosPurchases` remain CUP-only /
POS-only; the unified favorite branch lives in `summary.favoriteBranch` (no id). The redesigned UI reads only the unified fields.

**D114-3 Merged cursor feed, no offset.** One virtual feed ordered by (time DESC, kind rank ASC, id DESC). For each source the
database applies "strictly after the cursor" (later-ranked source: time ≤ t; earlier-ranked: time < t; same source: time < t or
(time = t and id < i)), fetching at most limit+1 rows; the union is sorted and cut. At most 4×(limit+1) rows are read per page, the
cursor (time, rank, id) is unique and totally ordered so pages never overlap or skip and stay stable when newer rows arrive.

**D114-4 Only qualifying purchases are listed.** The purchase feed uses the same statuses as the totals (qualifying CUP orders,
IMPORTED POS) so the table reconciles with the KPIs; pending/failed/cancelled/uncertain orders and UNRESOLVED POS never appear.

**D114-5 Reuse of loyalty / rewards / promotions / segments.** Loyalty via `LoyaltyService` (no lazy account creation), rewards via
`RewardProgramsService.listForCustomer`, promotions via `PromotionsService.listForCustomer` (read-only), segments via a new single-customer
`SegmentsService.listMatchingForCustomer` that runs the same evaluator over one id (one query for active definitions, no per-segment
query). Promotion eligibility is deliberately not re-implemented; its existing cost profile is accepted and documented.

**D114-6 Privacy.** Phone masked (one-way, display only); no Telegram/Poster/customer/transaction ids in the new blocks; opaque cursor.

**D114-7 UI never shows stale or technical text.** Selecting another customer clears the previous figures first; errors are friendly
Uzbek text with Retry; all empty states have Uzbek copy; no fake zero charts.

## Phase 12 — Loyalty 2.0

**D12-1 Derive what can be derived, persist what must be exactly-once.** Level, XP, streak, achievement progress and birthday eligibility are pure
functions of canonical purchases + Admin configuration (no cached customer aggregate, nothing assigned). Money-like and event records — the cashback
ledger, the per-purchase accrual marker, level-ups, achievement unlocks, birthday claims — are persisted behind unique constraints so they can never be
duplicated, and they snapshot the rules used so a later configuration change never rewrites past earnings.

**D12-2 Purchases are the existing definition.** Qualifying CUP orders (`CUSTOMER_METRICS_ORDER_STATUSES`) + IMPORTED POS, timed by
`Order.createdAt` / `occurredAt`, so lifetime spend equals the unified Customer 360 / Analytics figures.

**D12-3 The level in force BEFORE the purchase.** Cashback and the points multiplier for a purchase use the level derived from spend before it, so a
purchase that crosses a threshold earns at the old level's rate. A late-arriving (older) POS import is processed at the level of ITS time. Level-up
events are dated at the purchase that crossed the threshold; the base level is not a "level up".

**D12-4 One idempotent writer, two triggers.** `syncCustomer` is safe to run repeatedly and concurrently (unique constraints; the accrual row, the
cashback row and the points credit commit in ONE transaction). It runs lazily on the customer's overview and from a background job; every read
(including Customer 360) is strictly read-only. The job does nothing while the program is off.

**D12-5 Ships OFF; explicit start date.** `loyalty2.enabled` defaults to false; the first enable stamps `accrualStartsAt` = now (it cannot be cleared) so
history never earns cashback/points retroactively by surprise. The seeded levels/achievements are editable defaults (rewards 0 points, coffee
achievements inactive until a category is chosen), written once into an empty database (same precedent as the loyalty-code backfill).

**D12-6 Purchase points are a separate switch, through the existing engine.** Points on purchases use the EXISTING earn settings x the level's
multiplier and are credited through `LoyaltyService` (new `creditPointsTx`, the same EARN ledger row inside a caller transaction) — no second points
system. The switch is separate from the master switch because the real earn rule is already configured (1 point per 1 000 so'm).

**D12-7 Integers only.** cashbackRateBps (basis points), pointMultiplierPercent (percent), XP and cashback in whole so'm, rounded down; nothing
fractional is ever stored.

**D12-8 Streak.** Distinct business days with a qualifying purchase (fixed-offset business timezone, as Analytics). Same day: no increment; next day:
+1; skipping a whole day resets; `current` stays alive while the last visit was today or yesterday; `best` is the longest run. A streak reward is deferred.

**D12-9 Birthday = eligibility only.** `Customer.birthDate` is set once by the customer (it cannot be re-armed). Eligibility is derived: from the birthday for
`birthdayWindowDays` days (29 Feb -> 28 Feb in non-leap years, the window may straddle New Year), once per birthday year (claim table keyed by
customer+year). Granting is an internal service method with no route until a later phase.

**D12-10 Achievements are configuration.** Conditions are an allowlist (total purchases, category units — the same source as reward progress, morning /
weekend purchases in business time, best streak, reward redemptions); the category is chosen in Admin, never hardcoded; an unlock happens once per
customer with its reward points credited in the same transaction; achievements are deactivated, not deleted.

**D12-11 History = union of canonical ledgers.** The points ledger, cashback ledger, level-ups, unlocks and reward redemptions are merged with the same
bounded merged-cursor design as the Customer 360 feed; there is no history table and no ids in the payload.

**D12-12 Security.** Customer routes: customer AuthGuard only, identity from the token, no id parameter. Admin routes: AdminAuthGuard only, strict zod
schemas plus server-side validation. Staff have no access. Refund reversal, cashback spending and referral rewards are explicitly out of scope.

## Phase 13 — CRM Automation

**D13-1 Automation above Campaign, one delivery pipeline.** `Automation` owns WHEN / WHY / WHO / HOW OFTEN; the existing `Campaign` owns WHAT message and WHICH
channel. Sends go through `CampaignMessagingService.deliver` (the manual-send policy: pacing, one 429 retry, uncertain never retried), so there is no second
campaign engine. Deviation: the Campaign model is one-shot (`CampaignRecipient` unique per campaign+customer) but automations repeat, so each delivery is
recorded on `AutomationExecution` instead of `CampaignRecipient`.

**D13-2 Events are derived, not queued.** No Kafka/Redis/queue. Purchase events are read from the canonical tables (qualifying CUP orders + IMPORTED POS rows)
with a per-automation cursor advanced by compare-and-swap; time = `Order.createdAt` / POS `importedAt`, with a 30 s settle lag. Crossing detection (reward
credits, milestones) uses time-bounded bulk aggregates so a threshold fires once, at the purchase that crossed it.

**D13-3 Idempotency by deterministic key.** `AutomationExecution` is unique on (automation, triggerKey) with keys built from the customer and the event
(first-purchase, birthday year, reward program+index, inactivity period, milestone metric+threshold, cart id+version, schedule run key). Re-detection or a
crashed run can never produce a second execution.

**D13-4 History never fires.** Watermark = max(activation, CRM-enable time, now - maxEventAgeHours). Older events are never detected; a queued send whose
condition no longer holds or that has waited past the age limit becomes SKIPPED (`CONDITION_NO_LONGER_MET` / `EXPIRED`). "Inactive" customers are matched only
from activation onward unless `includeExisting` is chosen explicitly.

**D13-5 Limits are database facts.** Cooldown + frequency use `AutomationSendSlot` (unique automation+customer+ordinal); the daily cap uses `CrmDailySlot`
(unique customer+day+slot). Both are inserted in one interactive transaction with a bounded retry on unique violation / write conflict, stamped with the
decision time. Attempted sends count (a failed send still consumes its slot) — the safe direction for customer-facing messaging.

**D13-6 Quiet hours defer.** A send inside quiet hours (fixed-offset business timezone, window may cross midnight) is held PENDING with `notBeforeAt` = end of
the window and is not re-evaluated as a new trigger; it is not discarded.

**D13-7 Two independent gates + a dry run.** `crm.automation.enabled` (Admin, default false, stamps the enable time) and `CRM_AUTOMATION_SEND_ENABLED`
(operator env, default false, read-only in Admin, re-checked immediately before the transport). With either closed nothing is detected, queued or sent.
Preview computes the would-be audience read-only and writes nothing.

**D13-8 Structured config, no rule language.** Triggers are an allowlist with strict per-trigger schemas; no scripts, expressions or free-form rules. The
scheduled-segment audience is the automation's own segment. Categories, programs, thresholds and delays are configuration, never hardcoded.

**D13-9 Personalisation allowlist.** Only `{{firstName}} {{displayName}} {{points}} {{rewardCount}} {{rewardProgress}} {{level}} {{branchName}}`; values are
computed server-side and only for variables present; unknown variables are rejected at create/activate and never silently blanked.

**D13-10 Abandoned cart respects CART_EXPIRY.** The existing cart expiry (default 1 h) is authoritative: detection looks at carts inactive for the configured
delay but not yet expired, so the delay must be shorter than the expiry. The cart version (its last-change time) is part of the key.

**D13-11 Foreign keys restrict.** Automation -> Campaign / Segment use `onDelete: Restrict` (the optional segment relation would otherwise default to SET NULL and
silently widen an audience). Campaign delete now returns a friendly conflict; automations are archived, never deleted.

**D13-12 Transient errors release, permanent errors record.** A claim that hits transient contention with no reservation is released for retry; a stale claim
is swept after a timeout using wall-clock time; an uncertain Telegram result is recorded FAILED and never retried (no duplicate-send risk).

**D13-13 Security and privacy.** `AdminAuthGuard` only on every route; ACTIVE automations cannot change their trigger/campaign/segment; the API and UI show
customer names but never ids, chat ids or raw error codes (delivery errors surface as `DELIVERY_FAILED`); logs carry counts only.

## Phase 14 — Referral System

**D14-1 Extend the Phase 12 foundation, do not duplicate it.** The empty `referrals` table (unique referredCustomerId) is extended with nullable columns via plain ALTER TABLE ADD COLUMN (no
table rebuild, so the migration is genuinely additive). Two new tables hold the code and the reward proof. The legacy `loyalty2.referralEnabled` flag is left in place but no longer consulted:
`referral.enabled` is the single master switch.

**D14-2 A separate public code.** The referral code is not the loyalty code: that one is shown as a QR / barcode and read by staff at the till, so sharing it publicly would hand out a
scannable identity. `REF-XXXXXXXX` is random, non-sequential and carries no identity. Only the body is stored; it is created lazily on the customer's first request (no backfill, so the
real DB stays untouched while the program is off).

**D14-3 First valid attribution wins, in the database.** `Referral.referredCustomerId` is unique, so a repeated /start, a second code or concurrent attempts can never change or duplicate the
relationship. Only a valid attribution writes a row (no row per click or per rejected attempt); rejections are silent to the friend. A friend who already has a qualifying purchase is not
attributable (rewards are never retroactive), and A->B while B->A exists is refused (circular).

**D14-4 Deterministic fraud rules only.** Self-referral, duplicate attribution, circular referral and prior purchase. No IP / device inference, and a shared phone is not blocked because
the registration architecture does not enforce phone uniqueness.

**D14-5 Qualification is derived, not hooked.** There is still no reliable order-lifecycle event (see the Phase 3 note), so a bounded background job derives qualification from the canonical
purchases (Loyalty2Repository: CUP orders + IMPORTED POS), exactly like Loyalty 2.0 and CRM automation. The decision is a pure function (`decideReferral`); the state change is a compare-and-set
on the referral row.

**D14-6 The window applies to the purchase time; 0 means never.** An in-window purchase qualifies even if processed late; nothing qualifying after the window becomes EXPIRED and is kept for audit.
`attributionWindowDays = 0` is documented as "the attribution never expires". A purchase before attribution closes the referral (PRIOR_PURCHASE), which also catches a late-imported older POS purchase.

**D14-7 Effective minimum of 1.** A zero-value purchase (e.g. fully reward-covered) never qualifies, whatever the configured minimum. With first-purchase-only ON a first purchase below the minimum closes
the referral (rather than waiting indefinitely); OFF, the earliest purchase that meets the minimum qualifies.

**D14-8 Rewards are exactly-once by construction.** `ReferralReward` is unique on (referralId, beneficiary); the claim row is inserted before the points are credited and both commit in ONE transaction, so
a lost race rolls back its credit and the retry finds the winner. Points use the existing ledger (`creditPointsTx`, EARN) — no parallel ledger, balance never touched directly. Status is a projection;
reward rows are the proof (GRANTED / SKIPPED + reason).

**D14-9 The cap is a database fact.** A referrer's GRANTED rewards get ordinals 1..N under a unique (customer, beneficiary, ordinal), so `maxSuccessfulReferrals` holds across concurrent DIFFERENT
referrals (0 = unlimited). A capped referrer gets a SKIPPED row; the friend's reward is never blocked. Prior rewards are never removed.

**D14-10 Qualify, then reward, with a reconciler.** Qualification and reward are separate idempotent steps so a crash between them is repaired by the next tick instead of leaving a qualified referral unpaid.

**D14-11 POINTS only for now.** CASHBACK is a reserved value the server refuses to save until it is integrated safely. Reward values are read when the reward is granted.

**D14-12 Referral events for CRM, nothing sent.** REFERRAL_ATTRIBUTED / REGISTERED / QUALIFIED / REWARDED are derived from the lifecycle timestamps with deterministic keys and a resumable cursor (the Phase 13
model). Referrals never call Telegram; a later automation trigger decides what to do with the events.

**D14-13 Bot identity without a cycle.** ReferralsModule does not import TelegramModule (which imports it for /start). The bot username comes from optional `TELEGRAM_BOT_USERNAME` or is pushed by the bot when
it starts polling — never hardcoded, no API call from referrals.

**D14-14 Security and privacy.** Customer routes: customer AuthGuard only, identity from the token, no write route at all. Admin routes: AdminAuthGuard only, strict zod schemas + server-side range validation,
no write route for referrals / rewards. No response carries Telegram ids, phones, Poster ids or customer ids; invited friends appear to the referrer only as counts and anonymous history rows.

## Phase 15 — CRM / Growth Intelligence

**D15-1 Derive, do not store.** RFM, lifecycle, signals and opportunities are pure functions of the canonical purchases and the configured thresholds, computed on demand. There is no table, no migration and no
cache, so nothing can go stale, be generated twice or drift from Customer 360 / Analytics. (Signal history — "was AT_RISK last month" — is therefore not available; see the limitations.)

**D15-2 One aggregate, one definition.** A single bulk SQL pass (window functions) is the only place per-customer unified purchase figures are computed for growth; every consumer goes through
`GrowthIntelligenceService`. It uses the same qualifying predicates as Loyalty 2.0 / Analytics V1 / Customer 360 (CUP orders in CUSTOMER_METRICS_ORDER_STATUSES + IMPORTED POS), and was verified against both.
CustomerMetricsService itself is CUP-only, so it cannot supply unified figures; reusing it would have produced a second, contradictory definition.

**D15-3 Absolute, configurable scoring — no percentiles, no model.** Recency / frequency / monetary scores come from 4 explicit boundaries each (Admin configuration). "5 = top 20%" style rules were
deliberately not used: a percentile score moves when OTHER customers change, which is neither stable nor explainable per customer.

**D15-4 Lifecycle precedence is total and strict.** Inactivity states are tested first (CHURNED, DORMANT, AT_RISK), then NEW, LOYAL, ACTIVE; "beyond" a threshold means strictly greater, so 14 days is still ACTIVE at
activeDays 14 and 60 days is still DORMANT at churnDays 60. The settings validator refuses inverted or overlapping thresholds instead of guessing. No purchase = no state (never a made-up "prospect" state).

**D15-5 Calendar days in business time.** Recency and every "N days" rule count business-local calendar days (BUSINESS_TIMEZONE_OFFSET_MINUTES, fixed offset, as Analytics), so a purchase at 23:59 and one at 00:01
the next day are 1 day apart and two purchases on the same date are 0 days apart, identically in JavaScript and SQL.

**D15-6 Branch views are branch-scoped, never inferred.** A branch view uses only purchases whose own branchId is that branch, so recency / lifecycle / lifetime figures describe the customer at that branch. A customer
whose activity has no mapped branch is in "All branches" and excluded from any specific branch.

**D15-7 Signals: deterministic identity, honest timestamps.** Each signal key is the customer plus the event or period that defines it (an inactivity period is identified by the purchase that started it, so a new
purchase ends it and a later lapse is a new period). detectedAt is the moment the data says the condition became true (e.g. last purchase day + threshold + 1); where no moment is recorded (a reward balance) it is null rather
than the evaluation time. Severity is fixed per type. No event bus, no persisted event log.

**D15-8 Opportunities are a rule table, not opinions.** Priority is the output of documented rules (inactivity x high value, days since the only purchase, inactivity x reward, ...). Each opportunity recommends an
EXISTING Segment definition and Phase 13 trigger type; nothing is created, queued or sent. Wording is descriptive ("meets the configured AT_RISK rule"), never predictive; verified by scanning every payload.

**D15-9 No cache in V1.** The dashboard is one aggregate query (183 ms for ~5 200 customers), so a cache would only add staleness. Growth data for Segments is loaded only when a segment uses a growth field, so existing
segments cost exactly what they did.

**D15-10 Segments extend the allowlist, not the engine.** New fields plug into the existing evaluator; the multi-valued growthSignal is handled explicitly (equals = has, not_equals = does not have), null growth data never
matches (the existing "no data never satisfies a condition" rule), and values are validated (lifecycle names, signal names, RFM code 1-5 x 3). Dynamic evaluation stays authoritative — no static customer lists.

**D15-11 Candidate feeds without leaking ids.** The read-only trigger candidates expose a hashed, stable event key and cursor (the internal key contains the customer id); a server-side consumer requests `internal: true`.
Growth Intelligence itself never registers an automation, so the Phase 13 gates (`crm.automation.enabled`, `CRM_AUTOMATION_SEND_ENABLED`) are not involved and cannot be bypassed.

**D15-12 Privacy and security.** AdminAuthGuard only; the only write is the threshold configuration (strict zod + server-side ordering validation). No response carries a customer id, Telegram id, phone or Poster id;
customers appear by display name, and Admin lists are not linked by id.

## Phase 16 — Staff Panel 2.0

**D16-1 Compose, never recompute.** The Staff profile is a composition layer over the canonical read models (loyalty, Loyalty 2.0, rewards, promotion eligibility, referrals, Growth Intelligence, the Customer 360 activity feed). No
rule, score or eligibility decision exists in the Staff module, so Staff, Customer 360, the Mini App and Admin can never disagree. It is read-only by construction: no mutation method is injected.

**D16-2 One request, public code only.** Everything a scan needs arrives in ONE bounded response (the frontend never calls loyalty / rewards / promotions / referrals / growth / orders separately). Customers are addressed by the
public loyalty code, following the Phase 11 `/by-code/:code` convention; the Phase 11 card endpoint stays as it was and there is no second lookup system (search reuses the same normalisation).

**D16-3 Branch scope is explicit and asymmetric on purpose.** Identity, loyalty, rewards, promotions and referral status are customer-level (global). Purchase activity defaults to the staff member's own branch, and the
branch growth block is computed by the Phase 15 branch-aware code and labelled with the branch name beside the global block, so a branch figure never silently becomes a global one. `scope=all` is allowed (the Phase 11 card already
showed all branches); asking for another specific branch is 403 for branch-assigned staff, allowed for admin actors and unassigned staff, 400 for an unknown branch. Unmapped-branch purchases appear only in the all-branches view.

**D16-4 No new staff actions that move value.** No balance, points, reward, refund, payment, POS settlement or referrer assignment — those stay outside Staff. Customer notes were not added: no note model exists and the phase gives no
operational need that justifies a new table. "Open QR" was skipped (no QR renderer in the Staff app; the code is shown and copyable).

**D16-5 Search 2.0 reuses the existing conventions.** Phones use the stored "+digits" form (`normalizeTelegramPhone`); the only addition is trying the 998-prefixed form of a 9-digit national number. Results are capped at 20 and enriched with ONE
bulk aggregate (level derived from lifetime spend exactly as Loyalty 2.0 does; lifecycle / last purchase from Growth Intelligence). Last-digits and Poster-id searches were not added (ambiguous / not something staff know).

**D16-6 Audit without a new table.** `StaffScanEvent` is reused: `PROFILE_VIEW` is written once per staff + customer per 60 s so a refresh is not an event, and "Recent" is read from the staff member's own events. Nothing sensitive
(tokens, secrets, Poster credentials, full phone numbers) is ever logged.

**D16-7 Privacy by shape.** The payload is shaped for the counter: masked phone, Telegram username, day + month of birth, Poster as LINKED / NOT_LINKED, counts only for referrals, no ids of any kind (the shared promotion view carries a
product id — it is stripped), no segment / campaign / recommended-trigger information, and one indistinguishable 404 for a malformed or unknown code.

**D16-8 Fix the only cost that scaled with the customer base.** A segment-targeted promotion used to evaluate the segment over EVERY customer to test one; it now asks the same evaluator about just that customer
(`filterCustomersInSegment`), with an identical result. With that, one profile costs a fixed ~91 SQL statements at any customer count.

**D16-9 A dependency-free hash router and a scan-first shell.** Scan, Search and Recent are a single narrow column (one-handed, phone-first); only the profile grows to two columns from 700 px. Hash routes keep the back button working and
let a profile reopen after a reload with no server route. The UI stays Uzbek and reuses the existing Staff design tokens.

**D16-10 No schema change.** Everything Phase 16 needs is derivable from existing models, so no migration was created.

## Phase 18 — Branch Intelligence

**D18-1 Describe, never rank.** Branches are listed by name and compared as figures side by side. There is no score, tier, "best" / "worst", winner / loser, forecast or health index — a branch's numbers depend on its size, hours and neighbourhood, none of which CUP knows, so
any single ordering would be an invention. Shares are descriptive percentages, labelled as such.

**D18-2 One purchase definition.** The canonical qualifying purchase (CUP sent_to_poster / accepted / preparing / ready / completed + POS IMPORTED) is the only input, exactly as in Analytics, Customer 360, Loyalty 2.0 and Growth. POS purchases are read from the
stored import tables; Poster is never called. Nothing about the import (Phase 11.2) changed.

**D18-3 Branch attribution is the stored branch, nothing else.** `Order.branchId` for CUP; for POS the branch mapped from the Poster spot at import time. Never inferred from customer, staff, product or time. A purchase with no branch stays in the all-branches totals (Analytics V1
semantics) and in no branch row; it is shown as "Not tied to a branch" so branch rows + unmapped == the Analytics V1 total and nothing disappears silently.

**D18-4 New vs returning at a branch.** New = the customer's first purchase EVER fell at this branch inside the period; returning = the other purchasers there. Analytics V1's definition (no sale anywhere before the period start) is kept for the all-branches view and shown beside the
branch figure. They differ only for a customer whose first purchase was at another branch inside the period; exposing both avoids silently redefining a V1 number and keeps new + returning = customers.

**D18-5 Cross-branch purchasing, from purchase records only.** The wording is deliberately "cross-branch purchasing", not "migration" or "loyalty to a branch": the data proves where purchases were recorded, not where a person went. Three counts: 2+ branches in the period, latest purchase
here, a purchase here that directly followed one at another mapped branch.

**D18-6 Conservative attribution for loyalty, rewards, promotions, referrals.** A figure is attributed to a branch only through a record that names a purchase: points ledger / reward redemption / promotion redemption through their order, Loyalty 2.0 accruals and cashback through the
source purchase, referrals through the qualifying purchase key. Anything without such a link is reported as unattributed and stays in all-branches numbers. Reward availability is customer-level progress and is labelled as such. Nothing was back-filled and no column was added.

**D18-7 Reuse, don't duplicate.** Analytics V1's period resolver and item aggregates, Growth Intelligence (lifecycle / RFM / signals / opportunities, branch-scoped, same thresholds) and the reward availability service are called, not re-implemented. The two refactors are minimal and
behaviour-preserving (the period resolver moved verbatim into a shared function; Growth can open an inactive branch historically). The growth block is as-of-today with the configured lookback and does not follow the period filter — it describes customers, and is labelled.

**D18-8 Bulk SQL, constant statement count.** Branches are a GROUP BY, never a loop: the overview is 7 statements and the detail 55 whatever the number of branches; the per-customer new / cross-branch logic uses window functions (ROW_NUMBER, LAG) inside SQLite. Measured at ~5 100
customers and 166 branches: ~266 ms (overview) / ~309 ms (detail). No cache, queue or precomputed table was introduced — none was justified by the measurements.

**D18-9 Time.** Same business timezone and day boundaries as Analytics V1 (`BUSINESS_TIMEZONE_OFFSET_MINUTES`, default UTC+5), zero-filled days, custom range max 366 days; "active days" = calendar days with at least one qualifying purchase (no opening-hours assumption).

**D18-10 Security.** Admin-only (AdminAuthGuard); customer and staff tokens use different keys / audience and are 401. GET only, strict query schema (unknown parameter = 400), branchId pattern-checked and resolved against the branch table (unknown = 400). The response carries no customer id,
phone, Telegram id, Poster id or secret. No Branch Intelligence data is exposed to the Staff panel.

**D18-11 Inactive branches.** An inactive branch is never hidden or re-labelled by this phase: it appears in the comparison only when it had activity in the period (labelled "Inactive"), can be opened from the table, and is absent from the selector by default. Branch status is untouched.

**D18-12 No schema change, no external side effects.** Everything is derived from existing tables; no migration exists for this phase. It sends no Telegram message, makes no Poster request, imports no POS data and mutates no loyalty / reward / referral row.

**D18-13 The Admin shell became responsive below 760 px.** The fixed 220 px sidebar left ~155 px of content on a phone, which made every dense page (including the new one) overflow. The sidebar now stacks above the content at that width only; wider layouts are byte-for-byte as before.

## Phase 19 — POS Import Activation & Attribution Data Quality

**D19-1 Activation is a deliberate, gated sequence — never a side effect.** PREVIEW -> VALIDATE -> REVIEW -> EXPLICIT CONFIRM -> IMPORT. Nothing imports on startup, on a schedule, on login, after a restart, after a mapping change or after a preview; the only caller of the write path is the admin
POST with its full gate. Finishing the implementation is not permission to import: the real import waited for the owner's explicit approval and ran only after it (2026-09-21).

**D19-2 One engine.** Preview, data-quality live scan and import share `analyze()`; `run()` adds only the gates and the writes the analysis planned. The Phase 11.2 architecture (normalizer, repository, link cache, unique Poster transaction id) is reused, not redesigned.

**D19-3 A real import must be reviewed and bounded.** Besides dryRun:false + confirm:true it needs an explicit window (<= 31 days), an explicit limit (<= 100), the refund-policy acknowledgement, the importable count of the reviewed preview (a drift is refused) and a clean branch mapping. Every gate fails before the first write.
The reviewed-count check is what turns "review" from a UI convention into a server rule.

**D19-4 Branch mapping is structural — report it, do not re-point it.** `Branch.posterSpotId` is required, unique and IS the branch's identity (the Poster spot sync creates a branch per spot). A PATCH that rewrites it would fork the branch from its own history and fight the next sync (which would create the original spot again), so no such
endpoint exists; a duplicate mapping is impossible by the unique index (and reported as a checked fact). What Admin needs is visibility: Poster spots vs CUP branches, unmapped spots, orphan branches, inactive branches and name drift — never a name-based guess. Fixing an unmapped spot = the existing spot sync.

**D19-5 Attribution never guesses, never creates.** Customer by Poster client id (else skip, no customer is created), branch by spot id (else skip, never another branch), product by Poster product id (else UNRESOLVED audit row, never by name); modifiers are not interpreted. Skipped and unresolved receipts are counted and valued in the
report so the gap is visible instead of silent.

**D19-6 Refunds: REFUND_UNVERIFIED (policy B).** No refunded, returned, deleted or negative receipt exists in the account, so Poster's refund representation cannot be verified and is not invented. A negative amount / quantity is excluded, deleted (status 3) receipts are counted, an imported receipt now listed as deleted is
reported, nothing is reversed automatically, and each real import requires an acknowledgement. When a real refund is observed, a reversal model can be added deliberately.

**D19-7 Never double-count a CUP order.** The documented incoming_order.transaction_id link is the authority (cached in poster_incoming_order_links only after the gates pass). Because that lookup is bounded, an undocumented application_id on an unlinked receipt is used as a one-way safety net: it can only cause a SKIP.

**D19-8 A receipt is atomic and the batch is resumable.** Header + lines are one DB transaction; a duplicate is recognised only by the Poster transaction id; a failed receipt is rolled back, reported and retried by simply re-running; an UNRESOLVED audit row is upgraded in place. No manual cleanup is ever needed.

**D19-9 The import creates facts, not consequences.** Reward progress, analytics, growth, customer profiles and branch intelligence derive from the canonical purchases, so they change when purchases appear — the confirmation dialog and this document say so (notably the "5+1" program: 1 -> 6 available rewards). The import itself grants no
reward, points, cashback, promotion redemption or referral, and the legacy earn rule never runs for POS. **Correction learned at the real import:** Loyalty 2.0 was ON in the real DB (the owner enabled it earlier that evening), and its existing sync — which accrues every canonical purchase once, after its accrualStartsAt — accrued points / cashback / achievements for the one imported purchase made after that moment. That is designed, non-duplicating behaviour, not a Phase 19 write; but "Loyalty 2.0 is off" must be checked in the real DB before every future import. CRM automation and referrals (off) will treat imported purchases by their own rules when enabled.

**D19-10 Traceability without a new table.** The imported-transaction table already carries importedAt, status, source and the branch / customer / amounts; the paginated history reads it. A run table would add schema for information already present.

**D19-11 Performance.** Bulk lookups (a fixed handful of statements independent of the number of receipts, apart from Prisma's IN-list chunking at 999 parameters), one Poster receipt read + one deleted read per preview, incoming-order lookups bounded to the unlinked CUP orders (<= 100) and cached after the first real import. No cache
or queue was added.

**D19-12 UI safety.** The Import button is a two-step control (unlocked only by a current, clean, acknowledged preview; opens a dialog; the dialog has its own confirmation) and is the only place dryRun:false is sent. Loading, refreshing, filtering and navigating are read-only by construction.

**D19-13 External side effects and real-data status.** Poster: read-only GETs only (spots, receipts, deleted receipts, incoming-order links). Telegram: none. The first real import was executed on 2026-09-21 after the owner's explicit approval: fresh preview == reviewed set (7 receipts, 8 100), imported 7, failed 0.

**D19-14 Re-verify the live configuration before a real import.** Verification ran on a copy whose settings were snapshotted earlier; the owner changed real settings (Loyalty 2.0 on, a reward program) in the meantime. Before any future real import: re-read the real DB's loyalty2 / reward / referral / automation settings and re-run the preview, so the consequences shown to the owner are the ones that will actually happen.

## Phase 20 — Poster Webhook Continuous Sync & Reliability

**D20-1 Webhooks are the primary path, reconciliation the safety net.** Poster documents webhooks, so a sale should arrive by push; but the documentation gives no event id, no retry interval and no statement of when a transaction webhook fires, so the design must not depend on any of that. Every webhook is a HINT; the truth is re-read from Poster; a periodic read of the last days heals whatever the push missed.

**D20-2 Acknowledge only after the event is durably stored, and never wait on business logic.** The receiver verifies, commits a row, wakes the processor and answers. If the commit fails it fails the request so Poster's own retry redelivers it (at-least-once); if the secret is missing it answers 503 rather than "accept" (nothing silently dropped). It never calls Poster, so the POS can never be slowed by CUP.

**D20-3 Verify exactly what is documented.** The md5 signature over `account;object;object_id;action;[data;]time;secret`, compared in constant time. No invented signature, replay window or IP allow-list. Replay of a valid body is harmless because processing is idempotent. An optional account pin narrows trust further. Structured `data` (no documented serialisation) is acknowledged and dropped, never trusted.

**D20-4 Deduplicate by (object, object_id, action, time).** Poster documents no event id and re-sends the same body on retry, so that tuple identifies a delivery; a real new change has a new time. Poster's 15 retries collapse into one row with a delivery counter.

**D20-5 One import engine.** The automatic path calls the same `classify()` and `persist()` as the reviewed import. The only difference is the policy: no human review, so a receipt is written only if the preview would have called it IMPORTABLE (plus UNRESOLVED audit rows) — never a create, a guess or a reversal. The bulk-import admin gates do not apply to a single receipt.

**D20-6 Restart-safe, lossless, bounded.** The queue is a table; a claim is a compare-and-set; a lease older than 5 minutes belongs to a dead worker and is reclaimed; failures back off exponentially and end DEAD (visible, manually retryable) instead of looping forever; a settling receipt is deferred to its exact due time without counting as a failure; a Poster outage stops the tick after the first failed read.

**D20-7 Removed in Poster is a flag, not a reversal.** Refund / return semantics are still unverified (Phase 19). A receipt Poster reports as removed that CUP had imported is recorded as REMOVED_IMPORTED and raised in Admin for a human; nothing is reversed automatically.

**D20-8 The activation switch is an operator interlock, default OFF.** Automatic writes to real data start only when the operator sets `POSTER_SYNC_ENABLED=true` (like the CRM send interlock). Off, the receiver still queues durably so nothing is lost while the owner sets up Poster; the backlog is processed when enabled.

**D20-9 Accept any Content-Type on the webhook route, and only there.** Poster does not document it, and a PHP sender posting a raw JSON string commonly labels it form-urlencoded, which Fastify mangles into a single odd key. The route normalises the three shapes (object, string, single-key form) and refuses anything that is not the documented JSON; every other route keeps its 415.

**D20-10 One queue table, no external queue.** SQLite + compare-and-set is enough at this volume (measured 4.5 ms / event received, ~28 ms / event processed); Redis or a broker would add an operational dependency for no measured need.

**D20-11 Other entities are acknowledged, not stored.** Only `transaction` carries a sale. Poster retries an unacknowledged webhook 15 times, so other selected entities are verified where possible and acknowledged, but never grow the table.

**D20-12 Real-environment status.** Schema migrated (backup taken), flag OFF, no secret, nothing registered in Poster, no webhook received. The owner's activation steps (stable URL, dashboard registration, application secret, flag) are documented in PROJECT_STATE.md; the first real webhook must be watched in the Admin panel.

**D20-13 Reconciliation resumes from a durable checkpoint, not from "now minus N days".** A fixed lookback loses everything older than N days after an outage; a checkpoint ("every closed receipt before T has been decided") makes recovery independent of how long CUP was down. It lives in the Setting table (no schema change), is saved chunk by chunk (a crash keeps its progress), is monotonic, and is the ONLY thing that decides where the next pass starts. The old lookback env survives only as the initial checkpoint.

**D20-14 The checkpoint advances only over fully decided ground, and never on failure.** It moves to the end of a chunk, or stops just before the earliest receipt that is not decided yet (still settling, write failed, or beyond the per-step cap); a failed pass leaves it where it was and records the error. Decisions that are deliberate (no client, unlinked client, unpaid, CUP-created, refund-shaped) are final for the checkpoint — pinning it behind a receipt that may never be importable would stall recovery forever.

**D20-15 A configurable overlap re-reads the tail before the checkpoint.** Receipts can reach Poster's API a little late (offline terminals, clock skew); each pass re-reads `POSTER_RECONCILE_OVERLAP_MINUTES` (60) before the checkpoint. It is harmless because the Poster transaction id is unique, and it is a documented limit: a receipt more than the overlap late is outside it (use a larger overlap, or the reviewed admin import).

**D20-16 Use only the documented Poster parameters, verified live.** `after_date_close` was measured and compares against the account's LOCAL wall-clock time (a +3 h skew here) and `before_date_close` behaved inconsistently, so neither is used. The reconciliation uses the documented Ymd window (widened a day each side because Poster files a receipt under its account business day) plus the documented `next_tr` cursor (measured: returns only ids greater than the cursor), and does the exact time filter on the receipt's own `date_close` (a true UTC epoch).

**D20-17 Bounded work per pass, unbounded outage tolerance.** 2-day chunks, <= 12 chunks (~23 days) and <= 200 imports per step per pass; anything longer continues on the following pass from the persisted checkpoint. Poster documents no response-size limit, so each chunk is cursor-paged until a page brings nothing new (which also makes a cursor-ignoring server harmless).

**D20-18 Recovery is visible.** Admin shows the checkpoint, the lag, the last successful pass, the last pass and the last error (marked resolved by a later success), and alerts on a missing checkpoint, a lag beyond 3 intervals + overlap, an unresolved error, a held checkpoint and missed webhooks — so a silent recovery failure cannot hide.

## Phase 21 — Poster POS Widget

**D21-1 Read-only by construction, not by promise.** The widget's `PosterApi` type contains only the permitted Poster methods (a forbidden call does not compile), the backend module imports no mutation service and no `PosterService`, the final bundle is scanned for forbidden names and `before*` events, and the simulator traps and counts any forbidden call. A widget that can only look cannot cost a sale or a reward.

**D21-2 Identity is Poster's request signature, verified on the server; there is no fallback.** `Poster.makeRequest` is proxied by Poster, so the register cannot be trusted to say who it is; the documented signature is the one server-verifiable proof. Whether an ordinary plugin request is signed is not documented, so instead of guessing a substitute (a weaker auth invented on speculation) `ping` reports `signaturePresent` and the guard logs the rejection reason; the first real request decides whether a widget-scoped scheme is needed at all.

**D21-3 Per-request verification, no session.** Only GETs are used, so the signature (no body) covers the whole request; a token / cookie would add state and a second secret for no gain. Each signature is bound to its URL, so one signed URL cannot be replayed for another customer.

**D21-4 The account pin is secondary.** The signature does not cover `X-Poster-Url` or the spot / tablet headers, so the secret is the real trust; the pin stops another Poster account that installed the same application, and spot / tablet only label the audit row. The replay window (default 300 s, minimum 30) is a knob, not a guarantee.

**D21-5 Compose, don't rebuild.** The overview calls the existing read services (loyalty, Loyalty 2.0, rewards, promotions, customer metrics, POS activity, catalog) so it can never disagree with Customer 360 (verified equal). No new engine, no new table, no cache: the audit reuses `staff_scan_events` with a 60 s de-duplication and stores no phone, code, Poster id, payload or secret.

**D21-6 Two independent stale-response guards, and the active order is the authority.** A generation counter invalidates old contexts and a server-echoed `ref` ties each answer to its request. Because Poster documents neither the payload of `orderClientChange` nor whether it carries the client, the event is only a trigger: `orders.getActive()` decides orderId + clientId (event payload as fallback; if neither knows, the empty state — never a CUP call with a guessed or stale identity). A first version trusted the payload and would have silently shown "no customer" on a real POS whose events differ; the simulator's `?payload=empty` / `?active=off` now guard that.

**D21-7 A customer is never guessed and never attached.** A Poster id with no mapping is NOT_LINKED (no name / phone matching), a phone shared by two customers is AMBIGUOUS (asks for the CUP code — phones are not unique in CUP), and fallback lookup only displays: the widget has no method that could attach a client to an order.

**D21-8 Nothing blocks the register.** `before*` events hold checkout until `next()` and are never used; the reward is announced by a non-blocking notification and the popup opens only on a user action (notification click or app icon); every failure degrades to a short message that says the sale is unaffected, and CUP down never stops Poster.

**D21-9 Ships OFF, and unconfigured means closed.** `POS_WIDGET_ENABLED` is an operator interlock (default false); enabled without the secret or the pinned account is 503 `NOT_CONFIGURED`, never open. The real `.env` has none of the keys.

**D21-10 No money from Poster, no promotion maths.** Poster order totals are unverified in units, so only the item count is shown; `orderTotal` is reserved in the query (rejected today) as the Phase 22 seam and nothing is calculated.

**D21-11 The bundle carries one public value.** Only the public API URL can be baked in, and the delivered `bundle.js` is built without it (an unconfigured widget makes no request); production upload (`application.uploadPOSPlatformBundle`) is not scripted — it is a separately approved step.

**D21-12 The simulator is evidence for the widget, not for Poster.** It signs server-side like Poster and traps forbidden calls, so widget logic, stale handling, failure behaviour and layout are proven; anything that depends on Poster's real runtime (signing of ordinary requests, header contents, popup behaviour, Development mode) is recorded as NOT VERIFIED / NOT DOCUMENTED and listed with the step that will settle it.

## Phase 22 — Reward Redemption on the POS Widget

**D22-1 Never invent an unverified Poster mutation.** Four candidate mechanisms exist (`orders.addProduct`, `orders.setOrderBonus`, REST `addTransactionProduct`, a native Poster promotion); none has been verified safe to make a product free on a real open order without side effects (`docs/PHASE-22-AUDIT.md`). Rather than guess, `PosterRewardMutationService.isSupported()` always returns `false`, and the one code path that would call Poster is provably unreachable behind that check. Every real attempt ends `FAILED BLOCKED_NO_VERIFIED_POSTER_MUTATION`; no reward is ever consumed and no fake success is ever returned.

**D22-2 A new, minimal, dedicated attempt model — not a reused or repurposed field.** `RewardRedemptionAttempt` is separate from `RewardRedemption`: the latter's `orderId` refers to a CUP `Order` and was never going to be safely overloaded to also mean "a Poster POS order id" for some rows and not others. `RewardRedemptionService.createRedemptionRecord` was widened to accept `orderId: string | null` and return the created id, rather than duplicating the write path.

**D22-3 Idempotency and concurrency are database facts, not frontend promises.** A unique constraint on `attemptId` makes a retried/duplicated client request a no-op replay, not a second attempt; an unresolved-status lookup for the same customer+program inside the same transaction rejects a second, differently-id'd concurrent attempt. Both checks live inside one short transaction scoped to `reward_redemption_attempts` only — see D22-4 for why that scope matters.

**D22-4 Nothing that reads through the outer `PrismaService` may run inside the redemption transaction.** The first implementation called the (non-tx) audit service from inside `prisma.runTransaction(...)`; under SQLite the outer-connection write contended with the open interactive transaction and reliably exceeded Prisma's 5 s timeout, turning every attempt into a 500. Both audit calls and the (non-tx) eligibility pre-check now run outside/after the transaction; the transaction body touches only `tx.rewardRedemptionAttempt.*` and, on the still-unreachable confirmed path, `tx`-safe `reward_redemptions` writes.

**D22-5 UNKNOWN is a real, distinct, non-retried terminal-ish state.** A Poster mutation result that is ambiguous (timeout, malformed answer, network failure) is never treated as success and never auto-retried; it is recorded `UNKNOWN` and shown to the barista as "can't confirm — don't press again," matching the two-layer error model (`ErrorKind` for the call itself vs. a business-level `status`) Phase 21 already established.

**D22-6 Independent operator interlocks, default OFF, and the flag is checked before authentication.** `POS_REWARD_REDEMPTION_ENABLED` and `POS_PROMOTION_REDEMPTION_ENABLED` are separate from `POS_WIDGET_ENABLED` and from each other; `PosRewardRedemptionGuard` returns 503 as soon as the flag is off, before the Poster signature is even checked (verified: a validly-signed AND an invalidly-signed request both get 503 with the flag off, identically). Promotion redemption is not implemented in this pass — the flag exists only so the architecture doesn't need reshaping later.

**D22-7 Extend the existing signature guard, don't fork it.** POST body inclusion in the signature (`md5(fullUrl + JSON.stringify(body) + time + secret)`) is conditional on `req.method === 'POST'` in the same `authenticate()` used by the Phase 21 GET; GET behaviour is byte-identical to before (still `body: undefined`). The POST formula is documented per Poster's own spec but — like the rest of Phase 21's auth — has never been exercised against a real Poster POST; that remains an open verification item, not a design gap.

**D22-8 Never show an unverified Poster money figure.** A live catalog check during this phase's own verification found several coffee products' synced `priceMinor` about 1000x too large in the real, currently-synced catalog — an unrelated, pre-existing data-quality issue, not something Phase 22 caused or is in scope to fix. Consistent with D21-10, the confirmation UI shows the product name and "FREE" only, never a price.

## Bug fix — Poster money-unit factor (2026-09-22)

**DBF-1 The factor is 100, not 1 — re-derived from the real catalog, not assumed.** Phase 10.1's factor-1 decision was made against a placeholder/test catalog and, by its own recorded evidence (Poster's UI rendering raw 300 as "3.00"), was already inconsistent with Poster's documented kopeck/tiyin unit at the time — it was simply never re-checked once real menu prices existed. Re-verified 2026-09-22 by comparing three independent sources for the same product (Poster Management's displayed price, a live `menu.getProducts` read, and a live `dash.getTransaction` read for a real receipt): all agree that Poster's wire integer is so'm × 100. One constant (`POSTER_PRICE_UNITS_PER_CUP_UZS`) is the single conversion boundary for both catalog prices and imported-transaction money — confirmed by inspection that no frontend formatter anywhere duplicates or undoes the conversion.

**DBF-2 Fix the boundary, not the data — and say so.** Correcting the constant only changes conversions computed from now on; no historical `Product.priceMinor` or `PosterImportedTransaction` row was rewritten. This was a deliberate choice, not an oversight: rewriting already-committed financial/audit records is a bigger, riskier action than a code fix and wasn't asked for. It was checked to be currently safe to defer — every `IMPORTED` (i.e. live-counted-by-Analytics) historical row predates the real catalog and is already-known Phase 9/10 test noise; the only rows at the new, real, wrong-until-fixed scale are `UNRESOLVED` (excluded from all reporting) for an unrelated reason (`UNMAPPED_PRODUCT`), so no currently-visible dashboard number was wrong because of this bug.

## Phase 22.2 — Real Poster mutation implemented (2026-09-22)

**D22-9 REST `transactions.addTransactionProduct(price: 0)`, chosen because it was live-verified, not because it was the only candidate.** All three
original candidates (POS `addProduct`+`setOrderBonus`, this REST call, a Poster-native promotion) were re-examined; only this one was actually tested
against a real order with the owner watching the register screen. `addProduct` still has no price argument (can't be free by itself); `setOrderBonus`
is still documented as a points payment, not a discount, and was never going to be misused as one (D22-1 still holds for those two). REST won on
evidence, not by elimination.

**D22-10 Never trust the widget for which order is "current" — re-derive it server-side from a value the widget can't have invented.** The widget can
only ever report `orders.getActive().order.id` (a millisecond timestamp). `PosterRewardMutationService` independently looks up currently-open
transactions via REST (`dash.getTransactions status=1`) and matches on `date_start`, which is the same millisecond value under a different name —
verified live to be a real, order-owned field, not something a client could forge into matching. A miss is refused (`ambiguous` → `UNKNOWN`), never
guessed past. `spot_id`/`spot_tablet_id` for the mutation itself still come only from the signed request context (D21-4's rule extended, not replaced).

**D22-11 Mutate, then verify by re-reading — a successful Poster response is not itself "confirmed."** `applyToOrder()` re-reads the order after
`addTransactionProduct` returns success and only reports `confirmed` if the zero-priced line is actually present, the order's own total is unchanged,
and no pre-existing line moved. This is what lets `RedeemRewardResult` distinguish "Poster said yes and we checked" from "Poster said yes" — the
difference matters because a positive HTTP response was never itself proof in this codebase (see the two-layer error model already established for
every other Poster call).

**D22-12 The Poster mutation must never run inside a database transaction.** Discovered mid-implementation, before it shipped: the redemption flow's
first cut would have run 1-3 real HTTP calls to Poster inside the same SQLite interactive transaction that also creates the attempt row — the exact
class of bug (outer/slow work inside a 5s-limited transaction) already hit once this phase for a much cheaper case (an audit-service call). Fixed by
splitting into three phases: a short DB transaction claims the attempt (and is what blocks a concurrent second attempt — its own existence at an
unresolved status IS the guard), the Poster mutation runs with no open transaction at all, and a second short DB transaction commits the result.

**D22-13 Crossing Phase 21's "no PosterService" boundary was a deliberate, single-purpose exception, not a repeal.** `PosWidgetModule` now imports
`PosterModule`, but only `PosterRewardMutationService` uses it; the read-only overview path (Phase 21's whole surface) is untouched and still composes
nothing but existing read services. The boundary existed to keep a read-only widget provably unable to mutate anything — Phase 22 is the one place
that guarantee was always going to end, by design (see docs/PHASE-22-AUDIT.md §1), and it ends in exactly one file.

## Phase 22.2 — One Poster order = maximum one reward redemption (2026-09-22)

**D22-14 The invariant is scoped to the Poster order, not the customer or the program.** A customer can have many banked rewards
(earned legitimately over time); the rule caps how many of them can be spent on ONE order, not how many exist. A second reward
PROGRAM attempting to redeem onto the same already-redeemed order is refused the same as a second attempt at the same program —
the check is keyed on `posterOrderId` alone.

**D22-15 Enforced inside the same short "claim" transaction as the existing customer+program concurrency guard, not as a
separate step.** Two new checks (`findRedeemedForPosterOrderTx`, `findUnresolvedForPosterOrderTx`) run in Phase A, before the
attempt is ever marked `POSTER_MUTATING` — so a second request can only ever observe the first's *already-committed* claim
(SQLite serializes writers), never an uncommitted one. This is what actually closes the race in the reported incident (10
sequential clicks, each individually valid, each allowed to proceed because nothing checked "has this order already used its
one reward" before mutating) — not a UI change, which the brief explicitly said not to rely on alone.

**D22-16 A nullable-and-unique column is the DB-level backstop, reusing a pattern this project already trusts.**
`redeemedForPosterOrderId` is `posterOrderId`'s own value, written ONLY on `markRedeemedTx`, left `null` every other time — SQLite
never collides two `NULL`s under a unique index, only two real matching values. This mirrors `RewardRedemption`'s own
`[rewardProgramId, customerId, redemptionIndex]` uniqueness and `RewardRedemptionAttempt.redemptionId @unique`: the check is the
primary defense, the constraint is what would actually fail loudly if the check were ever bypassed by a future bug.

**D22-17 An `UNKNOWN` result blocks further attempts on that SAME order too, not just that customer+program** — an
intentional extension of the codebase's existing "never auto-retry an ambiguous Poster result" rule (`UNRESOLVED_STATUSES`
already includes `UNKNOWN`). Verified by test: after an `UNKNOWN`, a fresh attempt for the SAME order is refused
(`CONCURRENT_ATTEMPT_IN_PROGRESS`) until the ambiguity is resolved out of band, while a DIFFERENT order is unaffected. This is
the conservative choice given the incident's own lesson: an unconfirmed Poster result must never be treated as "safe to try
again," because the first call may have actually succeeded.

**D22-18 Widget-side "already used" hiding is a courtesy, not the guard.** `redeemedOrderId` in the widget's local state hides
the button once a redemption is known (by this click or a REWARD_ALREADY_REDEEMED_FOR_ORDER response) to have used this order's
one reward — but the server rejects a second attempt regardless of what the widget shows, per the brief's explicit "do not rely
only on the widget UI" instruction.

## Phase 23 — Promotion redemption (2026-09-22)

**D23-1 The support matrix is per benefit type, not all-or-nothing.** `FREE_PRODUCT` reuses Phase 22's already-verified REST mechanism exactly (same
call, same order-identity resolution, same mutate-then-verify discipline); `LOYALTY_POINTS` needs no Poster mutation at all (a pure CUP-side credit via
the unchanged `LoyaltyService`); `PERCENT_DISCOUNT`/`FIXED_DISCOUNT` have no known Poster mechanism — confirmed by re-reading the full docs mirror, not
assumed — and are marked unsupported honestly rather than guessed at. `isSupported(benefitType)` encodes this per type, not as one global flag.

**D23-2 The existing `PromotionRedemptionService.redeem()` is reused unmodified, and called outside any transaction — deliberately, not by oversight.**
Unlike `RewardRedemptionService.createRedemptionRecord`, which Phase 22 built to accept an external `tx`, this Phase 7 method already had its own
race-safety (retry-on-unique-constraint for `usageLimitPerCustomer`, protecting ANY caller, not just this one) and is not transaction-aware. Wrapping it
in a transaction would either break its own retry loop or reproduce the exact "non-tx call inside an open transaction" bug already hit twice this
project (Phase 22.1, and the mutation-inside-transaction near-miss caught before shipping in Phase 22.2). It is called in the same non-transactional zone
as the Poster mutation itself, and only the resulting `PromotionRedemptionAttempt` row's own status update needs a (separate, short) transaction.

**D23-3 A confirmed-but-uncommittable redemption goes to UNKNOWN, never FAILED, never a faked REDEEMED.** The one genuinely new edge case this reuse
introduces: Poster confirms the mutation, but `PromotionRedemptionService.redeem()` then throws `PromotionNotEligibleError`/`PromotionRedemptionRaceError`
because a concurrent, non-POS-widget redemption (e.g. a CUP checkout) exhausted `usageLimitPerCustomer` in the exact gap between the two. The Poster order
was genuinely changed; CUP's own bookkeeping could not finalize a record. Marking this `FAILED` would misrepresent the order as unchanged; fabricating a
`RewardRedemption`-equivalent row without going through the real write path would break the very usage-limit invariant this reuse relies on. `UNKNOWN`,
for manual reconciliation, is the only outcome consistent with both "never fake success" and "never claim nothing happened."

**D23-4 One promotion per order is a SEPARATE invariant from Phase 22.3's one reward per order — same mechanism, different table, never cross-checked.**
A customer may use one reward AND one promotion on the same Poster order. The per-order guard (`findRedeemedForPosterOrderTx`/
`findUnresolvedForPosterOrderTx`) is scoped by `posterOrderId` within `PromotionRedemptionAttempt` only, structurally incapable of seeing
`RewardRedemptionAttempt` rows or vice versa — verified by test, not just by code review.

**D23-5 The widget hides the redeem button for benefit types that cannot mutate Poster, not just when the flag is off.** `PERCENT_DISCOUNT`/
`FIXED_DISCOUNT` promotions still display (read-only, as before Phase 23) but never show "Qo'llash" — clicking one would be guaranteed to resolve
`BLOCKED_NO_VERIFIED_POSTER_MUTATION` server-side regardless, so the widget doesn't invite that click at all. This is UX only; the server enforces the
real boundary (`isSupported()`) independently of what the widget renders, per the brief's "do not rely on the widget UI" instruction.
