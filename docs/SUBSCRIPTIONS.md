# Coffee Subscription

A prepaid coffee plan. The customer pays once and gets N portions over D calendar days (UTC+5), limited per day and by a cooldown. At the counter, staff redeem a portion from the POS widget: a price-0 line is added to the open Poster order. The feature reuses the existing CUP identity, the 5+1 customer QR/code, the Poster reward mutation path, the importer, and finance. It does not add a second one of any of these.

## Data model (prisma/schema.prisma)

| Model | Purpose |
|---|---|
| `SubscriptionPlan` | Configurable terms: `priceMinor`, `durationDays`, `totalPortions`, `dailyPortionLimit`, `cooldownMinutes`, `isActive`. On first boot, if the table is empty, two plans are seeded: "15 Coffee" and "30 Coffee". |
| `SubscriptionProduct` | An explicit list of drinks allowed for redemption (`productId` unique, `portionCost` 1 = standard, 2 = double). Products are never matched by name. Hot and iced drinks are separate rows. Nothing is seeded. |
| `Subscription` | One period per customer. Holds a snapshot of the plan terms taken at purchase, `startsAt/endsAt` and business dates. Status is one of `PENDING_PAYMENT`, `ACTIVE`, `PAUSED`, `EXPIRED`, `CANCELLED`. `usageVersion` is the row used as a lock. |
| `SubscriptionPurchase` | A payment record for one subscription. Fields include `kind` NEW/RENEWAL, `status`, `amountMinor`, `provider`/`providerPaymentId` (unique together), `activationSource` PAYMENT or ADMIN_MANUAL, and `idempotencyKey` (unique). |
| `SubscriptionRedemption` | One row per redemption attempt. `attemptId` is unique. `(subscriptionId, claimSequence)` is unique. `redeemedForPosterOrderId` is unique, so a Poster order can have at most one subscription drink. The row also stores Poster ids and reconciliation state. |
| `Customer.subscriptionLockVersion` | The lock used during activation, so that two activations for one customer cannot overlap. |

All money is stored as Int whole UZS. Statuses are plain strings. There are no enums and no Decimal columns, which keeps the schema the same on SQLite and Postgres.

Migrations:
- `prisma/migrations/20260927090000_coffee_subscriptions` (SQLite). It uses Prisma's standard redefine of the customers table, which copies all rows.
- `prisma/postgres/migrations/0006_coffee_subscriptions` (Postgres). It is additive only: one `ADD COLUMN ... DEFAULT 0` plus new tables.

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

- A receipt line is treated as a subscription line only when all of these hold: a redemption's `posterTransactionId` matches the receipt, the product matches, and the line is zero-priced.
  - Such lines are removed from the imported sale items.
  - A receipt made only of subscription lines is skipped as `SUBSCRIPTION_REDEMPTION`. It is not recorded as a sale and not as unpaid.
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

## Flags

| Env | Default | Effect |
|---|---|---|
| `POS_SUBSCRIPTION_REDEMPTION_ENABLED` | false | Turns on the POS widget redeem endpoint. It also needs `POS_WIDGET_ENABLED`. |
| `SUBSCRIPTIONS_MANUAL_ACTIVATION_ENABLED` | false | Allows an admin to activate a purchase manually (dev/ops). |
| `SUBSCRIPTION_EXPIRY_INTERVAL_MS` | 900000 | How often expired subscriptions are written as EXPIRED in the DB (see Rules). |

## Audit

The audit reuses `staff_scan_events` through `StaffRepository.recordEvent`. Actions are prefixed `SUBSCRIPTION_`: created, activated, expired, cancelled, plan/products changed, and each redemption request, outcome and resolution.

## Limitations

- There is no payment provider.
- There is no pause UI. The PAUSED status is modelled only.
- There is no deferred-revenue accounting.
- Product mappings are global, not per plan.
- The staff panel does not show subscriptions.
