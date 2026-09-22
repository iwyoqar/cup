# Phase 11.1 — POS purchase import: evidence and design (NOT implemented)

Status: evidence + design (Phase 11.1); the import FOUNDATION was implemented in Phase 11.2 (see the last section).
Nothing here is wired into checkout, loyalty or reward calculation. Phase 11.1 decision was **B — additional supervised
Poster verification needed** (refund behaviour and link timing remain unverified; see "Open verification").

## Evidence (real Poster account, read-only, 2026-09-20)

Supervised POS purchase (rung by the owner at the POS, after the customer was linked in CUP):

| Field | Ordinary POS transaction 21 | CUP-created transaction 19 (from CUP order #8) |
| --- | --- | --- |
| `client_id` | 2 (= `Customer.posterClientId` of the linked CUP customer) | 2 |
| `order_source` | `0` | empty |
| `application_id` | empty | `7` |
| `auto_accept` | `true` | `false` |
| Referenced by a CUP incoming order (`incoming_order.transaction_id`) | **no** | **yes** (incoming order 8 -> 19) |
| Lines | product 3 x 9, 2700 paid (300 each) | product 1 x 5, 5000 paid |
| `spot_id` | 1 -> `Branch.posterSpotId` 1 | 1 |

* All 6 CUP incoming orders (3,4,5,6,7,8) point at transactions 4,12,13,14,15,19 via `transaction_id`; none of the other
  15 transactions is referenced. Every one of the 8 API-created transactions has `application_id = 7`; none of the 14 POS ones do.
* **Documented** by Poster: `incomingOrders.getIncomingOrder.transaction_id` ("Id связанного чека"); `dash.getTransaction`
  `status` 1 open / 2 closed / 3 deleted, `client_id` (0 = none), money in kopecks (CUP factor 1, see `poster-money.ts`).
* **NOT documented** by Poster: `order_source`, `application_id`, `auto_accept`, `processing_status`; when
  `incoming_order.transaction_id` is set relative to acceptance; how a refund/return of a closed transaction appears
  (`getTransactionHistory` does not say it exposes post-close changes).

## Deterministic chain (verified on the supervised purchase)

`Poster transaction.client_id` -> `Customer.posterClientId` -> CUP customer (unique index, explicit staff link).
`transaction.spot_id` -> `Branch.posterSpotId`. `transaction line product_id` -> `Product.posterProductId` -> `Product.categoryId`.
The active `RewardProgram` (`qualifyingCategoryId`, `buyQuantity`) decides whether the line qualifies — nothing hardcoded.
Idempotency key: `transaction_id` (Poster's own unique id).

## Proposed model (additive; do NOT reuse `Order`)

`Order` means "an order CUP placed" and carries idempotency/checkout/notification semantics a POS sale must not inherit.

* `PosterTransaction { id, posterTransactionId @unique, posterSpotId, branchId?, customerId?, posterClientId?, status
  (IMPORTED | SKIPPED_NO_CLIENT | SKIPPED_UNMATCHED_CLIENT | SKIPPED_CUP_ORIGIN | SKIPPED_UNMAPPED_BRANCH | HELD_UNMAPPED_PRODUCT),
  posterStatus, totalMinor, closedAt, importedAt }`
* `PosterTransactionItem { transactionId, productId?, posterProductId, quantity, totalPriceMinor }`
* `RewardProgressRepository.sumQualifyingQuantity` adds the quantity of qualifying `PosterTransactionItem`s of
  IMPORTED transactions to the existing `OrderItem` sum (same category rule, same modulo/redeemed logic). No second engine.
* Scheduled through the existing sync infrastructure (a read-only `dash.getTransactions` window with overlap; idempotent
  upsert by `posterTransactionId`). Never called on a QR scan.

Import rule (all must hold): `status = 2` (closed) AND `client_id != 0` AND client maps to exactly one CUP customer AND
branch mapped AND every product mapped AND **not CUP-origin** (its `transaction_id` is not referenced by any CUP order's
incoming order). Anything else is recorded with its reason, never silently guessed.

Loyalty points are NOT awarded (purchase earning stays unwired by design).

## Open verification (why the decision is B)

1. **Refund / void / delete of a closed sale.** Unknown how the API shows it (status 3? a new negative receipt? edited
   sum?). Without this a refunded sale would keep its reward credit. Needs ONE supervised void of a closed test sale for the
   linked customer.
2. **Atomicity of `transaction_id` on CUP incoming orders.** If a CUP-created transaction can be visible before CUP has
   recorded its `transaction_id`, it could be mistaken for a POS sale. Mitigation available (resolve the link of every
   non-terminal CUP order via `getIncomingOrder` immediately before importing), but the timing is undocumented and has not
   been observed on a fresh CUP order.
3. `application_id`/`order_source` meaning is undocumented; use them only as a secondary consistency check, never as the key.
4. A real reward program must exist (owner-created) to observe progress changing.

---

## Phase 11.2 — implemented foundation (2026-09-20)

Implemented as designed above, with these concrete choices (module `src/modules/poster-import/`):

* Tables `poster_imported_transactions` (+ `_items`) and `poster_incoming_order_links` (additive migration
  `20260920024254_phase11_2_poster_import`). `PosterImportedTransaction` is NOT an `Order`.
* Statuses: `IMPORTED`, `UNRESOLVED` only (no refunded/voided status — Poster behaviour unverified). CUP-originated
  and unattributable receipts are reported, never persisted.
* Identity chain: `client_id -> Customer.posterClientId`, `spot_id -> Branch.posterSpotId`,
  `product_id -> Product.posterProductId`. Dedupe: unique `posterTransactionId`; CUP-originated = documented
  `incoming_order.transaction_id` (cached in `poster_incoming_order_links`, only non-null links).
* `POSTER_IMPORT_SETTLE_SECONDS` (default 600): receipts closed more recently are `TOO_RECENT` — a settling delay for the
  unverified link-timing question, not a dedupe key.
* Admin-only `POST /admin/poster/import-transactions`: preview by default; writes need `dryRun:false` AND `confirm:true`;
  window <= 31 days, limit <= 200. Admin panel page "Poster POS Import" (Preview, then Import).
* Customer 360 gets additive `activity` + `recentPosPurchases`; existing `metrics` unchanged. Nothing reads imported
  purchases for loyalty/rewards (Phase 11.3).
