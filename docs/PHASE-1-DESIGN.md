# CUP — Phase 1 Design: Telegram Bot + Mini App

**Status: design only. Nothing in this document has been implemented. No packages installed, no source files modified, bot token not used.**

Legend used throughout: **VERIFIED** (confirmed — live test in this project, or stable public documentation), **UNVERIFIED** (a reasonable assumption, not yet tested against our own account/bot), **TO BE VERIFIED** (must be checked before or during implementation, specific action noted).

---

## 1. Goal

Ship the first customer-facing CUP experience: a Telegram Bot that links a real customer identity and hands off to a Telegram Mini App, which lets that customer browse the Poster-sourced catalog, build a cart, and check out — reusing Phase 0's order-creation and idempotency machinery unchanged. Poster remains the operational source of truth; CUP adds the customer/order experience layer; Telegram is distribution only.

## 2. Scope

- Telegram Bot: `/start`, registration/linking, phone collection, "Open Mini App" entry point, order status notifications.
- Telegram Mini App: Home, branch selection, categories, product list, product detail, cart, checkout, confirmation, order status.
- Customer identity: Telegram user → CUP `Customer`, phone captured via Telegram's native contact-share, Poster `client_id` reused/backfilled from Phase 0's existing field.
- Backend: auth (Mini App initData verification), cart, checkout (thin wrapper over existing `OrdersService`), branch listing.
- Minimum schema additions on top of Phase 0 (not a redesign).
- Security: initData HMAC verification, session tokens, CORS, bot token hygiene identical in spirit to `POSTER_API_TOKEN`'s.

## 3. Out of scope (explicit)

Loyalty/CUP Points, 5+1 campaign, referrals, advanced CRM, LTV, analytics dashboard, marketing automation, Docker/PostgreSQL/Redis (unless a concrete Phase 1 need forces it — see §12), multi-language i18n, payment collection (still pay-at-counter/pickup per Phase 0 assumptions), admin/back-office UI, per-branch pricing (see §19).

## 4. Architecture

```
Telegram client
   │  (Bot API: messages, contact share)        (Mini App: initData, fetch calls)
   ▼                                               ▼
Telegram Bot (grammY, polling in dev)      Telegram Mini App (Vite+React+TS)
   │                                               │
   └──────────────► CUP Backend (NestJS) ◄─────────┘
                        │
              ┌─────────┼──────────┐
              ▼         ▼          ▼
          AuthModule  CartModule  OrdersModule (Phase 0, reused unchanged)
              │         │              │
              └─────────┴──────┬───────┘
                                ▼
                          PosterService (Phase 0, reused, only addition: getSpots())
                                │
                                ▼
                          Real Poster API
```

Hard rule carried from the architecture principle: **the Mini App never calls Poster directly** — every Poster interaction goes through the CUP backend, which goes through `PosterService`. The Bot never bypasses `OrdersService`'s idempotency machinery.

## 5. Components

| Component | New/Reused | Notes |
|---|---|---|
| `PosterService` | Reused, +1 method | Add `getSpots()` only. No other Poster logic changes. |
| `OrdersService`, `CatalogService`, `CustomersRepository` | Reused unchanged | Checkout calls `OrdersService.createOrder()` exactly as Phase 0 does. |
| `AuthModule` (new) | New | Telegram initData verification, session issuance. |
| `TelegramModule` (new) | New | Bot (grammY), webhook/polling handler, outbound notifications. |
| `CartModule` (new) | New | Cart/CartItem CRUD, checkout orchestration. |
| `BranchModule` (new) | New | `Branch` sync from `access.getSpots` + listing endpoint. |
| Mini App (new, separate app) | New | `apps/miniapp` — Vite + React + TS. |

## 6. Database changes (minimum additive set)

No existing Phase 0 table is redesigned. Everything below is additive; `Order` gets one new nullable-then-backfilled column.

```prisma
model TelegramAccount {
  id             String   @id @default(cuid())
  customerId     String   @unique
  customer       Customer @relation(fields: [customerId], references: [id])
  telegramUserId String   @unique // Telegram user ids are 64-bit; stored as String, same
                                   // convention as posterProductId etc., to avoid precision loss.
  chatId         String           // where the bot DMs this customer; equals telegramUserId
                                   // for a private 1:1 chat (VERIFIED public Bot API behavior).
  username       String?
  firstName      String?
  lastName       String?
  languageCode   String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}

model Branch {
  id           String   @id @default(cuid())
  posterSpotId Int      @unique // matches Order.posterSpotId's existing Int convention
  name         String
  address      String?
  isActive     Boolean  @default(true)
  syncedAt     DateTime @default(now())
  orders       Order[]
  carts        Cart[]
}

model Cart {
  id         String     @id @default(cuid())
  customerId String     @unique // one active cart per customer — simplest model that satisfies
                                 // Phase 1's needs; see §9 for lifecycle.
  customer   Customer   @relation(fields: [customerId], references: [id])
  branchId   String?
  branch     Branch?    @relation(fields: [branchId], references: [id])
  items      CartItem[]
  createdAt  DateTime   @default(now())
  updatedAt  DateTime   @updatedAt // staleness/expiry is judged off this field, see §10
}

model CartItem {
  id        String   @id @default(cuid())
  cartId    String
  cart      Cart     @relation(fields: [cartId], references: [id])
  productId String
  product   Product  @relation(fields: [productId], references: [id])
  quantity  Int
  addedAt   DateTime @default(now())

  @@unique([cartId, productId])
}
```

`Order` gains one field:

```prisma
model Order {
  // ...all existing Phase 0 fields unchanged...
  branchId String?
  branch   Branch? @relation(fields: [branchId], references: [id])
}
```

Deliberately **not** stored: price snapshots on `CartItem` (cart is priced live at checkout, see §9); a `phone` field on `TelegramAccount` (phone lives on `Customer.phone`, already present in Phase 0 — Telegram is not the source of truth for it, per the architecture principle).

Migration note (implementation-time decision, not decided here): either leave `Order.branchId` nullable forever, or do a one-time backfill — create a `Branch{posterSpotId:1}` row and set all existing Phase 0 orders' `branchId` to it, then consider making the column required for new rows going forward. Recommendation: do the backfill; it costs one migration step and keeps the model clean.

## 7. Telegram architecture

**Bot framework:** grammY (TypeScript-first, as originally scoped pre-Phase-0). **VERIFIED**: grammY is a real, actively maintained library supporting both polling and webhook modes with Fastify-compatible webhook adapters.

**Trust boundary — this is the most important thing in this section:** a Bot API `Update` (a message, a contact share, a callback query) arrives from Telegram's own servers via webhook or `getUpdates` polling. Its `from` field (user id, first/last name, username, language code) is **VERIFIED (public Bot API guarantee)** to be authenticated by Telegram itself — CUP can trust it directly, no HMAC needed, because it never passed through untrusted client JS. This is categorically different from Mini App `initData` (§9/§12), which arrives through client-side JavaScript and **must** be HMAC-verified before being trusted, because a malicious Mini App client could fabricate it.

**Phone collection — VERIFIED (public Bot API):** Telegram does not expose a user's phone number via `/start` or normal messages. It must be explicitly requested via a `request_contact` reply-keyboard button; the user taps "Share My Phone Number" in their own Telegram client, and the bot receives a `contact` message containing `phone_number`. Poster's `createIncomingOrder` requires a phone (or a linked `client_id`) — **VERIFIED in Phase 0's real smoke test**. Consequence for design: the bot flow must include an explicit "please share your phone" step before the customer's first checkout can succeed, and both the bot and the Mini App need to handle "customer has no phone yet" gracefully (see §10).

**Bot flow:**
1. `/start` → create/update `TelegramAccount` + `Customer` from the trusted `from` field. Reply with a short greeting + an inline "Open Mini App" button (`web_app` button type) + a `request_contact` keyboard button if `Customer.phone` is still null.
2. Contact share received → store on `Customer.phone`.
3. `/menu` or button press → re-send the "Open Mini App" button (covers users who dismissed it).
4. Order status change (event-driven, see §11) → bot DMs the customer's `chatId`.

## 8. Mini App architecture

**Stack recommendation:** Vite + React + TypeScript, no router library initially (a handful of screens, simple stack-based navigation state is enough — deep-linking via `start_param` can be added later without an architecture change), no global state library (`React.Context` for cart state is sufficient at this scope), `@telegram-apps/sdk-react` (or `@twa-dev/sdk` — pick one at implementation time, both are established community bindings) for `initData`/theme/haptics access, plain `fetch` for API calls. This matches "keep it simple, no unnecessary framework complexity."

**Screens (per the approved scope):** Home → Branch selection → Categories → Product list → Product detail → Cart → Checkout → Order confirmation → Order status. Each is a thin view over the backend endpoints in §9; no business logic (pricing, validation) lives in the Mini App — it always reflects what the backend computed.

**Dev-mode split (important for §13):** the Mini App can be developed and mostly tested as an ordinary web app in a regular browser, with `window.Telegram.WebApp` and `initData` mocked with fixed test values — this covers the large majority of UI work with zero Telegram/tunnel dependency. Only final integration testing needs a real Telegram client + HTTPS tunnel.

## 9. Backend API (contracts)

All endpoints except `/auth/telegram` and `/health*` require `Authorization: Bearer <session token>` issued by `/auth/telegram`. `customerId` is **never** accepted from the request body anywhere in Phase 1 — it is always derived from the verified session. This is a deliberate tightening versus Phase 0's `POST /orders`, which took `customerId` in the body because no auth existed yet.

```
POST /auth/telegram
  body: { initData: string }
  → 200 { sessionToken: string, customer: { id, displayName, phone: string|null } }
  → 401 if HMAC/auth_date invalid

GET  /branches
  → 200 [{ id, name, address, isActive }]   // only isActive branches, no auth required
                                             // (needed before login? no — Mini App always
                                             // authenticates first; kept auth-required in
                                             // practice, but carries no per-customer data)

GET  /catalog/categories        // unchanged from Phase 0
GET  /catalog/products          // unchanged from Phase 0

GET  /cart
  → 200 { id, branchId, items: [{ id, productId, name, quantity, unitPriceMinor, lineTotalMinor }], totalMinor }

POST /cart/branch
  body: { branchId: string }
  → 200 cart (as above) — switching branch does NOT clear items in Phase 1 (see §10)

POST /cart/items
  body: { productId: string, quantity: number }
  → 200 cart (upserts — repeated add of the same product increments quantity)

PATCH /cart/items/:cartItemId
  body: { quantity: number }
  → 200 cart

DELETE /cart/items/:cartItemId
  → 200 cart

DELETE /cart
  → 200 { cleared: true }

POST /cart/checkout
  header: Idempotency-Key (required, same contract as Phase 0's POST /orders)
  → 201 { orderId, status, posterIncomingOrderId }   // identical shape to Phase 0's response
  → 400 invalid branch / empty cart / unavailable items / no phone-or-client_id
  → 409 cart expired / idempotency in-progress or uncertain (same semantics as Phase 0)
  → 502 Poster definite rejection (message translated to a customer-safe string, see §12)

GET  /orders/me
  → 200 [{ id, status, totalMinor, createdAt, branchName }]   // customer's own orders only

GET  /orders/:id
  → 200 order — 404 if it doesn't belong to the authenticated customer (Phase 0 had no
       ownership check at all; this closes that gap now that real customers exist)

POST /telegram/webhook   // production only; not used in local dev (polling instead)
  header: X-Telegram-Bot-Api-Secret-Token (validated)
  → 200 (always, per Bot API convention — errors are logged, not surfaced to Telegram)
```

## 10. Customer identity flow

```
Telegram /start (trusted server-side `from` field)
        │
        ▼
 TelegramAccount + Customer created/updated (no phone yet, most likely)
        │
        ▼
 Bot shows "Open Mini App" + (if no phone) "Share phone number" button
        │
        ├─── user taps "Share phone" ──► Customer.phone set
        │
        ▼
 user opens Mini App → POST /auth/telegram with real initData
        │
        ▼
 backend verifies HMAC + auth_date → matches TelegramAccount by telegramUserId
 (same identity as the /start flow — never creates a second Customer for the same
 Telegram user id, since telegramUserId is unique)
        │
        ▼
 session token issued → Mini App is now "logged in" as that Customer
        │
        ▼
 at checkout: backend calls buildClientIdentity(customer) — EXISTING Phase 0 logic,
 unchanged. If customer.phone is still null and no posterClientId yet, checkout
 fails cleanly (400) and the Mini App tells the customer to share their phone via
 the bot, rather than the Mini App trying to collect a phone number itself (Mini
 App forms are not a substitute for Telegram's native, trusted contact-share flow).
        │
        ▼
 after a successful order, if customer.posterClientId is still null and Poster's
 response included a client_id (VERIFIED: it does — Phase 0's real order response
 had "client_id":2), backfill Customer.posterClientId. Future orders for this
 customer then use client_id instead of phone, per buildClientIdentity()'s existing
 preference — no new logic needed here, just calling existing code at one more point.
```

## 11. Order lifecycle

```
Customer → select branch → browse catalog → add to cart → view cart
   → tap checkout → Mini App generates one Idempotency-Key for this checkout
     attempt (UUID, kept in memory/localStorage; reused if the request is retried
     due to a network blip, exactly matching Phase 0's idempotency contract)
   → checkout button disabled after first tap (client-side UX guard; the REAL
     duplicate-order guard is still the server-side idempotency machinery,
     unchanged from Phase 0)
   → POST /cart/checkout
   → backend: validate session → validate branch → validate cart non-empty and
     not expired → re-validate every item still active (reuses OrdersService's
     existing per-item active check) → resolve client identity → call
     OrdersService.createOrder() UNCHANGED
   → on success: clear cart, return confirmation
   → Mini App shows confirmation screen
   → background poll job (Phase 0, unchanged) observes Poster status
   → on status change, OrdersService emits an event (new, see below) →
     TelegramModule listens → bot DMs the customer
   → customer can also pull GET /orders/:id or GET /orders/me at any time
```

**New, small addition to `OrdersService`:** after `refreshStatus()` changes an order's status, emit an in-process event (`@nestjs/event-emitter` — a single lightweight package, no Redis/queue) rather than importing `TelegramModule` directly. This keeps `OrdersModule` decoupled from `TelegramModule` (order logic must not depend on Telegram, per the architecture principle that Telegram is distribution-only) while still allowing a notification side effect. If `@nestjs/event-emitter` is judged unnecessary overhead at implementation time, the fallback is a plain injected optional interface (`OrderStatusNotifier`) — either is a few lines; this is the only piece of Phase 1 that touches `OrdersService`'s existing code at all, and it's additive (one `emit()` call), not a rewrite.

## 12. Security

- **initData verification (server-side, mandatory):** HMAC-SHA256 per Telegram's documented algorithm — `secret_key = HMAC_SHA256(key="WebAppData", data=bot_token)`, then `expected_hash = HMAC_SHA256(key=secret_key, data=data_check_string)`, compared to the `hash` field; `auth_date` checked against a freshness window (e.g. reject if older than 24h). **TO BE VERIFIED at implementation time**: get this exact key/data ordering from Telegram's own docs or a well-maintained library (e.g. `@telegram-apps/init-data-node`) rather than hand-deriving from memory — an HMAC key/message transposition is exactly the kind of subtle bug that fails silently. Recommendation: use the library, don't hand-roll it.
- **Bot token:** environment variable only (`TELEGRAM_BOT_TOKEN`), never logged, never sent to the Mini App in any response — identical discipline to `POSTER_API_TOKEN`. The Mini App receives only the short-lived session token, never the bot token.
- **Session token:** issued by `/auth/telegram` after successful verification; short-lived JWT signed with a new, separate secret (`JWT_SECRET` — never reuse the bot token or Poster token as key material). Sent as `Authorization: Bearer`.
- **Order ownership:** `GET /orders/:id` and `GET /orders/me` scope strictly to the authenticated customer. Phase 0 had no such check (no auth existed) — this is a real, necessary tightening, not a regression.
- **`customerId` never trusted from client input** anywhere in Phase 1 endpoints — always derived from the session (see §9).
- **CORS:** restrict to the Mini App's actual origin(s) via an env var (`MINI_APP_ORIGIN`), never `*` — a session token must not be usable from an arbitrary origin.
- **Webhook secret** (production only): validate `X-Telegram-Bot-Api-Secret-Token` on `POST /telegram/webhook`, set when registering the webhook — same pattern already planned in the original Phase 0 architecture notes.
- **Customer-facing error messages must never leak raw Poster/internal error text** (see §13's Poster-rejection row) — a real gap relative to Phase 0, where `OrderCreationFailedError`'s message includes the raw Poster reason. That's fine for Phase 0 (no untrusted end users). Phase 1 needs a translation layer: log full detail server-side, return a generic message to the Mini App.

## 13. Error handling

| Situation | Behavior |
|---|---|
| Invalid/tampered/expired Telegram initData | `401`, generic message, no detail on which check failed |
| Customer not found for a valid session (shouldn't normally happen — customer is auto-created on first valid `/auth/telegram`) | `404`, generic |
| Product unavailable at checkout (deactivated since added to cart) | `409`, lists which cart item(s) are unavailable; Mini App prompts removal — reuses `OrdersService`'s existing active-product check, surfaced per-item instead of a single opaque error |
| Price changed since cart-add | Not a distinct error — cart is priced **live** at checkout (no price snapshot stored), so the confirmation screen always shows the current, real price before the customer confirms. This is the chosen resolution strategy, not a gap. |
| Poster definite rejection (e.g. missing required field, invalid product) | `502` with a generic customer-safe message ("Couldn't complete your order, please try again or contact us"); full Poster detail logged server-side only |
| Poster timeout / ambiguous outcome | Order marked `uncertain` (Phase 0 behavior, unchanged) — Mini App shows "We're confirming your order" rather than a hard failure, and the customer is **not** prompted to retry (that's exactly what the idempotency design prevents); resolution arrives via the bot notification once staff/reconciliation resolves it |
| Duplicate checkout tap | Client-side: button disabled after first tap. Server-side: identical Idempotency-Key short-circuits per Phase 0's existing, tested logic — this is the real guard |
| Expired cart | If `Cart.updatedAt` is older than `CART_EXPIRY_MS`, checkout returns `409` "please review your cart"; Mini App re-fetches and re-shows the cart for reconfirmation |
| Invalid/inactive branch | `400` on cart-branch-select or checkout |
| Customer has no phone and no linked Poster client at checkout | `400` with a specific code the Mini App recognizes, telling the customer to share their phone via the bot (not a generic error) |

## 14. Development/testing setup

- **Bot token introduced:** only when actually building the `TelegramModule` (§18, step 1.6) — not before, per your explicit instruction. Everything through step 1.5 (schema, branch sync, auth logic, cart, checkout) is built and tested without it, using test vectors for initData (see §17).
- **Webhook vs polling for dev:** use **polling** (`bot.start()` in grammY) for local development — no public HTTPS endpoint needed, works immediately on a dev machine. Use **webhook** for staging/production (more efficient at scale, standard practice). This is a recommendation, not yet exercised against our real bot.
- **Serving the Mini App in dev:** two tracks. (1) Plain browser with a mocked `window.Telegram.WebApp`/`initData` — covers most UI iteration, zero extra infra. (2) Real Telegram client — requires the Mini App to be served over HTTPS (**VERIFIED public requirement**: Telegram will not open a plain-HTTP `web_app` URL), via a tunnel (ngrok/cloudflared) pointed at the local Vite dev server. Track 2 is only needed for final integration testing, deferred until the rest is working against track 1.
- **Testing real initData:** Telegram's Mini App platform exposes real `initData` only inside an actual Telegram client session (opened via the bot's `web_app` button) — there is no way to generate a genuinely-signed `initData` outside of Telegram itself. For automated tests, use published test vectors (initData + bot token + expected hash triples exist in Telegram's own documentation and in open-source validator libraries) as fixtures; for manual end-to-end testing, use track 2 above with the real bot.
- **Secret hygiene during dev:** same pattern as Phase 0 — `.env` (gitignored), never printed, never committed. `TELEGRAM_BOT_TOKEN` added to `.env.example` as a placeholder only when step 1.6 begins.

## 15. Environment variables (additions on top of Phase 0's)

| Variable | Purpose | Introduced at |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Bot API token from @BotFather | Step 1.6 (not before) |
| `TELEGRAM_WEBHOOK_SECRET` | Validates inbound webhook calls (production) | Step 1.6, production only |
| `JWT_SECRET` | Signs Mini App session tokens — distinct from bot/Poster tokens | Step 1.3 |
| `MINI_APP_URL` | URL the bot's "Open Mini App" button points to | Step 1.6 |
| `MINI_APP_ORIGIN` | CORS allow-list origin for the Mini App | Step 1.3 |
| `CART_EXPIRY_MS` | Cart staleness threshold for checkout rejection | Step 1.4 |

## 16. API contracts

Covered fully in §9. All request/response bodies validated with `zod`, matching Phase 0's existing pattern (no new validation library).

## 17. Testing strategy (not run yet)

- **Backend unit tests:** `CartService` (add/update/remove/clear, quantity upsert), `BranchService.sync()` (mirrors `CatalogService.sync()`'s tests exactly: empty-list protection, malformed-spot skip/report), `buildClientIdentity()` extension points (no new logic there, already covered in Phase 0).
- **Telegram auth validation tests:** valid signed initData accepted (using published test vectors, never a real token); tampered field rejected; stale `auth_date` rejected; missing `hash` rejected.
- **Mini App API integration tests:** full cart→checkout flow against the real SQLite test DB with `PosterService` mocked via nock/fixtures — same pattern as Phase 0's `orders-flow.integration.spec.ts`, extended to go through `/cart/checkout` instead of `/orders` directly, and to assert the session/ownership checks reject a mismatched customer.
- **Order/idempotency tests:** all of Phase 0's existing suite continues to apply unchanged (checkout is a thin wrapper, not a reimplementation); add one test confirming `customerId` in a checkout request body (if a caller tried to smuggle one) is ignored in favor of the session's customer.
- **Poster mocked tests:** `PosterService.getSpots()` tested the same way `getCategories()`/`getProducts()` are — nock + fixture, never live, in the automated suite.
- **One eventual real Telegram + Poster smoke test (deferred to end of Phase 1 implementation, explicit gate, same discipline as Phase 0):** real bot, real Mini App via tunnel, one real customer flow end-to-end, exactly one real order, no token exposure, stop-and-report on anything unexpected — not to be run until implementation is otherwise complete and approved.

## 18. Implementation phases

1. **1.1 Schema:** `TelegramAccount`, `Branch`, `Cart`, `CartItem`, `Order.branchId` + migration (with backfill decision made concretely).
2. **1.2 Branch sync:** `PosterService.getSpots()` + `BranchService.sync()`, mirroring `CatalogService`'s defensive pattern; `GET /branches`.
3. **1.3 Auth module:** initData verification (library-based), session issuance, `AuthGuard`; built and tested entirely with test vectors, no bot token.
4. **1.4 Cart module:** full CRUD, expiry rule.
5. **1.5 Checkout integration:** `/cart/checkout` → existing `OrdersService.createOrder()`; ownership checks added to `/orders/:id`, `/orders/me` added.
6. **1.6 Telegram bot:** grammY, polling for dev; `/start`, registration, phone request, "Open Mini App" button. **Bot token first used here.**
7. **1.7 Mini App skeleton:** Vite+React+TS, all nine screens, wired to the real APIs (mocked initData in the browser track first).
8. **1.8 Status notifications:** event-emitter wiring, bot DM on status change.
9. **1.9 Local integration pass:** everything above, Poster fully mocked, no real bot/tunnel needed.
10. **1.10 One real end-to-end smoke test:** real bot + tunnel + real Poster, explicit approval gate before running, mirroring Phase 0's smoke-test process exactly.

## 19. Risks and unresolved Poster/Telegram questions

- **`access.getSpots` exact live shape is UNVERIFIED.** Confirmed to exist via official docs (`github.com/joinposter/docs/.../access/getSpots.md`): GET + token only, returns `response: [{spot_id, spot_name, spot_adress, storages: [...]}]`. Field spelling (`spot_adress`, one 'd' — consistent with Poster's docs, not a typo introduced here) and the real live shape have not been tested against our account, exactly the situation that surprised us with `menu_category_id`. First real sync must be treated the same way: dump the raw response before trusting it, same as done for catalog in Phase 0.
- **Per-branch pricing is out of scope for Phase 1.** Real Poster product data (captured live in Phase 0) shows a `spots` array that could carry different prices per spot. Phase 1's catalog remains single-price (spot 1 only), even once multiple `Branch` rows exist. This is a known, accepted simplification — revisit if a second real branch has different prices.
- **Poster order status codes beyond 0/1 remain unverified** (same open item carried from Phase 0 — not something Phase 1 changes or needs to solve).
- **Token permission scope for `access.getSpots` is unverified** — a Personal Integration Token might not include this method; first call will reveal this (a clean 401/403-equivalent, handled the same defensive way as any other Poster error).
- **Cross-branch `client_id` behavior is unverified** — whether a Poster client tied to one spot is valid when ordering from a different spot. The create-order response only ever showed one `client_id` field with no visible spot-scoping, suggesting account-wide, but this is an assumption, not a confirmed fact.
- **Exact initData HMAC key/message ordering** should come from a vetted library or Telegram's own docs at implementation time, not from this document's paraphrase — see §12.

## 20. Definition of done for Phase 1

- Schema migrated (additive), Phase 0's existing tests still pass unmodified.
- `BranchService.sync()` works against real Poster (or falls back to documented manual seeding if `getSpots` proves inaccessible/differently-shaped), with the same defensive skip/report behavior as catalog sync.
- A real Telegram user can `/start`, share their phone, open the Mini App, browse the real Poster catalog, build a cart, and check out, resulting in exactly one real Poster order (the one deferred smoke test in §18/1.10) — with idempotency, ownership checks, and initData verification all functioning as designed.
- The bot DMs the customer when order status changes.
- No token (Poster or Telegram) ever appears in logs, error responses, or the Mini App.
- Full test suite (Phase 0 + Phase 1 additions) passes with Poster mocked; no automated test calls the real Poster or Telegram APIs.

---

**Status: awaiting your approval. No code written, no packages installed, no bot token used.**
