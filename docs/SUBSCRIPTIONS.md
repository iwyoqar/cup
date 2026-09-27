# Coffee Subscription

A prepaid coffee plan. The customer pays once and gets N portions over D calendar days (UTC+5), limited per day and by a cooldown. At the counter, staff redeem a portion from the POS widget: a price-0 line is added to the open Poster order. The feature reuses the existing CUP identity, the 5+1 customer QR/code, the Poster reward mutation path, the importer, and finance. It does not add a second one of any of these.

## Data model (prisma/schema.prisma)

| Model | Purpose |
|---|---|
| `SubscriptionPlan` | Configurable terms: `priceMinor`, `durationDays`, `totalPortions`, `dailyPortionLimit`, `cooldownMinutes`, `isActive`. On first boot, if the table is empty, two plans are seeded: "15 Coffee" and "30 Coffee". `productId` (nullable) is the admin-selected CUP `Product` this plan sells as a real Poster order line — `Product.posterProductId`/`priceMinor` are the source of truth, never duplicated onto the plan. |
| `SubscriptionProduct` | An explicit list of drinks allowed for redemption (`productId` unique, `portionCost` 1 = standard, 2 = double). Products are never matched by name. Hot and iced drinks are separate rows. Nothing is seeded. |
| `Subscription` | One period per customer. Holds a snapshot of the plan terms taken at purchase (including `posterProductId`, if the plan was mapped at purchase time), `startsAt/endsAt` and business dates. Status is one of `PENDING_PAYMENT`, `ACTIVE`, `PAUSED`, `EXPIRED`, `CANCELLED`. `usageVersion` is the row used as a lock. |
| `SubscriptionPurchase` | A payment record for one subscription. Fields include `kind` NEW/RENEWAL, `status`, `amountMinor`, `provider`/`providerPaymentId` (unique together — `'CASH'`, `'POSTER_ORDER'`, or a future online provider), `activationSource` PAYMENT or ADMIN_MANUAL, and `idempotencyKey` (unique). For a real Poster order purchase it also carries `posterAccount`/`posterSpotId`/`posterTabletId`/`posterOrderId`/`posterTransactionId` (unique)/`posterTransactionProductId`/`reconciliationStatus`/`reconciledAt` — the same shape `SubscriptionRedemption` already uses for its own Poster linkage. |
| `SubscriptionRedemption` | One row per redemption attempt. `attemptId` is unique. `(subscriptionId, claimSequence)` is unique. `redeemedForPosterOrderId` is unique, so a Poster order can have at most one subscription drink. The row also stores Poster ids and reconciliation state. |
| `Customer.subscriptionLockVersion` | The lock used during activation, so that two activations for one customer cannot overlap. |

All money is stored as Int whole UZS. Statuses are plain strings. There are no enums and no Decimal columns, which keeps the schema the same on SQLite and Postgres.

Migrations:
- `prisma/migrations/20260927090000_coffee_subscriptions` (SQLite). It uses Prisma's standard redefine of the customers table, which copies all rows.
- `prisma/postgres/migrations/0006_coffee_subscriptions` (Postgres). It is additive only: one `ADD COLUMN ... DEFAULT 0` plus new tables.
- `prisma/migrations/20260927193803_subscription_poster_purchase` (SQLite) / `prisma/postgres/migrations/0007_subscription_poster_purchase` (Postgres): the plan-product mapping and the purchase's Poster linkage fields above. Additive only on Postgres; SQLite redefines `subscription_plans` only (adding a foreign-key column).

## Rules (src/modules/subscriptions/subscription-rules.ts, pure functions)

- **Period.** `startBusinessDate` 00:00 UTC+5 to `startBusinessDate + durationDays` 00:00. A renewal starts on the day after the latest paid period ends, so periods never overlap. There is no rollover.
- **Expiry.** Expiry is decided from the dates alone. An ACTIVE subscription whose `endsAt` has passed reads as EXPIRED everywhere. The interval job (`SUBSCRIPTION_EXPIRY_INTERVAL_MS`) only writes that status to the DB.
- **Usage.** Portions in CONFIRMED rows are consumed. Portions in REQUESTED, POSTER_MUTATING and UNKNOWN rows are held. Held portions count against the remaining balance, the daily limit and the cooldown. FAILED rows count toward nothing.
- **Eligibility is checked in this order:** status, remaining portions, daily portions, cooldown (from the last redemption, whatever its size), then the drink's portion cost against the remaining balance and against the daily allowance.

## Redemption flow (pos-widget-subscription.service.ts)

1. **Claim transaction.**
   - Lock the subscription with `UPDATE ... usageVersion+1`. Postgres takes a row lock here; SQLite serialises writers.
   - Check the mapping, the product, the order, anything already in flight, and the rules.
   - Insert the row as `POSTER_MUTATING` with the next `claimSequence`, or as `FAILED` with a reason.
2. **Poster mutation, outside any transaction.** This calls `PosterRewardMutationService.applyToOrder`: the existing, verified `transactions.addTransactionProduct` at price 0, then a re-read to verify.
   - The order's Poster client must match the customer.
   - When the customer was identified by QR/code, an order with no client is allowed.
3. **Commit.** The outcome decides the row's final status:
   - Success: `CONFIRMED`, with Poster transaction ids.
   - Rejected: `FAILED`; the portions are released.
   - Nothing was attempted: `FAILED`.
   - Ambiguous: `UNKNOWN`; the portions stay held until the importer or an admin resolves it.
4. **Replay.** Sending the same `attemptId` returns the stored result and does not mutate again.

## Import and reconciliation (poster-transaction-import.service.ts)

- A receipt line is treated as a subscription REDEMPTION line only when all of these hold: a redemption's `posterTransactionId` matches the receipt, the product matches, and the line is zero-priced.
  - Such lines are removed from the imported sale items.
  - A receipt made only of subscription lines is skipped as `SUBSCRIPTION_REDEMPTION`. It is not recorded as a sale and not as unpaid.
- A receipt line is treated as a subscription PURCHASE line when a PENDING_PAYMENT purchase's `posterTransactionId` matches the receipt, the product matches, and the price matches the plan's exact price (never price alone, and never zero — this is the one structural difference from the redemption case above).
  - Such lines are also removed from the imported sale items, and a receipt made only of a purchase line is skipped as `SUBSCRIPTION_PURCHASE` — its revenue is already counted via `SubscriptionPurchase.amountMinor`, never also as independent POS revenue.
  - A matched, paid, closed line confirms the purchase (`confirmPaid`) — the safety net for whatever the widget's own on-demand check (`checkPosterOrderPayment`) missed. Idempotent: a purchase already `PAID` by then is a no-op.
- On closed receipts:
  - A `CONFIRMED` redemption is marked `MATCHED` if its line is present, otherwise `LINE_MISSING`.
  - An `UNKNOWN` redemption becomes `CONFIRMED` if its line is present, otherwise `FAILED`, which releases its portions.

## Finance

- **Subscription sales.** Only `PAID` purchases with `activationSource = PAYMENT` count, on a cash basis at `paidAt`. They appear on their own line in P&L revenue and in cash-flow cash-in. They are left out when a branch filter is set, because a subscription sale has no branch.
- **Manual activations** are never revenue.
- **Redemptions** bring 0 revenue. Their theoretical cost appears in COGS as a separate "subscription consumption" line.

## Payments

`subscription-payments.ts` defines the `SubscriptionPaymentProvider` interface and an empty registry.
- A provider will have to create the provider payment, verify its webhook, and then call `SubscriptionsService.confirmPaid(purchaseId, { provider, providerPaymentId, amountMinor })`.
- `confirmPaid` is idempotent and checks the amount.
- Until a provider exists, customers can create a pending purchase (and cancel it). Only an ADMIN can activate one, and only when `SUBSCRIPTIONS_MANUAL_ACTIVATION_ENABLED=true`.

### Cash sale at the register (POS widget)

A cashier can sell a plan for cash directly inside the CUP Poster POS widget: `POST /pos-widget/subscriptions/purchase-cash`
(`PosWidgetSubscriptionService.purchaseCash`, gated by its own flag, `POS_SUBSCRIPTION_CASH_SALE_ENABLED`, independent of POS
redemption). CASH is **not** a `SubscriptionPaymentProvider` — it has no `startPayment` and no webhook. The cashier confirming
cash was received IS the confirmation authority: the endpoint just calls the exact same two domain methods a real provider's
webhook would call — `SubscriptionsService.createPurchase` then `confirmPaid({ source: 'PAYMENT', provider: 'CASH' })` — so
idempotency (`Idempotency-Key`), the customer lock (no overlapping periods, two cashiers can't race the same customer) and the
non-overlapping-renewal rule are all reused unchanged, not reimplemented.

The customer is resolved from the same `posterClientId` / CUP code identity every other POS widget call uses; the plan's price,
duration, portions, daily limit and cooldown always come from the DB, never from the request. `SubscriptionPurchase.provider`
holds `'CASH'` and `activationSource` is `'PAYMENT'`, so a cash sale is real subscription revenue (Finance's existing
`subscriptionSalesTotal`/`revenue()` queries needed no change — they already match on `status: 'PAID', activationSource:
'PAYMENT'` regardless of provider) and shows up in Admin's revenue "By payment method" table and on the purchase/customer
detail views (which already rendered `provider` — it was simply always null before).

This makes **no Poster mutation of any kind**: selling a subscription for cash is a CUP financial event only. The later coffee
redemption (an existing, separate `transactions.addTransactionProduct` price-0 mutation, see Redemption flow above) is the
Poster operational event; the two never share a code path, an attempt table or a flag, so cash-sale revenue can never
double-count with a coffee sale.

The "cashier" recorded (audit action `SUBSCRIPTION_CASH_PAYMENT_CONFIRMED`, and `SubscriptionPurchase.activatedBy`) is whatever
Poster's own `users.getActiveUser()` gave the widget — a free identifier, not a CUP Staff Panel account (this widget has never
resolved one) — falling back to a `poster:<account>:<spot>:<tablet>` device reference when Poster reports no active user.

Limitations: no fiscal receipt behavior is implemented (out of scope — CUP makes no Poster call for the sale itself, so there is
nothing to fiscalize through Poster here); no refund path (matches the project-wide no-refund policy); online payment
(Click/Payme/Uzcard/Humo/Visa/Mastercard) remains unimplemented — the Mini App still only offers a pending purchase waiting on
a future provider, unaffected by this cash path.

### Real Poster order purchase at the register (POS widget)

A cashier can instead sell a plan as a REAL line item on the customer's currently open Poster order, so the customer pays
through Poster itself (cash, card, Uzcard, Humo, ... — whatever that register already supports) — `POST
/pos-widget/subscriptions/purchase-poster-order`, gated by its own flag, `POS_SUBSCRIPTION_POSTER_PURCHASE_ENABLED`, independent
of both other subscription flags. Requires the plan to have an active Poster product mapping (Admin → Subscriptions → Plans);
the customer is resolved the same way every other POS widget call does (`posterClientId` or CUP code).

**Mechanism (`poster-order-mutation.service.ts`, `PosWidgetSubscriptionService#purchasePosterOrder`):** reuses Phase 22's exact,
live-verified order-resolution pattern (`dash.getTransactions status=1` + `date_start` match, using the signature-verified
`spot_id`, never the widget's claim) and `transactions.addTransactionProduct` — but at the plan's REAL price instead of 0. The
mutate-then-verify discipline is identical, with one changed invariant: the order's total must move by EXACTLY the plan's
price (not stay unchanged, as the price-0 reward/redemption case requires). **This is genuinely untested territory**: no
non-zero-price `addTransactionProduct` call, and no order carrying an API-added line, has ever been observed actually
closing/getting paid in this project (see `docs/PHASE-22-AUDIT.md` §15's own closing paragraph) — ships OFF, needs a
supervised live test on a disposable low-value real order before production use.

**No synchronous "is this paid" check exists** (`dash.getTransaction`'s `status`/`pay_type` are readable on demand, but nothing
before this feature interpreted them into a paid/closed decision outside the batch importer, and the webhook path is documented
as unreliable at Poster's dashboard level in this account — see `docs/CUP-COMPLETE-AUDIT.md` §11). This feature therefore uses
**two tiers**, exactly mirroring how an `UNKNOWN` redemption is resolved:
1. **On-demand fast path** (`POST .../purchases/:id/check-payment`, `PosWidgetSubscriptionService#checkPosterOrderPayment`): the
   widget calls this right after the customer pays (and auto-polls a few times); if the stored `posterTransactionId` reads back
   `status: '2'` (closed) and `pay_type !== '0'` (paid), it calls the same `SubscriptionsService.confirmPaid` the cash path uses,
   with `provider: 'POSTER_ORDER'`.
2. **Reconciliation safety net** (`poster-transaction-import.service.ts`): the importer's existing subscription-redemption
   recognition block now has a sibling for PENDING_PAYMENT purchases — it matches a closed receipt's line by
   `posterProductId` + the plan's exact price (never price alone), and if paid, confirms it the same way. This also **strips
   that one line out of the receipt before the ordinary POS-sale import runs** (a receipt that is nothing but a subscription
   purchase is skipped entirely, category `SUBSCRIPTION_PURCHASE`) — the same 450,000 so'm is never counted twice, exactly the
   safeguard the existing subscription-redemption lines already have for consumption.

**Poster product mapping (`SubscriptionPlan.productId` → `Product`):** the admin selects an EXISTING synced CUP product (never
a live Poster call, never a Poster product/category created by CUP). The admin form blocks saving a mismatch between the
plan's `priceMinor` and the mapped `Product.priceMinor` — the subscription price is authoritative; a mismatch must be resolved
by the admin, never silently overwritten either way.

Limitations: not live-verified (see above); no fiscal receipt behavior (same reasoning as cash sale, deepened by the
non-zero-price gap); no refund path; a receipt with the subscription's mapped product at its exact price sold as an ORDINARY
coffee in the same window as a genuine ambiguous edge case (matched by product+price, not a dedicated line marker, since
Poster's line shape has no room for one) is a known, accepted rarity, mirroring the same caveat the price-0 redemption lines
already carry.

## Flags

| Env | Default | Effect |
|---|---|---|
| `POS_SUBSCRIPTION_REDEMPTION_ENABLED` | false | Turns on the POS widget redeem endpoint. It also needs `POS_WIDGET_ENABLED`. |
| `POS_SUBSCRIPTION_CASH_SALE_ENABLED` | false | Turns on the POS widget cash-sale endpoint (`purchase-cash`). Independent of the redemption flag; also needs `POS_WIDGET_ENABLED`. |
| `POS_SUBSCRIPTION_POSTER_PURCHASE_ENABLED` | false | Turns on the POS widget real-Poster-order-purchase endpoints (`purchase-poster-order` + `.../check-payment`). Independent of the other two flags; never live-verified at a non-zero price — needs a supervised test first. |
| `SUBSCRIPTIONS_MANUAL_ACTIVATION_ENABLED` | false | Allows an admin to activate a purchase manually (dev/ops). |
| `SUBSCRIPTION_EXPIRY_INTERVAL_MS` | 900000 | How often expired subscriptions are written as EXPIRED in the DB (see Rules). |

## Audit

The audit reuses `staff_scan_events` through `StaffRepository.recordEvent`. Actions are prefixed `SUBSCRIPTION_`: created, activated, expired, cancelled, plan/products changed, each redemption request/outcome/resolution, the cash sale confirmation, and the Poster-order purchase's line-add / rejection / payment confirmation.

## Limitations

- There is no ONLINE payment provider (Click/Payme/Uzcard/Humo/Visa/Mastercard) — cash and a real Poster order are the two payment paths that exist today.
- There is no pause UI. The PAUSED status is modelled only.
- There is no deferred-revenue accounting.
- Redemption product mappings (`SubscriptionProduct`) are global, not per plan; the Poster-order purchase's product mapping (`SubscriptionPlan.productId`) IS per plan.
- The staff panel does not show subscriptions.
- The real-Poster-order purchase mechanism has never been live-verified (see its own section above) — a supervised test is required before enabling it in production.
