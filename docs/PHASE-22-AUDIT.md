# Phase 22 audit — reward redemption on the live Poster POS order

**Status: BLOCKED.** No documented Poster mechanism is known, today, to make a product free on the
customer's *open register order* without an undocumented assumption. Nothing in this document
changes application behaviour. No schema, endpoint, widget, or production business logic was
touched by this audit or by the experiment preparation that follows it.

Written 2026-09-22, after the Phase 21 real-POS verification (widget loads, customer detection
works, signed GET requests are confirmed against the real register).

---

## 1. What Phase 22 is trying to do

Let a barista apply a customer's already-earned 5+1 reward (one free qualifying coffee) to the
order that is open on the register right now, from the CUP widget — the first time CUP would ever
change a **live** Poster order rather than only reading one.

This is the first Phase where CUP's read-only posture (Phases 20–21) would end for one specific
action. Every hard rule in the user's brief exists because of that: no undocumented mutation, no
consuming the reward before Poster confirms, no silent retries, `UNKNOWN` is a real terminal state,
feature flag OFF by default, no real mutation without the owner's explicit go-ahead immediately
before it.

## 2. Current reward architecture (unchanged by this task)

- **`RewardProgram`** (`prisma/schema.prisma`): `buyQuantity` / `rewardQuantity`, one qualifying
  `Category`, `isActive`, a validity window. Today: the real "5+1 Coffee" program.
- **`RewardRedemption`**: `rewardProgramId`, `customerId`, `orderId` (nullable — see §5),
  `redemptionIndex`, `rewardProductId`/`Name`, `rewardQuantity`, `buyQuantitySnapshot`,
  `qualifyingCategoryName`, `redeemedAt`. Uniqueness is
  `[rewardProgramId, customerId, redemptionIndex]` — the index, not a boolean, is what makes a
  concurrent double-redeem impossible (see §4).
- **`RewardEligibilityService.checkEligibility(program, customerId, productId)`** — the single
  source of truth for "can this customer redeem this product as their free reward right now". It
  independently re-validates the product's category and active status; a caller's claim that a
  product is eligible is never trusted. **Phase 22 must reuse this, never re-implement it.**
- **`RewardRedemptionService`** — see §4 for its two-entry-point design, which Phase 22's
  redemption flow must follow for the *Poster* mutation exactly as it already does for the
  existing CUP checkout mutation.
- **`RewardProgressRepository`** — counts qualifying purchases (CUP orders + imported POS
  purchases, Phase 11.3) to derive how many rewards are earned. Unaffected by Phase 22 either way.

## 3. Current `PosterService` capabilities (server-side, `src/modules/poster/poster.service.ts`)

Every method is **read or create-new-incoming-order**; none of them touches an existing register
order:

| Method | Poster API | Kind |
| --- | --- | --- |
| `getCategories` / `getProducts` | `menu.*` | read |
| `getClientsByPhone` | `clients.getClients` | read |
| `getClosedTransactions` / `getTransactionById` / `getDeletedTransactions` | `dash.*` | read |
| `getIncomingOrderTransactionLink` | `incomingOrders.getIncomingOrder` | read |
| `getSpots` | `access.getSpots` | read |
| `createOrder` | `incomingOrders.createIncomingOrder` | **creates a new** incoming order (never the register's open order) |
| `getOrderStatus` | `incomingOrders.getOwnIncomingOrders` | read |

`PosterService.execute()` already classifies every response into `PosterDefiniteError` (Poster
processed and rejected — HTTP-200 error envelopes included, verified live 2026-09-17) or
`PosterAmbiguousError` (network/timeout/malformed — outcome unknown). **Phase 22's mutation call,
whichever it turns out to be, must be classified the same way; this is not something to
re-invent.**

`PosWidgetModule` (Phase 21) imports **no** Poster-facing module and injects no `PosterService` —
by design, so the read-only widget backend cannot reach Poster at all. Any experiment or future
implementation that needs server-side Poster REST calls is new wiring, not something already
sitting behind a flag.

## 4. The `RewardRedemptionService` limitation for Phase 22

Today's write path (`createRedemptionRecord`) is built around **one** external mutation: CUP's own
checkout, sending a new incoming order to Poster. Its safety rests on:

1. **No standalone "redeem" endpoint.** The only entry points are the read
   (`resolveForCheckout`, before the mutation) and the write (`createRedemptionRecord`, after the
   mutation is *confirmed*, in the same DB transaction as recording that success).
2. **Nothing is written unless Poster confirmed.** A `PosterDefiniteError` or
   `PosterAmbiguousError` from the mutation means `createRedemptionRecord` is never called — the
   reward stays available.
3. **The unique index is the real concurrency guard**, not merely a convenience: a live 5-way
   concurrent-call test (documented in the code) showed the index alone lets concurrent callers
   walk past the true limit unless the count is re-derived *inside* the same transaction — which
   the current code does.

Phase 22 reuses this shape, but **against a different mutation** (a live register order instead of
a new incoming order), with **different information available**: today's flow runs entirely on the
server, with the server's own knowledge of the order it is creating. Phase 22's flow would run
through **the widget**, which is the only party that can see the register's *current* order
(`orders.getActive()`). See §8.

`RewardRedemption.orderId` is nullable and points at a *CUP* `Order` today. A POS-originated
redemption has no CUP order — this is a real, if small, schema question for whenever
implementation starts (not decided here; no migration exists or is proposed).

## 5. Current Phase 21 integration (what already exists to build on)

- **Auth:** `pos-widget-signature.ts` implements Poster's documented formula for
  `Poster.makeRequest`: `md5(fullRequestUrl + jsonBody + X-Poster-Time + applicationSecret)`, body
  excluded for GET. Verified **live** for GET (`/pos-widget/ping`, `/pos-widget/overview`): the
  real register's signed GETs matched this formula exactly (§7 asks the POST question again,
  because it is the one Phase 22 actually needs).
- **Context:** the guard extracts a verified `account` / `spotId` / `tabletId` from the signed
  headers — this is genuinely trustworthy, because it comes from the signature, not from the
  request body.
- **What the widget already reads:** `orders.getActive()` (id, `clientId`, `products`, `total`),
  the active employee (`users.getActiveUser()`, informational only).
- **What the widget cannot do, by construction:** `PosterApi` in `pos-widget/src/poster.ts` does
  not declare `orders.addProduct`, `changeProductCount`, `setOrderBonus`, `setOrderClient`,
  `setOrderComment`, `create`, `closeOrder`, or `clients.create` — calling any of them does not
  compile. **This audit does not change that file.** The experiment tooling prepared below is
  deliberately kept *outside* the shipped widget so that guarantee keeps holding for every real
  user of Phase 21 while the experiments are run.

## 6. Verified vs. unverified Poster capabilities relevant to Phase 22

| Capability | Status | Evidence |
| --- | --- | --- |
| POS `orders.getActive()`, customer detection, signed GET | VERIFIED | Real POS, 2026-09-22 (Phase 21 report) |
| HTTP-200 Poster error envelope | VERIFIED | Real REST call, 2026-09-17 (bad token) |
| POS `orders.addProduct` adds at catalog price, no price/discount arg | VERIFIED (docs) / NOT VERIFIED (real order) | `en/pos/orders/orders-addProduct.md`; never called against a real order |
| POS `orders.setOrderBonus(orderId, sum)` = amount paid by points via an external system, sets `payedBonus` + `loyaltyAppId` | VERIFIED (docs) / NOT VERIFIED (semantics, unit, real order) | `en/pos/orders/orders-setOrderBonus.md`; Poster's own `examples/loyalty` uses it inside `beforeOrderClose` only |
| A documented way to set a *product's* price/discount from the POS API | NOT FOUND | `Order.discount` / `products[].price` / `promotionPrice` are documented **read** fields; no POS setter exists for any of them |
| REST `transactions.addTransactionProduct` accepts `price` (kopecks) | VERIFIED (docs) | `en/web/transactions/addTransactionProduct.md` |
| `dash.getTransaction` documents a `status` filter, `0`/`1`/`2`/`3` = all/open/closed/removed | VERIFIED (docs) — **not previously noticed in the first audit pass** | `en/web/dash/getTransaction.md` §"GET parameters"; its response even documents `date_close: 0 — if the order is still open`, i.e. an open order is a normal, expected response shape, not an edge case |
| REST mutation reaching an *open register* order (vs. a REST-created one) | INFERRED, still not directly verified | `transactions.createTransaction`, `.addTransactionProduct`, `.closeTransaction` all key off the identical `{spot_id, spot_tablet_id, transaction_id}` triple — one coherent order-addressing scheme, not a separate REST-only universe. `createTransaction`'s response returns `transaction_tablet_id` described as "the ID of the order created **on the register**, corresponds to the order opening time" — the same *ms-timestamp* shape as the POS JS API's `order.id` (`orders.getActive()`/`orders.addProduct()` examples use `1503219480866`). This is suggestive that REST and the physical register share one order model, but no test has confirmed a REST write becomes visible on an actual cashier's screen in real time. |
| `transaction_id` reliably identifies the open register order from the server side | PARTIALLY REVISED | `orderName` (POS JS API) is still documented as "can be empty until synchronized"; **but** `dash.getTransaction status=1` is a *different, documented* discovery path that does not depend on `orderName` at all — it lists open transactions by Poster's own REST `transaction_id` directly. The open question is now latency (how soon after a register opens an order does it appear over `status=1`), not existence of the mechanism. |
| REST token scope includes `transactions.*` write methods | UNKNOWN | POS-platform permissions and REST `access` scopes are two separate, undocumented lists (Phase 20/21 finding, unchanged) — still requires a live call to learn |
| `dash.getTransaction status=1` (open) sync delay from the register | NOT VERIFIED (mechanism now confirmed documented; only the timing is untested) | Experiment 3 script (`scripts/phase22-experiments/exp3-open-order-visibility.mjs`) is built exactly for this; a `snapshot` baseline was taken 2026-09-22 (17 transactions today); `watch` has not run — needs one open test order |
| POST body inclusion in `Poster.makeRequest`'s signature | VERIFIED (docs, with a matching published reference implementation) / NOT VERIFIED (a real POST) | `en/pos/requests/makeRequest.md` publishes `checkSign(url, headers, body, secret) = md5(url + (body ? JSON.stringify(body) : '') + time + secret)` in both JS and PHP — this is *exactly* `expectedSignature()`'s formula, character for character, not just "the same general idea." Residual risk is narrow: real key ordering/whitespace in Poster's own `JSON.stringify` equivalent, still unexercised. |

## 7. POS ↔ backend signature — the open question restated precisely

Confirmed by reading the code and Poster's docs (`en/pos/requests/makeRequest.md`), not by new
testing in this task:

- **What is signed:** `fullRequestUrl + JSON(body) + X-Poster-Time + secret`, MD5. For a GET, the
  body is excluded — this is what `expectedSignature()` implements, and it is what the real POS's
  GETs matched.
- **`X-Poster-Time`:** Unix seconds; the real register's clock was observed ~3 s ahead of the
  backend, comfortably inside the default 300 s window.
- **The genuinely open question:** whether a **POST** from `Poster.makeRequest` includes
  `JSON.stringify(body)` in the signed string exactly as `expectedSignature()` assumes, or omits
  it, or serializes it differently (key order, whitespace). Nothing observed so far exercises this
  — every Phase 21 traffic to date has been GET. `expectedSignature()` already implements the
  *documented* formula for a POST body; it has just never been checked against a real signed POST.
- **The guard is not weakened by this audit.** If Phase 22 is ever implemented, this must be
  verified with a real signed POST **before** trusting it as the redemption request's identity —
  exactly the kind of experiment this task prepares tooling for, without running it, because it
  requires a widget change (a POST call) that does not exist yet and is explicitly out of scope
  here.

## 8. Can the backend trust "this is the order on the register right now"?

Not fully, and not from the widget's claim alone:

- **Trustworthy today:** `account`, `spotId`, `tabletId` — verified by the signature (§5).
- **Not independently trustworthy today:** `orderId`, `clientId`, product/total — these come from
  `orders.getActive()` inside the *widget*, and the widget is not a security boundary; a signed
  request only proves it came through Poster's proxy from *some* register call, not that the
  `orderId` it carries is the one truly open right now.
- **The only independent check available is a server-side REST read** (`dash.getTransaction`) of
  the same order, which is exactly Experiment 3 below. Its sync delay is what decides whether that
  check is even usable at the point a barista wants to redeem a reward (a multi-minute delay would
  make it useless for this purpose).
- **Employee id** (`users.getActiveUser()`) is explicitly **not** a security identity per the
  brief; at most it is audit metadata, the same way Phase 21 already uses it only for display.

## 9. Three candidate approaches

| # | Approach | What it would do | Known gaps |
| --- | --- | --- | --- |
| A | **POS-native mutation**: `orders.addProduct` (add the reward item) + `orders.setOrderBonus` (write off its price) | Two calls from the widget, no server-side Poster access needed | `setOrderBonus` is documented as a *points payment*, not a discount; overwrites any existing `payedBonus`; unit and real-order behaviour unverified; Poster's own example only calls it inside the blocking `beforeOrderClose`, which Phase 21 was explicitly built to never subscribe to |
| B | **REST open-order mutation**: `transactions.addTransactionProduct` with `price: 0`, from the backend, using `transaction_id` resolved via §8's REST read | Server-authoritative, avoids trusting the widget's order id | Whether it reaches an open register order at all is undocumented; `transaction_id` resolution depends on sync delay; REST token's write-scope for `transactions.*` is unknown |
| C | **No live mutation.** Configure a Poster-native promotion server-side (loyalty/points based, if Poster's promotion engine supports it) and let CUP record the redemption only after the Phase 20 import shows the free line, on the existing read-only Phase 19/20 path | Reuses proven, already-verified infrastructure end to end; zero new mutation risk | Redemption is not real-time (waits for the settle delay, ~10 min by default); needs Poster-side promotion configuration outside CUP; still needs to be confirmed Poster's promotion engine can express "free" rather than only "% or fixed discount" |

No option is selected. The recommendation in §13 is provisional and explicitly conditioned on the
experiment results.

## 10. Risks

- **Real money.** A's `setOrderBonus` and B's `price: 0` both touch what a customer is charged;
  any wrong assumption is a live accounting error, not a CUP-only bug.
- **Silent double free coffee.** Without post-mutation verification (a Phase 22 requirement not
  yet built), a Poster response that looks successful but is not what was asked for (wrong line,
  wrong amount) could be recorded as `REDEEMED` incorrectly.
- **`UNKNOWN` needs a real reconciliation path**, not just a status label — none exists yet, for
  either CUP's own checkout (§4 already accepts a narrow window there) or a POS-order mutation.
- **REST scope risk (B):** if the token's scope allows `transactions.*` writes more broadly than
  intended, that widens the blast radius of any bug well beyond the reward feature.
- **`beforeOrderClose` is the only documented moment example code writes off a bonus (A)** — and
  it is the blocking event class Phase 21 rules out entirely. Using it would need its own explicit
  design and approval; it is not assumed available here.

## 11. Blocking questions (must be answered by experiment, not assumption)

1. Does `orders.addProduct` on a *real open order* behave exactly as documented (catalog price, no
   discount hook)? (Experiment 1)
2. What does `orders.setOrderBonus` actually do to a real order's `total`, `payedBonus`,
   `loyaltyAppId`, and the POS's own displayed accounting — and is it reversible? (Experiment 2)
3. How long after a register order is opened does it become visible via
   `dash.getTransaction status=1`, and does `transaction_id` map to it reliably? (Experiment 3)
4. Can `transactions.addTransactionProduct` reach that same open order at all, does `price: 0` do
   anything sane, and does the REST token even have that scope? (Experiment 4 — gated further)
5. Is a real Poster POST's signature computed the way `expectedSignature()` assumes? (§7 — not run
   in this task; needs a widget change first)

## 12. Experiment plan (see §13 for what is prepared vs. executed)

All experiments use **one** unpaid test order, created manually by the owner in the real POS, and
never closed, paid, or sent to payment during any experiment. Every mutating call requires the
owner's explicit go-ahead in chat immediately before it runs, in addition to an in-script
confirmation prompt.

| # | Name | Mutates? | Needs |
| --- | --- | --- | --- |
| 1 | POS `addProduct` on the open order | Yes | one unpaid test order + a named test product |
| 2 | POS `setOrderBonus` on the same order | Yes | the state Experiment 1 left behind |
| 3 | REST open-order visibility (`dash.getTransaction`) | No (read-only) | the same open order's existence; a bounded, slow poll |
| 4 | REST `addTransactionProduct` price 0 | Yes | Experiment 3's answer first; separately gated |

---

*Continued in §13 below with exactly what was prepared and what was (not) executed in this pass.*

## 13. This task's outcome

- **No application code changed.** Backend, widget, schema, Phase 20, Phase 21 — untouched.
- **No mutation executed.** Every experiment that touches a real order is prepared but not run.
- Tooling for all four experiments is under `scripts/phase22-experiments/`, kept outside
  `src/` and `pos-widget/src/` on purpose, so it can never ship and never weakens the compiled
  guarantee described in §5. See that directory's `README.md` for exact run instructions and
  safety gates.
- A plumbing dry run of the Experiment 3 script (read-only, against an **already-closed** receipt
  CUP has seen before) is reported in the final chat report as evidence the script and
  authentication work — that is not Experiment 3 itself, which needs the owner's open test order.

## 14. Continued documentation research, 2026-09-22 — a promising lead, still not a live answer

Reading the full Poster docs mirror (`transactions.*` REST family, previously only skimmed for
`addTransactionProduct`) found new supporting evidence for **Approach B** (§9), summarized in the
revised §6 table above. In short:

- `dash.getTransaction`'s documented `status` filter (`0`/`1`/`2`/`3` = all/open/closed/removed) was
  not previously flagged — it means "list currently-open register orders over REST" is a
  **documented, first-class capability**, not something inferred or hacked around. This directly
  targets Experiment 3's question.
- `transactions.createTransaction`, `.addTransactionProduct`, and `.closeTransaction` all address an
  order the same way (`spot_id` + `spot_tablet_id` + `transaction_id`), and `createTransaction`'s
  response field `transaction_tablet_id` — "the ID of the order created on the register, corresponds
  to the order opening time" — has the same millisecond-timestamp shape as the POS JS API's own
  `order.id`. This is **suggestive, not proof**, that REST and the physical register share one order
  model rather than being two unrelated systems that happen to use similar names.
- `en/pos/requests/makeRequest.md` publishes a reference `checkSign()` implementation (JS and PHP)
  that is character-for-character `expectedSignature()`'s formula. This meaningfully raises
  confidence in §7's POST-signature question, short of an actual signed POST from a real register.

**What this does NOT do:** answer the one question that decides everything — does a REST-side
mutation, or even a REST-side *read*, actually see (or affect) the order a cashier has open on their
physical register screen right now, and how fast? No amount of documentation reading settles this;
Poster's docs make no claim either way. `scripts/phase22-experiments/exp3-open-order-visibility.mjs`
was built exactly to answer it empirically, and remains the next concrete step: a `snapshot` baseline
was taken 2026-09-22 (17 transactions in today's window); `watch` needs the owner to open ONE
disposable unpaid order on the real register, same as always. Nothing in this section authorizes or
performs a real-order mutation — Experiment 4 (`transactions.addTransactionProduct`, price 0) stays
gated behind Experiment 3's result and the owner's explicit approval, exactly as before.

## 15. STATUS CHANGE — Experiments 3 and 4 executed live, 2026-09-22. Approach B is now VERIFIED SAFE.

With the owner's explicit per-call approval, both experiments were run against ONE disposable unpaid
test order the owner opened on the real register (spot 1). **The order was never closed or paid; only
the one approved line item was added to it.**

**Experiment 3 (read-only) result:** the owner opened an order; it became visible over REST
(`dash.getTransactions status=0`, filtered for `status: "1"` open) on the **very first poll**, well
under 20 seconds — effectively immediate, not a multi-minute sync delay. `transaction_id=46`,
`spot_id=1`, `spot_tablet_id=1` (from its `history[0]`, `type_history:"open"`), `date_start` a
millisecond timestamp (`1790057457826`) — the **same value and shape** as the POS JS API's
`orders.getActive().order.id`/`dateStart`. This is the cross-reference key: the backend can resolve a
widget-reported `posterOrderId` (ms-timestamp) to a REST `transaction_id` (small sequential number) by
searching open transactions for the matching `date_start`, entirely server-side, never trusting the
widget for the mapping itself.

**Experiment 4 (mutating, owner-approved for this specific call) result:** `transactions.addTransactionProduct`
with `{spot_id: 1, spot_tablet_id: 1, transaction_id: 46, product_id: 35, price: 0}` returned
`{"transaction_product": 67}` (success). A REST read-back immediately after showed the product in
`products[]` at `product_price: "0"`, the order's own `sum` still `"0"` (not the catalog price), and a
new `history` entry (`type_history: "additem"`, `value_text: {price: 0, ...}`) — a real, auditable,
zero-priced line, not a cosmetic artifact. **The owner confirmed on the physical register screen**:
the line appeared live (no manual refresh needed) and displayed price 0/free, matching the REST read
exactly.

**This resolves the audit's central blocking question.** Approach B (§9) is promoted from "no option
selected" to the recommended mechanism:

1. Backend independently resolves `posterOrderId` (ms-timestamp, from the widget) → REST
   `transaction_id` by querying `dash.getTransactions status=1` for the verified `spot_id` (from the
   signature, never the widget) and matching `date_start`. A miss (no open transaction with that
   `date_start`) is a hard failure — the order the widget claims is current cannot be confirmed
   server-side, so the redemption is refused, never guessed.
2. `spot_id` / `spot_tablet_id` for the mutation come from the **signed request context**
   (`ctx.spotId` / `ctx.tabletId`), never from the transaction lookup or the widget body — consistent
   with the existing Phase 22 rule that only the signature is a trust boundary.
3. Mutate: `transactions.addTransactionProduct({spot_id, spot_tablet_id, transaction_id, product_id: <reward's posterProductId>, price: 0})`.
4. Verify: re-read the same transaction via REST; confirm the product line exists at `price 0`
   and that no other line/field changed unexpectedly. Only then is the redemption considered
   confirmed.
5. A `PosterDefiniteError` from the call → FAILED. Anything ambiguous (timeout, malformed,
   can't re-verify) → UNKNOWN, never retried, never marked redeemed.

**Still open / not yet tested:** removing/reversing a mistaken line (`transactions.removeTransactionProduct`
exists, undocumented behavior against a still-open order); behavior under concurrent modification of
the same order by the cashier while the mutation is in flight; whether the REST token's scope could
be revoked/rotated independently of the POS-platform application (an operational risk, not a
correctness one); tax/fiscal interaction of a zero-priced line at the moment the order is eventually
closed by the cashier (not tested — the test order was never closed, per the safety rules).
