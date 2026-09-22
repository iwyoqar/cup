# Phase 21 — Poster POS Widget + CUP Operational Integration

Status: **built and verified against a local Poster simulator. NOT yet loaded into a real Poster POS.** The first real load is a manual step (section 15).
The widget is **read-only** and ships **OFF** (`POS_WIDGET_ENABLED=false`).

## 1. What it is

A Poster POS platform plugin (`pos-widget/`, one `bundle.js`) plus a small backend module (`src/modules/pos-widget/`). When a barista attaches a customer to a Poster
order, the widget asks CUP for that customer's **loyalty, reward and promotion picture** and shows it in a compact popup. If a free product is available it raises a
**non-blocking notification** ("N ta bepul mahsulot mavjud"). That is all it does.

It never changes anything: no order change, no reward redemption, no free-product insertion, no discount/price change, no loyalty-point payment, no order closing, no
Poster write of any kind, no Telegram message. The only thing the backend ever writes is one de-duplicated audit row (section 11).

## 2. Evidence levels used in this document

| Label | Meaning |
| --- | --- |
| **SUPPORTED** | Poster's documentation says the capability exists. Not proof it works here. |
| **VERIFIED** | Observed with evidence in this project. Every VERIFIED item says *where*: `simulator` (our own emulation of Poster), `backend HTTP` (real requests to the real code), or `real Poster` (the real account, read-only REST only). |
| **NOT VERIFIED** | Depends on the real POS runtime, which was not touched. Expect to learn it in the manual step. |
| **NOT DOCUMENTED** | Poster's documentation does not say. We made a safe assumption or built a discovery step; each is listed in section 14.1. |

**The simulator proves our widget logic. It does not prove Poster's runtime.** Where a result depends on how Poster really behaves, it is marked NOT VERIFIED.

## 3. Architecture

```
Register (Poster POS app)                      Poster's servers                        CUP backend (public HTTPS)
  bundle.js  ── Poster.makeRequest(GET) ──►  proxies + signs the request  ──►  GET /pos-widget/overview?...
  (no secret,                                  X-Poster-Signature / -Time / -Url         PosWidgetGuard: enabled? signature? fresh? account?
   only public API URL)                        X-Poster-Spot-Id / -Tablet-Id             PosWidgetOverviewService: composes EXISTING read services
                                                                                         PosWidgetAuditService: 1 de-duplicated staff_scan_events row
```

* `Poster.makeRequest` is proxied through Poster's servers, so the CUP backend must be reachable from the internet over HTTPS. This is why the signature, not the
  browser, is the identity: the register cannot be trusted to say who it is.
* **No second engine.** The overview composes the existing read services (`LoyaltyService`, `LoyaltySettings`, `Loyalty2Service`, `RewardsService`,
  `PromotionsService`, `CustomerMetrics`, `PosterImportedActivity`, catalog). The module imports no mutation service and no `PosterService`.
* No new table, no migration, no cache, no Redis. Every request is computed fresh (`Cache-Control: no-store`).

## 4. Poster APIs

**Used (all read-only, all wrapped in a typed `PosterApi` interface that contains only these):**
`Poster.on('orderClientChange' | 'orderOpen' | 'applicationIconClicked' | 'notificationClick')` (all non-blocking; none takes a `next` callback), `Poster.orders.getActive()`,
`Poster.clients.get(id)`, `Poster.clients.find({ searchVal })`, `Poster.interface.scanBarcode()` (mobile only), `Poster.interface.popup()`, `closePopup()`,
`showApplicationIconAt()`, `showNotification()`, `Poster.users.getActiveUser()`, `Poster.settings` (`accountUrl`, `spotId`, `spotTabletId`), `Poster.environment`,
`Poster.makeRequest()`.

**Forbidden (never called):** `Poster.makeApiRequest()`; `orders.addProduct / changeProductCount / setOrderClient / setOrderBonus / setOrderComment / create /
closeOrder`; `clients.create`; any `before*` event (they block checkout until `next()` is called).

**How "never called" is enforced, not just promised:**
1. The `PosterApi` interface in `pos-widget/src/poster.ts` has none of these methods, so a call does not compile.
2. Grep of the final `bundle.js` finds none of the forbidden method names and no Poster `before*` event name (the only `before` strings are React DOM's `beforeinput` / `beforeblur`).
3. The simulator traps every forbidden call and every `before*` subscription and counts them: **0 / 0** across the whole browser run.

## 5. Backend endpoints

Both are `GET`, both `Cache-Control: no-store`.

### `GET /pos-widget/ping` — connectivity / auth probe (no customer data)
Answers: is the feature enabled, did **this** request authenticate, did Poster send a signature at all, and (only if authenticated) the verified account / spot / register.

| Result | Status | Body |
| --- | --- | --- |
| authenticated | 200 | `{ status:'ok', enabled:true, authenticated:true, signaturePresent:true, account, spotId, tabletId, serverTime }` |
| feature off / not configured | 503 | `{ status:'unavailable', enabled, authenticated:false, signaturePresent, reason:'DISABLED'\|'NOT_CONFIGURED', serverTime }` |
| no / stale / bad signature | 401 | `{ status:'rejected', enabled:true, authenticated:false, signaturePresent, reason:'MISSING_SIGNATURE'\|'STALE_TIMESTAMP'\|'BAD_SIGNATURE', serverTime }` |
| wrong Poster account | 403 | `... reason:'WRONG_ACCOUNT'` |

### `GET /pos-widget/overview` — one customer, read-only
Query: **exactly one** of `posterClientId` (digits, ≤12), `code` (CUP code, 3–64), `phone` (6–32 of `+ digits space ( ) -`), plus optional `ref` (opaque echo, `[A-Za-z0-9_.:-]{1,64}`).
Unknown parameters are a `400` — in particular **`orderTotal` is rejected today**; it is the reserved seam for Phase 22 and no promotion is calculated.

Response: `{ ref, generatedAt, state, customer, linkedToPoster, loyalty, rewards, promotions, activity }`

| `state` | When |
| --- | --- |
| `FOUND` | one CUP customer resolved |
| `NOT_FOUND` | code / phone matches nobody |
| `NOT_LINKED` | a Poster client id CUP has no mapping for (never guessed from name or phone) |
| `AMBIGUOUS` | a phone shared by two customers (added because phones are not unique in CUP; never guessed — the barista is asked for the CUP code) |

`FOUND` carries:
* `customer`: `{ displayName, phoneMasked, code }` — masked phone (`+998•••••1111`), the CUP code the customer already shows on their own QR.
* `loyalty`: `{ legacyProgramEnabled, points, program2: { enabled, level, nextLevel, xp:{total,toNextLevel}, streak, cashbackMinor } }`.
* `rewards`: `{ availableTotal, programs:[{ name, threshold, progress, remaining, available, eligibleProducts[] }] }` — the same numbers Customer 360 shows.
* `promotions`: `[{ name, description, benefit, endsAt, remainingUses }]` — the customer's currently eligible promotions.
* `activity`: `{ visits, lastVisitAt }` — CUP orders + imported POS receipts.

**Not exposed:** any internal id, the Poster client id, Telegram id, raw Poster payload, CRM / growth / segment / referral data, the full phone.
Payload ≈ 1 KB.

## 6. Authentication

Primary mechanism: **Poster's request signature**, verified server-side. Documented formula (GET, so no body):
`X-Poster-Signature = md5( fullUrl + X-Poster-Time + POSTER_APPLICATION_SECRET )`.

`PosWidgetAuthService` checks, in this order, and fails closed at each step:

1. `POS_WIDGET_ENABLED` is `true` → else `DISABLED` (503).
2. `POSTER_APPLICATION_SECRET` **and** `POS_WIDGET_ACCOUNT` are set → else `NOT_CONFIGURED` (503). Enabled but unconfigured is refused, never "open".
3. `X-Poster-Signature` and a numeric `X-Poster-Time` are present → else `MISSING_SIGNATURE` (401).
4. `|now − time| ≤ POS_WIDGET_SIGNATURE_MAX_AGE` (default 300 s, both directions) → else `STALE_TIMESTAMP` (401).
5. The signature matches, compared with `timingSafeEqual`, against the candidate full URLs (`POS_WIDGET_PUBLIC_URL` + the request path/query exactly as received, and the forwarded scheme/host + path) → else `BAD_SIGNATURE` (401).
6. `X-Poster-Url` equals `POS_WIDGET_ACCOUNT` (compared case-insensitively; `iwyoqar` and `iwyoqar.joinposter.com` both accepted) → else `WRONG_ACCOUNT` (403).

The secret lives only in the backend environment. It is not in `bundle.js`, not in any response and not in any log line (rejections log the *reason* only).
Because the signature covers the full URL, **a signature made for one customer cannot be replayed for another** (verified).

**Known properties, stated plainly:**
* The signature does **not** cover `X-Poster-Url` / `-Spot-Id` / `-Tablet-Id`. The account pin is therefore a secondary check; the secret is the real trust. Within the freshness window a holder of one valid signed URL could send different spot/tablet headers — that would only mislabel the audit row, never widen access.
* A captured signed GET can be replayed **for the same URL** inside the window (default 5 min). It returns the same read-only, masked data. Lower `POS_WIDGET_SIGNATURE_MAX_AGE` (minimum 30) to shrink this.
* MD5 is what Poster documents; it is not our choice.

### The open question, and why there is no fallback
Poster documents the signature for **application requests**. It is **NOT DOCUMENTED** whether an ordinary `Poster.makeRequest()` from a POS plugin is signed the same way.
Per the brief, **no fallback authentication was built.** The first real request answers the question (section 15). If it turns out to be unsigned, the widget will show "ruxsat bermadi" and the backend logs `MISSING_SIGNATURE`; then — and only then — the smallest safe widget-scoped scheme should be designed (a separate decision), not before.

## 7. Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `POS_WIDGET_ENABLED` | `false` | Operator interlock. Anything but exactly `true` → every `/pos-widget/*` answers 503. |
| `POS_WIDGET_ACCOUNT` | unset | The Poster account subdomain to accept (`iwyoqar`). Unset → `NOT_CONFIGURED`. |
| `POS_WIDGET_PUBLIC_URL` | unset | Public HTTPS base URL Poster calls. The signature covers the full URL, so this must match what Poster signs. |
| `POS_WIDGET_SIGNATURE_MAX_AGE` | `300` | Accepted age of `X-Poster-Time`, seconds (30–3600). |
| `POSTER_APPLICATION_SECRET` | existing (Phase 20) | The Poster application secret. Server-side only. |

Widget build-time (public, baked into `bundle.js`): `VITE_CUP_API_URL` — the public CUP API base URL. Nothing else.

## 8. Widget states

All 14 required states exist, in Uzbek, in a compact 48 px-touch-target layout. **VERIFIED (simulator)** unless noted.

| # | State | What the barista sees |
| --- | --- | --- |
| 1 | Empty / initial | "Mijoz tanlanmagan" + a search box |
| 2 | No customer on the order | same; **no CUP call is made** (0 calls measured) |
| 3 | Loading | skeleton cards, order-scoped |
| 4 | Found | name, masked phone, code, then reward / loyalty / promotions / activity |
| 5 | Not found | "Mijoz topilmadi" |
| 6 | Not linked | "CUP profili bog'lanmagan" — linking is manual in Staff, never from here |
| 7 | Loyalty | level, cashback, XP, streak, points |
| 8 | Reward available | highlighted card, "N ta bepul mahsulot mavjud", eligible products |
| 9 | No reward | "Hozir mavjud sovg'a yo'q" + progress "3 / 5"; or "Faol sovg'a dasturi yo'q" |
| 10 | Promotions | list, or "Hozircha aksiya yo'q" |
| 11 | Last visit / activity | visits, "2 kun oldin"; or "Tarix yo'q" |
| 12 | Error | "CUP vaqtincha mavjud emas — Poster odatdagidek ishlashda davom etadi" + Retry |
| 13 | CUP unavailable / timeout | 500, refused connection, or no reply within 8 s → "CUP javob bermadi" + Retry |
| 14 | Ambiguous / not configured / rejected | "Bu raqamda bir nechta mijoz bor"; "Vidjet sozlanmagan"; "ruxsat bermadi"; "Bu kassa CUP ga ulanmagan" |

Every failure message ends with "Sotuvga ta'sir qilmaydi" (does not affect the sale). Every failure has a Retry.

**Fallback lookup** (desktop: type a CUP code or phone; mobile: `QR skaner` via `scanBarcode`). It looks up and displays. **It never attaches a customer to the order** — the widget has no method that could (verified: the order's client stayed 0 after every typed lookup and scan).
Codes are forgiving about typing (`cup kzh7uqd7` finds `CUP-KZH7UQD7`) but matching is exact; a phone needs ≥ 9 digits.

## 9. Stale-response protection

A slow answer for customer A must never overwrite the card for customer B. Two independent guards:

1. **Generation counter.** Every context change (order opened, client changed/removed, manual lookup) increments a counter and invalidates the old context; a response is applied only if its generation is still current.
2. **Server-echoed `ref`.** Each request carries `ref = orderId.clientId.generation`; the backend echoes it and the widget ignores any response whose `ref` is not the current one.

**Event payloads are not trusted to be informative.** Poster does not document what `orderClientChange` carries, so each event only *triggers* a read of the active order; a newer event supersedes an older one still waiting for `getActive()`, and the previous customer's card is cleared the moment the change is seen (it is never shown next to a new customer while the new one loads).

Also: removing the customer (`clientId` 0 / missing) or opening a new order clears the widget and makes **no** CUP call; a notification is raised once per (order, customer, available amount), so re-attaching does not repeat it.

**VERIFIED (simulator):** customer A (9001) delayed 3 s, switched to B (9002) after 200 ms → B stayed on screen when A's late answer arrived, and A raised no notification.

## 10. Notification and popup

* Reward actionable → `Poster.interface.showNotification()` (non-blocking).
* `notificationClick` or `applicationIconClicked` → `Poster.interface.popup({ 520 × 600 })`. On open it re-reads `orders.getActive()` and refreshes if the data is older than 20 s.
* **No automatic modal.** VERIFIED (simulator): 5 s hands-off with a reward customer → 1 notification, **0 popups**. Notification click, order icon and functions icon each opened exactly one popup.
* The app icon is registered at the order screen and the functions menu only.

## 11. Audit

Reuses `staff_scan_events` — no new table. Action `POS_WIDGET_CUSTOMER_VIEW`, `actorType` `POS_WIDGET`, `actorId` `poster:<account>:<spot|->:<tablet|->`, result `FOUND` / `NOT_FOUND`, the customer's internal id, and the branch mapped from the verified spot.
The same customer from the same register within **60 s is one row**. A typed lookup that matched nobody is one `NOT_FOUND` row with no customer. Rejected requests (401/403/400/503) write nothing.
**Never stored:** phone, CUP code, Poster client id, secret, request body, any Poster payload. An audit failure is swallowed and can never break the barista's screen.
**VERIFIED (backend HTTP):** rows carry only the fields above; ~50 requests produced 7 rows; the real customer, viewed about ten times inside the window, produced exactly one.

## 12. Simulator (`pos-widget/simulator/`)

A local stand-in for the register **and** for Poster's servers: it implements the documented `Poster` API, traps every forbidden call, and proxies `makeRequest` while **signing server-side** with a development secret (so the browser never sees it, as in production).
Run (all local, nothing reaches real Poster):
```
# backend on a COPY of the database, dev secret, feature ON
DATABASE_URL=file:./verify21.db NODE_ENV=test PORT=3024 POS_WIDGET_ENABLED=true POS_WIDGET_ACCOUNT=iwyoqar \
  POS_WIDGET_PUBLIC_URL=http://localhost:3024 POSTER_APPLICATION_SECRET=<dev-secret> POSTER_SYNC_ENABLED=false node dist/src/main.js
cd pos-widget && VITE_CUP_API_URL=http://localhost:3024 npm run build
SIM_TARGET=http://localhost:3024 SIM_APPLICATION_SECRET=<dev-secret> npm run simulator      # http://127.0.0.1:5190  (?mobile=1 boots as Android)
```
Query switches: `?mobile=1` (boot as an Android register), `?payload=empty` (events carry no data), `?active=off` (`orders.getActive()` fails); they combine.
Controls: add/remove a customer, new order, **open an existing order that already has a customer**, order/functions app icon, click a notification, mobile toggle + barcode, and a server-behaviour switch: signed / **down** / **timeout** / **unsigned** / **bad signature** / **stale time** / **wrong account**, plus latency and a per-customer slow delay (for the stale-response test).
A live checks panel shows forbidden calls, blocking (`before*`) subscriptions, requests, popups, notifications.

## 13. Manual verification results (no test suites were created or run)

Environment: copy of the dev DB with fixture customers, dev secret, `NODE_ENV=test`, sync forced OFF. The real backend, real DB and real `.env` were not touched.

### 13.1 Backend HTTP — 39 checks, 39 passed
Five checks failed on the first run and were **test-harness artifacts, not defects**: the harness signed a raw URL while `fetch` percent-encodes `'` and spaces before sending (V1, T8); a probe sent no spot header so it counted as a different register (A1, A2); and a `before` substring matched React's own DOM code (B2). The harness was corrected and the run repeated on a cleared audit table.

| Area | Result |
| --- | --- |
| Feature OFF | **503** on `overview` and `ping` (`DISABLED`) on an instance with **no** `POS_WIDGET_*` variables — the default. Enabled with no account → 503 `NOT_CONFIGURED`. The real `.env` sets none of them. |
| No auth | 401 `MISSING_SIGNATURE`, no data; unsigned `ping` reports `signaturePresent:false` |
| Invalid signature / other secret | 401 `BAD_SIGNATURE` |
| Expired (1 h old) and far-future timestamp | 401 `STALE_TIMESTAMP` |
| Wrong account | 403 `WRONG_ACCOUNT` (correctly signed) |
| Signature bound to URL | a signature for customer A rejected on customer B's URL (401) |
| Valid signed request | 200; `ping` reports account, spot, register and **no** customer data |
| Secret never returned | no response contained the dev or real secret, the Poster token, or `md5`/`secret` strings |
| Validation | no identifier, two identifiers, `orderTotal`, unknown parameter, injection-shaped id, oversized code, letters in phone, bad `ref` → all **400** |
| States | FOUND+reward (12 paid coffees → 2 rewards, 2/5), FOUND empty, progress 3/5, NOT_LINKED, NOT_FOUND (code and phone), AMBIGUOUS (shared phone), unlinked customer by code, unique phone, loose code typing |
| Canonical data | rewards, loyalty points, visits and last visit equal **Customer 360** exactly for the real linked customer (8 rewards available, 12 purchases); promotions equal the eligible set |
| Privacy | no internal id / Poster id / Telegram id / full phone / growth-CRM-referral data in any response; phone masked |
| **Read-only** | before/after counts of customers, orders, loyalty transactions, accounts, balance, reward and promotion redemptions, referrals, POS imports, accruals, cashback, webhook events, order links were **identical** after ~50 requests |
| Audit | 7 rows, correct actor/branch/result, one row per customer per 60 s, no PII |
| Latency | p50 33 ms, p95 ≤ 86 ms, max 93 ms over 40 requests; payload 1 021 bytes |
| Bundle | contains none of: dev/real application secret, Poster token, JWT secrets, bot token, admin password; no forbidden API name; no `before*` Poster event |
| Real DB afterwards | 0 widget audit rows, 0 fixture customers, 0 reward redemptions |

### 13.2 Simulator / browser
Detection and switching · stale-response prevention · loading (skeleton) · found · not found · not linked · ambiguous · reward available · no reward · no program · promotions / none · empty history · every failure (`down`, `timeout` ≈ 9 s, `unsigned`, `badsig`, `stale`, `wrongaccount`, **a genuinely stopped backend** → soft failure in 261 ms) · Retry recovers · fallback lookup (7 inputs) never attaches · mobile barcode scan and junk scan · notification → popup, icons → popup · no automatic popup · new order clears · unconfigured bundle makes 0 calls.
Event-payload robustness (added after review found the first version trusted the event payload): with **empty event payloads** attach, switch, removal (0 CUP calls), the 3-second stale race and a reopened order with a customer all behave correctly; with **`getActive` failing** the widget falls back to the event; with **both** unavailable it shows the empty state, makes 0 CUP calls and does not hang in Loading; a rapid double switch (customer A slow, then B) ends on B.
Throughout: **forbidden API calls 0, blocking subscriptions 0, uncaught page errors 0.**

Layout, measured with the popup open at **520×600**: no horizontal overflow, all buttons ≥ 44 px, smallest text 11 px; also clean at 375 px and 320 px. The full card is ~940 px tall so it scrolls, but the **reward decision ends at 483 px — visible without scrolling.**

### 13.3 Builds

| Build | Result |
| --- | --- |
| Backend `tsc --noEmit` | clean |
| Backend production build (`npm run build`) | succeeds; `dist/src/modules/pos-widget/*` emitted |
| Widget `npm run build` (`tsc --noEmit` + `vite build`) | succeeds; **exactly one file**, `pos-widget/dist/bundle.js`, 164 401 bytes (52.4 KB gzip), IIFE, CSS injected |
| Final bundle scan | no dev/real application secret, Poster token, JWT secret, bot token, admin password or database URL; no forbidden API name; no Poster `before*` event; **no CUP URL baked in** (an unconfigured bundle shows "Vidjet sozlanmagan" and makes no request) |
| Other apps | Admin / Staff / Mini App were not modified and were not rebuilt |

The delivered `dist/bundle.js` is deliberately built **without** `VITE_CUP_API_URL`; you build it with your public URL in manual step 5.

## 14. Poster capability status

| Capability | SUPPORTED | VERIFIED | NOT VERIFIED | NOT DOCUMENTED |
| --- | --- | --- | --- | --- |
| Plugin = one `bundle.js`, built by Vite | ✔ | ✔ build (simulator loads it) | loads in a real POS | |
| `orderClientChange` / `orderOpen` events | ✔ | ✔ simulator | real payload shape | |
| `orders.getActive()` (order/payment screens only) | ✔ | ✔ simulator | real return shape | |
| `clients.get` / `clients.find` | ✔ | ✔ simulator; **real Poster REST `clients.getClient`** returns the record and its phone matches the CUP customer | POS-side call | |
| `scanBarcode` (mobile only) | ✔ | ✔ simulator | real hardware/format | |
| `popup` / `closePopup` / notifications / app icons | ✔ | ✔ simulator | real sizing, scrolling, focus | how a popup scrolls an oversized document |
| `Poster.makeRequest` reaches our backend | ✔ | ✔ simulator | real reachability, redirects, timeouts | timeout units; body/size limits |
| `X-Poster-Signature` on application requests | ✔ | ✔ formula in backend HTTP | | |
| **Ordinary `makeRequest` is signed** | | | **the key open question** | ✔ |
| `X-Poster-Url` exact content | ✔ (name) | ✔ both forms accepted | real value | subdomain vs full URL |
| `X-Poster-Spot-Id` / `-Tablet-Id` always present | ✔ | | real presence | |
| POS plugin permissions vs REST `access` scopes | | | | ✔ (separate lists) |
| Development mode loading | ✔ (docs) | | exact menu path, HTTP vs HTTPS bundle URL | whether dev mode is per-device |

### 14.1 Known undocumented behaviour, and the assumption made for each

| # | Poster does not say | What we assumed / built | How it will be learned |
| --- | --- | --- | --- |
| 1 | Whether an ordinary `Poster.makeRequest()` from a plugin carries `X-Poster-Signature` | Nothing is assumed: no fallback exists. `ping` reports `signaturePresent`; the guard logs the rejection reason | Manual step 7 |
| 2 | What `X-Poster-Url` contains (`iwyoqar` or `iwyoqar.joinposter.com`) | Both accepted, compared case-insensitively | Manual step 7 (`WRONG_ACCOUNT` would show the real value) |
| 3 | Whether the URL Poster signs is byte-identical to the URL it sends (percent-encoding, trailing slash, port) | We sign-check the configured public URL and the forwarded host + the path exactly as received; the widget sends only `encodeURIComponent` values so nothing is ambiguous | Manual step 7 (`BAD_SIGNATURE`) |
| 4 | Whether the signature covers the `X-Poster-*` context headers | Assumed **not** (per the documented formula); account pin is a secondary check only | — |
| 5 | Whether `X-Poster-Spot-Id` / `-Tablet-Id` are always sent | Optional; audit falls back to `-` | Audit rows |
| 6 | Units of `makeRequest`'s `timeout` option | The widget passes 8 000 and also keeps its own 10 s safety timer, so a wrong unit cannot hang the popup | Manual step 8 |
| 7 | Whether `makeRequest` follows redirects, accepts a port or path prefix, or has a body-size cap | Widget uses a plain `https://<host>/pos-widget/overview?...`, tiny GET | Manual step 7 |
| 8 | Payload shape of `orderClientChange`, `orderOpen`, `notificationClick`, `applicationIconClicked` | **The active order (`Poster.orders.getActive()`) is authoritative** for `orderId` + `clientId` on every `orderClientChange`; the event payload is only a trigger and a fallback. If neither says who the customer is, the widget shows the empty state and calls CUP for nobody. `orderOpen` also reads the active order, so a reopened order that already has a customer loads. (Simulator-verified with full payloads, empty payloads, `getActive` failing, and both.) | Manual step 7–8 |
| 9 | How a popup frame scrolls a document taller than `height` | Layout keeps the reward decision within the first ~480 px; the rest scrolls | Manual step 8 |
| 10 | Whether Development mode is per-device and whether the POS caches the dev bundle | Assumed per-device (docs); use a test register | Manual step 6 |
| 11 | How POS-plugin permissions relate to REST `access` scopes (two separate lists) | Widget uses no REST at all | — |
| 12 | Whether `Poster.clients.get` ids equal REST `client_id` | Assumed equal; **real REST** confirmed client 2 ↔ the CUP customer by phone | Manual step 7 |
| 13 | **How the bundle reaches `Poster`, and when it exists.** Poster's docs describe no ready event. Its reference code (boilerplate ESLint `globals: { Poster: true }`; `examples/hello-world/app.jsx`) uses the **bare global `Poster`** and calls `showApplicationIconAt` / `Poster.on` synchronously while the bundle runs. The first real run showed no CUP item in the order (•••) menu and **zero requests reached CUP** | The first version read only `window.Poster` and ran a single, silent, permanently-latched init, so any miss (wrong accessor, not yet defined, a thrown call) left no icon and no trace. Fixed: bare identifier first, `window.Poster` as fallback; init is idempotent steps retried on a bounded timer (250 ms x 40, then 1 s, ~5 min); every init failure is a `console.error` (temporary diagnostics, prefix `[CUP widget]`). The `showApplicationIconAt({ order, functions })` shape is unchanged | Next real run: the console shows which case occurred (bare vs `window`, timing, a thrown call) or prints nothing at all if the bundle never evaluates. Note the boilerplate builds **CJS + Babel (since 2017)** whereas this bundle is an **IIFE (es2019)** - unverified as a factor |
| 14 | **The shape of `makeRequest`'s `result`.** `makeRequest.md` says only "Response body" (and `code` 0 = timeout, 1 = invalid JSON); `makeApiRequest.md` says it "makes `JSON.parse` of the response", which implies `makeRequest` does not | In the first real run every answer showed "CUP javobi tushunarsiz" although the backend returned 200 with valid JSON: the widget assumed an object. Reproduced with a fake `makeRequest` returning the JSON as text. Fixed: `result` may be the parsed object OR the raw JSON text; anything else is a soft failure | The temporary `[CUP widget] first makeRequest answer:` console line records `resultType` (string / object) in the real POS |

## 15. Manual steps — first real load in Poster Development mode (yours to perform)

Nothing below has been done. It does not upload anything to Poster. Roll back at any time with step 9.

1. **Give CUP a public HTTPS address** that reaches the backend (a stable domain, or a tunnel for a trial). Note it as `https://<public>`.
2. **Edit `.env`** and add: `POS_WIDGET_ENABLED=true`, `POS_WIDGET_ACCOUNT=iwyoqar`, `POS_WIDGET_PUBLIC_URL=https://<public>`. Confirm `POSTER_APPLICATION_SECRET` is the secret of the Poster application the widget belongs to (it is the same value Phase 20 uses).
3. **Restart the backend** — the running process on :3000 predates this code (`/pos-widget/ping` is 404 there today).
4. **Check the switch:** `curl https://<public>/pos-widget/ping` → expect `401` with `"enabled":true,"signaturePresent":false`. (`503` = still off/unconfigured.)
5. **Build and serve the bundle** with your public URL baked in:
   ```
   cd pos-widget
   npm install
   $env:VITE_CUP_API_URL = "https://<public>"     # PowerShell;  bash: VITE_CUP_API_URL=https://<public> npm run build
   npm run build
   npm run serve                                   # http://127.0.0.1:8080/bundle.js  (HOST=0.0.0.0 to reach it from a tablet)
   ```
6. **In the Poster POS** (a test register, not a busy one): open the `</>` developer tab and enter the bundle address (Poster's boilerplate uses `https://localhost:5173`; older docs use `http://127.0.0.1:8080/bundle.js` — if the POS refuses the plain-HTTP address, serve the bundle over HTTPS or through a tunnel). Exact menu wording is from Poster's docs and is NOT VERIFIED.
7. **Open a test order and attach the customer whose Poster client id is `2`.** Watch the backend log while you do it. The result of this one step answers the key question:
   * widget shows the customer, audit row appears → **ordinary requests are signed; done.**
   * log `POS widget request rejected: MISSING_SIGNATURE` → **ordinary `makeRequest` is not signed.** Stop and tell me; do not add a workaround.
   * `BAD_SIGNATURE` → signed, but the URL Poster signed differs from `POS_WIDGET_PUBLIC_URL` (scheme, host, port or trailing path) or the secret differs. Compare them.
   * `WRONG_ACCOUNT` → note the value of `X-Poster-Url` Poster really sends.
   * `STALE_TIMESTAMP` → clock skew between Poster and this server; raise `POS_WIDGET_SIGNATURE_MAX_AGE`.
8. Please also check by eye: does the popup open at a sensible size and scroll; does the notification appear and open the popup when tapped; does Poster stay fully usable with the backend stopped.
9. **Rollback:** set `POS_WIDGET_ENABLED=false` (and restart), and/or clear the address in the `</>` tab. The widget then does nothing.

## 16. Limitations and risks

* **Auth is the unproven part.** Everything else is verified against our own model of Poster.
* `POS_WIDGET_PUBLIC_URL` must equal the URL Poster signs byte-for-byte (scheme, host, port, path, query encoding). A mismatch shows as `BAD_SIGNATURE`. The widget sends only `encodeURIComponent`-encoded values to keep the URL canonical.
* The name in the widget is the **CUP** display name; on the real account the Poster client's name differs from CUP's for client 2 (the phone matches fully). The barista may see a different name than on the order. Matching is by phone/mapping, not name.
* Visits = CUP orders + imported POS receipts, so they inherit the Phase 11.2 semantics; refunds are still unmodelled.
* Poster order totals are **not** displayed: their units are unverified. Only the item count is shown.
* The endpoint has no rate limit beyond the signature; a valid signature is the gate.
* Notification de-duplication is in memory; reloading the POS shows the notification again once.
* Uzbek only. No Poster-side branding or translations.
* The bundle is cached by the register and changes only when re-loaded/re-uploaded. `VITE_CUP_API_URL` therefore should be a stable domain in production.
* Production upload (`application.uploadPOSPlatformBundle`, signed `md5(applicationId:fileMd5:applicationSecret)`) is deliberately **not** scripted; it is a later, separately approved step.

## 17. Phase 22 seam (not built)

`orderTotal` is reserved in the overview query (rejected today) and the widget already tracks the item count of the active order. A future phase could add a *display-only* estimate of which promotion would apply. Anything that changes an order — applying a reward, adding a free product, a discount — is a separate design that needs Poster's `before*`/order-mutation APIs and their blocking rules; none of it exists or is prepared here.

## 18. Three different URLs (do not mix them up)

Poster uses three unrelated addresses for CUP. They are configured in three different places.

| # | What | Purpose | Where it is set | Value in development |
| --- | --- | --- | --- | --- |
| a | **Application / Manage Platform page** | The page Poster opens when the app is "Подключить"-ed (and, if Manage Platform is on, inside the management console iframe). A frontend HTML page. | Poster **Developer account** -> application settings | the public origin root, e.g. `https://<tunnel>/` (Poster adds `?poster_url=&account_number=&lang=`) |
| b | **POS widget bundle** | `dist/bundle.js`, loaded by the register in POS Development mode. | The register: `</>` -> Platform settings -> Development (test account registered under Users and roles in the developer account) | `http://127.0.0.1:8080/bundle.js` (local only, never public) |
| c | **CUP backend API** | `/pos-widget/*` (signed by Poster), `/webhooks/poster` (Phase 20), everything else. NestJS, no route at `/`. | `.env` `POS_WIDGET_PUBLIC_URL`, widget build `VITE_CUP_API_URL`, and the webhook URL in the Poster dashboard | the same public origin, e.g. `https://<tunnel>` |

**Why `GET /` used to answer `Cannot GET /`.** Poster's "Подключить" opens (a). While the tunnel pointed at the NestJS backend, (a) and (c) were the same origin, and the backend has no route at `/` by design (it is an API). No environment variable produces the URL Poster opens; it is Poster-side configuration.

**What Poster actually sends (observed on the real click, three times):** a plain browser `GET /?poster_url=iwyoqar&account_number=335156&lang=ru` - a Chrome user-agent, no `code`, no `X-Poster-*` headers, no signature. The three parameters are NOT DOCUMENTED by Poster (its Manage Platform page documents only `?code=`), so they are treated as observed behaviour.

**The page** is `pos-widget/connect/index.html`: plain HTML with an inline script, no build step, no network calls, no secret. It validates `poster_url`, `account_number` and `lang`, shows them with `textContent` only (a hostile value is shown as "invalid", never as markup), renders in uz / ru / en, and removes an unexpected `code` from the address bar without reading or sending it. It stays frameable (no `X-Frame-Options` / `frame-ancestors`), has a CSP of `default-src 'none'` plus its own inline script/style, and sends Poster's documented `top.postMessage({ hideSpinner: true }, '*')` after load. It does **not** perform any `code` exchange (`POST /api/v2/auth/manage`): that needs the application secret and belongs on the server. CUP does not need it today (the backend uses the personal API token; webhooks and the widget use signatures), but if Poster expects the app to complete that handshake before showing it as connected, this page does not.

**Serving it (development).** `npm run serve` (`pos-widget/scripts/serve-dev.mjs`, 127.0.0.1:8080) serves exactly two paths: `/` (this page) and `/bundle.js` (the widget). To make one public hostname serve both (a) and (c), the tunnel points at a small dev front (currently the diagnostic proxy on :3100) that sends only the **exact path `/`** (GET/HEAD) to the page and everything else to the backend. Consequences: the backend and its API contracts are unchanged; `/bundle.js` is not public; if the tunnel is pointed straight at the backend, `/` is a 404 again. A production deployment needs a real static host (or reverse-proxy rule) for (a): not built, not decided.

**Poster docs correction (from `joinposter/docs`, en/pos/debug.md):** register the test account's subdomain under **Users and roles** in the developer account first; the `</>` button is at the **top right** of the register; in Development mode the bundle loads from `http://127.0.0.1:8080/bundle.js` and `console.log` output appears in the console of the web register (`<account>.joinposter.com/pos`).
