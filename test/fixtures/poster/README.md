# Poster API fixtures

Status of each fixture, so nobody mistakes a reconstruction for a captured payload:

| Fixture | Status |
|---|---|
| `error-bad-token.json` | **Captured live** during Phase 0 implementation (2026-09-17) by hitting the real Poster API with an invalid token. Genuine raw response. |
| `get-categories.json` | **Reconstructed, then confirmed accurate** against a real live `menu.getCategories` call during the 2026-09-17 smoke test — `category_id`/`category_name` were correctly named on the first try. |
| `get-products.json` | **Reconstructed, then corrected** against a real live `menu.getProducts` call during the 2026-09-17 smoke test. The original guess (`category_id`) was **wrong** — the real field is `menu_category_id`; products carry no `category_id` at all. `price` keyed by spot id was confirmed correct. Product name is now the real Cyrillic "Капучино 250 мл", not the earlier placeholder transliteration. See `poster.types.ts` for the corrected, now-verified shape. |
| `create-incoming-order-success.json` | **Corrected against official docs + a real successful order** (incoming_order_id=3, 2026-09-17). `response` is an object (not a bare id) containing `incoming_order_id`, `spot_id`, `status`, `client_id`, `phone`, etc. — matches `github.com/joinposter/docs`. |
| `get-own-incoming-order-pending.json` / `get-own-incoming-order-accepted.json` | **Corrected against the real order's status check.** `response` is a **single object**, not an array as originally guessed — `PosterService.getOrderStatus()` was fixed to match. Fields (`incoming_order_id`, `status`, `spot_id`) are raw numbers, not numeric strings. |
| `get-spots.json` | **Captured live** (2026-09-18, Phase 1.2) — genuine raw response from `access.getSpots`, token redacted. `response` is an array (matches docs); `spot_id` is a numeric **string** (unlike `getOwnIncomingOrders`'s raw numbers — Poster is inconsistent across endpoints, checked per-field, not assumed). Real payload includes undocumented extra fields (`name: null`, `region_id`, `lat`, `lng`, `storages`) that `PosterSpot` deliberately does not model, since Phase 1 has no use for them. |

Two real, evidence-backed corrections came out of the 2026-09-17 smoke test, both caught cleanly rather than causing silent corruption:
1. `menu.getProducts`: real field is `menu_category_id`, not `category_id` — caught by `CatalogService.sync()`'s per-item skip/report, not a crash.
2. `incomingOrders.getOwnIncomingOrders?incoming_order_id={id}`: returns a single object, not a list — this one WAS a silent-ish failure mode (`PosterService.getOrderStatus()` returned `null` instead of throwing, logged as "Poster returned no order" rather than erroring loudly) until manually diagnosed with a raw dump. Worth remembering: an array vs. single-object mismatch can produce an empty-but-not-obviously-wrong result rather than a crash, so it's less self-announcing than a missing field. If order-status polling is ever silently not progressing again, check this shape first.

Also confirmed via official docs (`github.com/joinposter/docs`, not guessed): `incomingOrders.createIncomingOrder` requires either `client_id` or a top-level `phone` field — CUP now sends `phone` (or `client_id` when the local Customer is already linked) via `buildClientIdentity()` in `orders.service.ts`.
