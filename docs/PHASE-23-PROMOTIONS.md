# Phase 23 — Promotion redemption on the POS widget

**Status: IMPLEMENTED, PARTIALLY BLOCKED.** `FREE_PRODUCT` and `LOYALTY_POINTS` promotions have a
verified-safe Poster mutation path (the same one Phase 22 already verified live for rewards).
`PERCENT_DISCOUNT` and `FIXED_DISCOUNT` do not — no Poster API exists, documented or otherwise, to
set an order or line discount. `POS_PROMOTION_REDEMPTION_ENABLED` stays `false` in the real
environment; this document does not claim Phase 23 is production-ready (see §8).

## 1. Promotion architecture (pre-existing, reused unchanged)

- `Promotion` / `PromotionRedemption` (Phase 7): benefit types `PERCENT_DISCOUNT | FIXED_DISCOUNT |
  FREE_PRODUCT | LOYALTY_POINTS`; eligibility conditions supported are active/date-window, segment
  membership, and usage-limit-per-customer. There is **no branch, minimum-order-amount, or
  loyalty-status condition** in the existing model — Phase 23 does not invent any; only what
  already exists is exposed to the POS widget.
- `PromotionEligibilityService.checkEligibility()` — the single source of truth, reused as-is.
- `PromotionRedemptionService.redeem()` — the existing internal write path (own retry-on-
  unique-constraint loop for `usageLimitPerCustomer`, not transaction-aware), reused as-is, called
  from a new caller for the first time.
- `PosWidgetOverviewService` already surfaced promotions read-only (Phase 21); it stripped the
  promotion id entirely. Phase 23 adds `promotionId` (same reasoning as `programId` for rewards —
  not personal data, required to reference the promotion in a redemption request) and wraps the
  list as `{ redemption: { enabled }, items: [...] }`, mirroring the `rewards` shape exactly.

## 2. Poster promotion capabilities — the honest finding

Re-read the full Poster docs mirror (`en/pos/*`, `en/web/*`) specifically for promotion/discount
methods. **There is no `promotions.*` API family, and no documented way to set an order-level or
line-level discount or percentage.** `Order.discount` and `products[].promotionPrice` are
documented **read** fields only; nothing in the POS JS API or the REST API sets them. This is not
an oversight in this document — it was the entire point of §3's investigation, and the finding is
negative.

The only mutation mechanism this project has ever verified is Phase 22's REST
`transactions.addTransactionProduct(price: 0)` (docs/PHASE-22-AUDIT.md §15) — which adds a *new
line at a given price*. It cannot set a discount, and it cannot change an *existing* line's price.

## 3. Mutation support matrix

| Benefit type | Mechanism | Status |
| --- | --- | --- |
| `FREE_PRODUCT` | REST `transactions.addTransactionProduct(price: 0)`, adding the promotion's own `benefitProduct` | **Reuses Phase 22's already-verified-live mechanism.** Not yet exercised with a *promotion*-flavored redemption specifically on a real order (only the identical reward case was) — see §8. |
| `LOYALTY_POINTS` | None needed. The order is independently confirmed real/open via REST (same resolution as `FREE_PRODUCT`), then `PromotionRedemptionService.redeem()`'s existing `LoyaltyService.creditPoints()` call runs — a pure CUP-side action, unchanged by Phase 23. | Safe by construction — there is nothing on the Poster order to get wrong. |
| `PERCENT_DISCOUNT` | None exists. | **Explicitly unsupported.** `PosterPromotionMutationService.isSupported('PERCENT_DISCOUNT')` always returns `false`. Every real attempt resolves `FAILED` / `BLOCKED_NO_VERIFIED_POSTER_MUTATION`, regardless of the feature flag. |
| `FIXED_DISCOUNT` | None exists. | Same as `PERCENT_DISCOUNT`. |

## 4. Architecture (mirrors Phase 22 / 22.3 exactly, per the brief's explicit instruction to reuse)

- **`PromotionRedemptionAttempt`** (new model, migrations `20260922085034_phase23_promotion_redemption_attempts`
  and `20260922085221_phase23_promotion_attempt_name_snapshot`): the POS-originated attempt
  lifecycle — `REQUESTED → POSTER_MUTATING → REDEEMED`, or `FAILED` / `UNKNOWN`. A separate table
  from `PromotionRedemption` on purpose, same reasoning `RewardRedemptionAttempt` documents:
  `PromotionRedemption.orderId` means a CUP order, never a Poster order id, and a POS-originated
  attempt has no CUP order at all. `benefitType` and `promotionName` are snapshotted at request
  time so an attempt's audit trail never silently changes meaning if the promotion is edited
  afterward, and so an idempotent replay (which returns the stored row, never re-loading the
  Promotion) can still populate the response.
- **`POST /pos-widget/promotions/redeem`**: resolves customer/promotion server-side (never trusts
  the widget), re-checks eligibility via the existing `PromotionEligibilityService`, then mutates.
  Guarded by `PosPromotionRedemptionGuard` — the flag (`POS_PROMOTION_REDEMPTION_ENABLED`) is
  checked *before* the signature, same as `PosRewardRedemptionGuard`.
- **Poster order identity**: reuses the exact mechanism Phase 22 established — the widget's
  `orders.getActive().order.id` (a millisecond timestamp) is never trusted directly; the backend
  independently resolves it to a REST `transaction_id` by listing currently-open transactions
  (`dash.getTransactions status=1`) and matching `date_start`. No new identifier was invented.
- **Three-phase transaction discipline** (the same real lesson Phase 22 learned twice, applied a
  third time so it isn't re-learned): the Poster mutation is 1-3 real HTTP calls and must never run
  inside a SQLite transaction.
  - **Phase A** (short DB transaction): create/claim the attempt row — eligibility, **the "already
    redeemed on this order" check** (§5), the customer+promotion concurrency guard, then mark
    `POSTER_MUTATING`.
  - **Phase B** (outside any transaction): the Poster mutation (or, for `LOYALTY_POINTS`, just
    proving the order is real and open).
  - **Phase C**: on `confirmed`, commits via the **existing, unmodified**
    `PromotionRedemptionService.redeem()` — called outside any transaction too (it is not
    transaction-aware; its own retry-on-unique-constraint loop is what protects
    `usageLimitPerCustomer` across *any* caller, not just this one), then a short transaction marks
    this service's own attempt row `REDEEMED`. In the vanishingly rare case Poster confirms but
    `redeem()` then throws (a concurrent non-POS redemption exhausted the usage limit in that exact
    gap), the order was genuinely mutated but CUP could not finalize a redemption record — this is
    never marked `FAILED` (which would wrongly imply nothing happened) and never faked as
    `REDEEMED` without a real record: it goes to `UNKNOWN` for reconciliation (§7).

## 5. One promotion per Poster order

**Default safety rule** (the existing `Promotion` model has no "explicitly allows repeated use"
flag, so the conservative default applies): a Poster order may have **at most one** promotion
redemption, scoped by `posterOrderId` alone — **any** promotion, not per-promotion. This is a
**separate invariant from Phase 22.3's reward rule** (a reward and a promotion may each be redeemed
once on the same order; the two checks never reference each other's table).

- `PosWidgetPromotionRedemptionRepository.findRedeemedForPosterOrderTx` / `findUnresolvedForPosterOrderTx`
  — both run inside the SAME short "claim" transaction as the customer+promotion guard, so a second
  request only ever observes the first's *committed* state (SQLite serializes writers).
- DB-level backstop: `redeemedForPosterOrderId String? @unique`, set only on `REDEEMED`, mirroring
  `RewardRedemptionAttempt`'s identical column exactly.

## 6. Idempotency

Identical to Phase 22: `attemptId` is the widget-generated key; a replay hits a unique constraint
inside `createRequestedTx` and returns the already-decided (or still in-flight) row's state
unchanged — no second Poster call, no second redemption, no second audit event.

## 7. UNKNOWN handling and reconciliation

An ambiguous Poster result (network/timeout/malformed/verification mismatch) — or, uniquely to
promotions, a confirmed Poster mutation that `PromotionRedemptionService.redeem()` then could not
commit — is `UNKNOWN`, never auto-retried, never treated as success. A fresh attempt for the SAME
order is refused (`CONCURRENT_ATTEMPT_IN_PROGRESS`) while the unresolved `UNKNOWN` row exists — the
same conservative extension Phase 22.3 already applied to rewards (D22-17), because an unconfirmed
mutation may have actually succeeded. No automated reconciliation job exists; resolving an `UNKNOWN`
row today is a manual/operational action (out of scope for this phase, matching Phase 20's own
"visible, not automatic" recovery philosophy for genuinely ambiguous states).

## 8. What is NOT verified — production activation requirements

- **`FREE_PRODUCT`'s mechanism is proven** (Phase 22's identical REST call, live-verified on a real
  order), but has **not been exercised end-to-end through this specific promotion flow** on a real
  disposable test order. Recommended before enabling: one owner-approved live test, mirroring
  Phase 22.2's Experiment 4, on a fresh disposable unpaid order.
- **`LOYALTY_POINTS`** needs no Poster mutation, so its real-world risk is limited to CUP's own
  existing `LoyaltyService.creditPoints()` path (already in production use elsewhere) — lower risk,
  but still not exercised through this new entry point live.
- **POST-body Poster signature**: unchanged from Phase 22 — still the *documented* formula
  (`docs/PHASE-22-AUDIT.md` §7), still not verified against a real signed POST specifically for this
  route (the guard itself is unit-tested — see below — against synthetic signed requests, not a
  live Poster POST).
- **`PERCENT_DISCOUNT` / `FIXED_DISCOUNT`**: no path to production without a genuinely new Poster
  capability appearing. Not planned as future work in this document.

## 9. Feature flag

`POS_PROMOTION_REDEMPTION_ENABLED` (already declared in `env.schema.ts` since the original Phase 22
brief, unused until now) — default `false`, independent of `POS_REWARD_REDEMPTION_ENABLED` and
`POS_WIDGET_ENABLED`. Left `false` in the real `.env` by this pass. `POS_REWARD_REDEMPTION_ENABLED`
was not touched.

## 10. Widget

"Promolar" card lists eligible promotions (server-filtered, same as before). A "Qo'llash" button
appears per item only when `redemption.enabled` **and** the benefit type is one of the two
Poster-mutatable ones (`FREE_PRODUCT`/`LOYALTY_POINTS`) — `PERCENT_DISCOUNT`/`FIXED_DISCOUNT` never
show a button at all, so the widget never invites a click that is guaranteed to fail server-side.
Confirm → applying → done states mirror Phase 22's reward flow exactly, with the exact Uzbek copy
the brief specified. `redeemedPromotionOrderId` (widget-local) hides the button once the current
order is known to have used its one promotion — cosmetic only; the server enforces the rule
regardless of what the widget shows.

## 11. Admin

No new Admin UI. `PromotionDetailView.tsx`'s existing "Total redemptions" list already reads
`PromotionRedemption` rows directly — since Phase 23 commits real redemptions through the
**existing, unmodified** `PromotionRedemptionService.redeem()`, a POS-originated redemption appears
there automatically, with zero Admin code changes. Attempt-level (including failed/unknown) rows
are not surfaced in Admin, matching the existing precedent: Phase 22's reward attempts aren't shown
there either (`AuditPage.tsx` already states staff/POS-widget audit rows "are not exposed to the
Admin by the API yet").

## 12. Tests

`test/integration/promotion-redemption.spec.ts` (12 tests, real SQLite test DB, only
`PosterPromotionMutationService.applyToOrder` mocked) and
`test/unit/pos-widget-promotion-guard.spec.ts` (5 tests, the guard's signature/flag checks). All
pass. `test/integration/reward-redemption-one-per-order.spec.ts` re-run unchanged as a regression
check — still 9/9. A real cross-file test-isolation bug was found and fixed in
`test/db-test-helper.ts`'s shared `cleanDatabase()` in the process (two spec files sharing one
test database, each cleaning only its own tables, could leave the other's rows behind and break
`customer.deleteMany()` depending on run order).
