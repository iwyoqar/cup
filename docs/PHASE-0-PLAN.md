# CUP — Phase 0 Implementation Plan

## Core Loop

**Poster API → CUP Backend → Database → Orders**

Goal: prove a real order can be created in Poster from CUP, persisted locally, and tracked to completion — with no duplicate-order risk on retry. Everything not required for that loop is explicitly deferred.

## Out of scope (Phase 0)

Telegram bot, Telegram Mini App, loyalty, analytics, Redis, Docker, PostgreSQL, authentication, any frontend. No monorepo/workspace tooling — a single NestJS app, since there is nothing yet to share code with.

---

## 1. Stack

| Layer | Choice |
|---|---|
| Runtime | Node.js (v24, already installed) |
| Language | TypeScript |
| HTTP framework | NestJS on the Fastify adapter (`@nestjs/platform-fastify`) |
| ORM | Prisma |
| Database | SQLite (`file:./dev.db`), via Prisma's `sqlite` provider |
| Background polling | `@nestjs/schedule` (in-process `@Interval`/cron) — **not** BullMQ, since Redis is out of scope. Documented limitation: single-instance only; revisit with a real queue when Redis is introduced. |
| Package manager | npm (already installed; no need to introduce pnpm until a Mini App workspace exists) |
| Test runner | Jest (Nest default) + `supertest` for HTTP + `nock` for mocking Poster HTTP calls |
| Env validation | `zod` schema validated once at bootstrap, fail-fast if invalid/missing |

---

## 2. Directory structure

```
cup/
  src/
    main.ts
    app.module.ts
    common/
      config/
        env.schema.ts          # zod schema + typed getConfig()
      prisma/
        prisma.service.ts      # thin injectable PrismaClient wrapper — the ONLY file importing PrismaClient
      enums/
        order-status.ts        # shared TS union type + const array, used app-wide instead of Prisma enums
        idempotency-status.ts
    modules/
      customers/
        customers.repository.ts
        customers.module.ts
      catalog/
        catalog.controller.ts
        catalog.service.ts
        catalog.repository.ts
        catalog.module.ts
        catalog-sync.job.ts     # @Interval-based periodic sync + manual trigger
      poster/
        poster.service.ts       # the ONLY module that talks HTTP to Poster
        poster.module.ts
        poster.types.ts          # narrow, verified-only request/response types
        poster-status-map.ts     # isolates Poster status-code → CUP status mapping
      orders/
        orders.controller.ts
        orders.service.ts
        orders.repository.ts
        idempotency.repository.ts
        order-status-poll.job.ts
        orders.module.ts
  prisma/
    schema.prisma
    migrations/
    seed.ts                     # creates one test customer + runs an initial catalog sync
  test/
    fixtures/poster/
      get-products.json
      get-categories.json
      create-incoming-order.json
      get-own-incoming-order-pending.json
      get-own-incoming-order-accepted.json
    unit/
    integration/
  .env.example
  package.json
  tsconfig.json
```

---

## 3. Environment variables

| Variable | Purpose |
|---|---|
| `NODE_ENV` | `development` / `test` |
| `PORT` | backend HTTP port |
| `DATABASE_URL` | `file:./dev.db` for Prisma/SQLite |
| `POSTER_API_BASE_URL` | `https://joinposter.com/api` |
| `POSTER_API_TOKEN` | Poster Personal Integration token — **env only, never logged, never committed, never returned in any response** |
| `POSTER_DEFAULT_SPOT_ID` | verified value `1`, kept configurable rather than hardcoded |
| `ORDER_STATUS_POLL_INTERVAL_MS` | poller cadence, e.g. `30000` |

Validated once via a `zod` schema at bootstrap; the process refuses to start if `POSTER_API_TOKEN` or `DATABASE_URL` is missing. `.env` stays git-ignored; `.env.example` lists keys with placeholder values only.

---

## 4. Database schema (Prisma / SQLite)

Portability rules applied throughout: **no Prisma `enum`** (unsupported on `sqlite`) — status fields are `String`, validated against shared TS unions in `src/common/enums/`. **No `Decimal`** (unsupported on `sqlite`) — all money is `Int` minor units (e.g. tiyin), matching the verified Poster price of `300` for a Cappuccino as an integer already. No SQLite-specific SQL anywhere.

```prisma
model Customer {
  id             String   @id @default(cuid())
  posterClientId String?  @unique   // external ID — nullable, set once linked in Poster
  displayName    String?
  phone          String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  orders         Order[]
}

model Category {
  id               String   @id @default(cuid())
  posterCategoryId String   @unique   // external ID
  name             String
  sortOrder        Int      @default(0)
  isActive         Boolean  @default(true)
  syncedAt         DateTime @default(now())
  products         Product[]
}

model Product {
  id              String   @id @default(cuid())
  posterProductId String   @unique   // external ID
  categoryId      String
  category        Category @relation(fields: [categoryId], references: [id])
  name            String
  priceMinor      Int               // integer minor units, cached from Poster
  isActive        Boolean  @default(true)
  syncedAt        DateTime @default(now())
  orderItems      OrderItem[]
}

model Order {
  id                     String   @id @default(cuid())
  customerId             String
  customer               Customer @relation(fields: [customerId], references: [id])
  posterSpotId           Int
  posterIncomingOrderId  String?  @unique   // external ID — set only after a confirmed Poster response
  status                 String            // see OrderStatus union — "pending" | "sent_to_poster" | "uncertain" | "accepted" | "completed" | "failed" | ...
  totalMinor             Int
  idempotencyKey         String   @unique
  createdAt              DateTime @default(now())
  updatedAt              DateTime @updatedAt
  items                  OrderItem[]
}

model OrderItem {
  id              String  @id @default(cuid())
  orderId         String
  order           Order   @relation(fields: [orderId], references: [id])
  productId       String
  product         Product @relation(fields: [productId], references: [id])
  posterProductId String            // denormalized external ID, kept even if product is later deactivated
  quantity        Int
  unitPriceMinor  Int
  totalPriceMinor Int
}

model IdempotencyKey {
  key             String   @id
  scope           String            // e.g. "order.create"
  requestHash     String            // detects a reused key with a different payload
  status          String            // "in_progress" | "completed" | "failed" | "uncertain"
  responseSnapshot String?           // JSON string of the response returned on first success
  orderId         String?  @unique
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}
```

Shared status unions (`src/common/enums/`):
- `OrderStatus`: `pending | sent_to_poster | uncertain | accepted | preparing | ready | completed | cancelled | failed` — only `pending`(0) and `accepted`(1) are verified against real Poster behavior today; the rest are provisional and isolated behind `poster-status-map.ts` so adding real values later touches one file.
- `IdempotencyStatus`: `in_progress | completed | failed | uncertain`.

---

## 5. Repository boundary

`PrismaService` wraps `PrismaClient` and is injected only into repositories (`CustomersRepository`, `CatalogRepository`, `OrdersRepository`, `IdempotencyRepository`). Services (`OrdersService`, `CatalogService`) depend on repositories, never on `PrismaService` or Prisma types directly. This is the seam that keeps a future SQLite→PostgreSQL swap confined to the repository layer.

---

## 6. PosterService

Single isolation point for all Poster HTTP calls. Methods, mapped 1:1 to verified behavior:

```ts
getProducts(): Promise<PosterProduct[]>
  // GET https://joinposter.com/api/menu.getProducts

getCategories(): Promise<PosterCategory[]>
  // GET https://joinposter.com/api/menu.getCategories

createOrder(input: CreatePosterOrderInput): Promise<CreatePosterOrderResult>
  // POST https://joinposter.com/api/incomingOrders.createIncomingOrder
  // verified: spot_id=1, product_id=3 → incoming_order_id=2, initial status 0

getOrderStatus(incomingOrderId: string): Promise<PosterOrderStatus>
  // GET https://joinposter.com/api/incomingOrders.getOwnIncomingOrders?incoming_order_id={id}
  // verified: status 0 → 1 after accepting in Poster UI
```

Rules:
- `poster.types.ts` defines only the fields actually verified (spot_id, product_id + quantity, resulting incoming_order_id, status). Any additional field Poster's API might accept or return is **not** assumed — if the implementation needs something unverified, it's added with an inline comment marking it as unconfirmed and to be checked against Poster's docs/support before relying on it in production logic.
- All Poster errors are translated into a small set of typed outcomes the rest of the app can act on: a **definite failure** (Poster responded with a clear rejection before any order was created) vs. an **ambiguous failure** (timeout, connection reset, malformed/no response) — this distinction is what the idempotency design below depends on.
- The token is read once from config, attached only inside `PosterService`'s HTTP client, and never logged — request/response logging redacts the `token` field.

---

## 7. Catalog sync

`CatalogService.sync()` calls `PosterService.getProducts()` / `getCategories()` and upserts into `Category`/`Product` by their external IDs. Items no longer present in Poster are soft-deactivated (`isActive = false`), never deleted, to preserve `OrderItem` history integrity. Exposed two ways for Phase 0: a manual `POST /catalog/sync` endpoint (primary, for local testing) and a low-frequency `@Interval` job (secondary, so the loop can be exercised without manual calls).

---

## 8. Orders: creation flow and idempotency

**This is the critical section.** Poster's verified API gives no client-supplied idempotency key or lookup-by-reference mechanism — `getOwnIncomingOrders` is only verified to work by `incoming_order_id`, which CUP only learns from a successful `createIncomingOrder` response. That gap shapes the whole design and is stated plainly below rather than papered over.

**Flow for `POST /orders` (header: `Idempotency-Key`):**

1. Look up `IdempotencyKey` by the header value.
   - Found, `status = completed` → return the stored `responseSnapshot` immediately. **No Poster call is made.**
   - Found, `status = in_progress` → return `409 Conflict` (a concurrent duplicate request is already in flight).
   - Found, `status = failed` → safe to retry: we know definitively Poster was never successfully contacted for this key.
   - Found, `status = uncertain` → **do not auto-retry.** Return `409` with a message that this request's outcome is unknown and requires manual reconciliation (see below). Automatically retrying here is exactly how a duplicate Poster order gets created.
   - Found, but `requestHash` differs from the incoming payload → `422 Unprocessable Entity` (key reuse with a different order body is a client bug, not a retry).
   - Not found → insert `IdempotencyKey{status: in_progress}` **and** the `Order{status: pending}` row in the same transaction, committed *before* calling Poster.
2. Call `PosterService.createOrder()`.
   - **Success** → set `Order.posterIncomingOrderId`, `status = sent_to_poster`; set `IdempotencyKey.status = completed` with the response snapshot. Return to client.
   - **Definite failure** (Poster returned a parseable rejection, e.g. invalid product/spot) → `Order.status = failed`, `IdempotencyKey.status = failed`. Client may retry with a corrected payload under a new key.
   - **Ambiguous failure** (timeout / connection reset / unparseable response) → `Order.status = uncertain`, `IdempotencyKey.status = uncertain`. No `posterIncomingOrderId` is known, so this order **cannot** be resolved by the status poller (which polls by that ID). It is surfaced in logs and left for manual reconciliation against the Poster back-office UI — the same action a staff member already takes today when pressing "Принять".

**Documented failure window (explicit, per instruction not to overclaim):** if `createIncomingOrder` succeeds on Poster's side but CUP never receives the response (network drop after Poster processed it), CUP has **no verified way** to discover the resulting `incoming_order_id` and reconcile automatically. Phase 0 does not claim exactly-once delivery to Poster — it claims: no duplicate is ever created by CUP's own retry logic, and every non-completed outcome is classified and visible rather than silently dropped or blindly retried. Closing the gap fully would need either a Poster-side idempotency/reference field or a list-recent-orders endpoint — neither is confirmed to exist; investigating that is out of scope for Phase 0 and noted here as a follow-up.

---

## 9. Background order-status polling

`order-status-poll.job.ts`, on an `@Interval(ORDER_STATUS_POLL_INTERVAL_MS)`: selects all `Order` rows with a non-terminal status **and** a known `posterIncomingOrderId`, calls `PosterService.getOrderStatus()` for each, maps the result through `poster-status-map.ts`, and updates the row. Runs in-process — fine for a single local instance; explicitly not safe for multiple concurrent backend instances without a real queue, which is deferred with Redis.

---

## 10. REST endpoints (local testing only — no auth)

```
POST /catalog/sync              trigger a manual catalog sync
GET  /catalog/categories
GET  /catalog/products

POST /orders                    body includes customerId (no auth yet); header: Idempotency-Key
GET  /orders/:id

GET  /health
GET  /health/poster              simple reachability check against Poster
```

A `prisma/seed.ts` creates one test `Customer` row so `POST /orders` has a valid `customerId` to reference without building auth.

---

## 11. Testing

| Type | What it covers |
|---|---|
| Unit — `PosterService` | Request building and response parsing against the captured fixtures (`get-products.json`, `create-incoming-order.json`, etc.) via `nock`; no real network calls in tests. |
| Unit — repositories | Run against a real temporary SQLite file (not mocked), verifying unique constraints (`idempotencyKey`, `posterIncomingOrderId`), FK behavior, and upsert logic. |
| Unit — `OrdersService` | Mocked `PosterService` + repositories; covers success, definite-failure, and ambiguous/timeout → `uncertain` branches explicitly. |
| Unit — idempotency | Same key replayed → short-circuits without a second Poster call; same key with a different payload → `422`; key already `in_progress` → `409`; key `uncertain` → `409`, never auto-retried. |
| Unit — catalog sync | Mocked `PosterService` responses; verifies insert of new items, update of existing, and deactivation of removed ones. |
| Integration | Boots the Nest app against a temp SQLite DB with `PosterService` HTTP mocked via fixtures; drives `POST /orders` → `GET /orders/:id` → simulated status poll tick → asserts the order reaches `accepted`, matching the real spot_id=1 / product_id=3 / incoming_order_id=2 scenario already verified manually. |

---

## 12. Definition of done for Phase 0

- `npm run start:dev` boots with SQLite, no Docker/Redis/Postgres required.
- Missing `POSTER_API_TOKEN` prevents startup with a clear error.
- `POST /catalog/sync` populates local `Category`/`Product` from the real Poster test account.
- `POST /orders` against the seeded test customer creates a real Poster incoming order, retried calls with the same `Idempotency-Key` never create a second one, and the status poller observes the 0→1 transition after manually accepting in Poster — mirroring the loop already proven by hand.
- All tests in section 11 pass using fixtures, with no live Poster calls in CI.

---

**Status: awaiting approval. No packages installed, no source files created yet.**
