# Phase 11 — Customer identity (QR/barcode), Staff Panel, Poster customer integration

## Principle

The QR / barcode is an **identity** mechanism only. A scan never adds a coffee, point, reward or purchase; only a
verified order changes loyalty / reward progress, through the existing order + reward architecture. There is no
`scan -> credit` code path: the staff snapshot service does not even inject a loyalty/reward/order *mutation* service.

## Public customer code

* `Customer.loyaltyCode` (nullable only for an additive migration; every customer is backfilled at startup and new
  customers get one at creation). Format `CUP-` + 8 chars from `23456789ABCDEFGHJKMNPQRSTUVWXYZ` (31^8 ≈ 8.5e11),
  from `crypto.randomInt`. Independent of `Customer.id`, Telegram id and phone. Unique index = final collision guard;
  writers retry on a `loyaltyCode` collision.
* The QR payload **is** the public code. Code 128 (subset B) barcode of the same value is shown under it.
* Customer API: `GET /customers/me/identity` -> `{ publicCode, qrPayload }` (nothing else).
* Admin may regenerate a code (`POST /admin/customers/:id/loyalty-code/regenerate`, body `{confirm:true}`): the old
  code stops resolving immediately; audited. Codes cannot be edited freely.

## Staff Panel (`staff/`)

* Separate Vite app, separate token (`sessionStorage`), API namespace `/staff/*`. Mobile-first, Uzbek.
* **Auth**: `StaffMember` table (NOT `Admin` — `AdminAuthGuard` authorises any Admin row regardless of role).
  Own signing key (`STAFF_JWT_SECRET`, or derived from `ADMIN_JWT_SECRET` with a fixed label) + audience `cup-staff`, so a
  customer/admin token fails verification on staff routes and vice-versa. Accounts are created only by an admin
  (`/admin/staff`, Admin panel -> Staff). Admin-role owners (`ADMIN`/`SUPER_ADMIN`) may also sign in to the Staff Panel
  as `ADMIN`. Login is throttled per identifier (8 failures -> 10 min lock).
* **Scan**: camera (opened only when tapped; `BarcodeDetector`, else lazy jsQR), keyboard-wedge hardware scanner
  (fast keystrokes + Enter), or manual code entry. One request: `GET /staff/customers/by-code/:code`.
* **Card** (privacy-minimal): name, code, phone last 4, loyalty balance, reward progress per active program
  (`qualifyingCount / threshold`, from `RewardProgramsService.listForCustomer`), recent orders, Poster link state.
  No customer id, Telegram data, full phone, Poster client id.
* **Search fallback**: exact CUP code, exact full phone (>= 7 digits), or name (>= 3 chars); capped, minimal rows.
* **Audit** `StaffScanEvent`: actor type/id, action, result, customer/branch — no QR text, phone or token.

## Poster capability matrix (checked 2026-09-20 against official docs + read-only calls on the real account)

| Capability | Status |
| --- | --- |
| Find a Poster client by phone (`clients.getClients?phone=+…`) | VERIFIED live, read-only |
| Record the match on `Customer.posterClientId` | IMPLEMENTED (explicit staff choice, never overwrites, idempotent, audited) |
| Create / update a Poster client (`clients.createClient` / `updateClient`) | SUPPORTED BY DOCS, NOT IMPLEMENTED (Poster mutation; `createIncomingOrder` already creates by phone) |
| Set the CUP code as the Poster client's `card_number` (lets Poster's own scanner find the client) | SUPPORTED BY DOCS (`updateClient.card_number`; no uniqueness rule), NOT IMPLEMENTED — needs supervised E2E |
| POS widget SDK: `Poster.orders.setOrderClient`, `Poster.clients.find` (searches phone/name/card), `Poster.interface.scanBarcode` (Android/iOS 3.5+) | DOCUMENTED, UNVERIFIED — needs a registered Poster Platform app + a POS terminal (REQUIRES SUPERVISED POSTER E2E) |
| Select the customer on a physical POS order from CUP | NOT POSSIBLE from the REST API; only via the widget SDK above |
| Webhooks (`transaction`, `client`, `incoming_order`) | NOT AVAILABLE with the current plain API token (application-level, OAuth app); transaction payload does not list `client_id` |
| POS purchases for a client via polling (`dash.getTransactions` has `client_id`, `sum`, product lines) | VERIFIED readable; NOT imported into CUP orders (see gap) |

## Known gap (deliberate)

Reward/loyalty progress derives from CUP `OrderItem` rows only. A purchase a barista rings up directly in Poster is not
a CUP order, so it does **not** count yet. Importing them needs a dedupe key between CUP-created incoming orders and Poster
transactions; `dash.getTransactions` has no incoming-order reference, `dash.getTransaction` adds `order_source` /
`application_id` (semantics unverified). Next step: one supervised E2E POS order for a linked customer.

## Interim operational workflow

1. Barista opens the Staff Panel, scans the customer's QR. 2. Sees the card. 3. Selects the same customer in Poster by
phone (last 4 shown) or name. 4. If not yet linked, taps "Poster mijozni topish" -> chooses the match -> "Bog'lash".

## Config

`STAFF_JWT_SECRET` (optional, >= 16 chars), `STAFF_JWT_EXPIRES_IN_SECONDS` (default 43200). Staff app: copy
`staff/.env.example` to `staff/.env`, set `VITE_API_BASE_URL`; `npm run dev` (port 5175) or `npm run build`.
