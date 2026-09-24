// Poster API (joinposter.com) request/response contracts used by PosterService.
//
// IMPORTANT — read before trusting field names against a live account:
// Fields marked VERIFIED were confirmed by hand against the real Poster test account
// (see docs/PHASE-0-PLAN.md): spot_id=1, product_id=3 ("Cappuccino 250 ml"), price=300,
// createIncomingOrder -> incoming_order_id=2, status "0" -> "1" after accepting in Poster.
//
// Fields marked UNVERIFIED are a best-effort reconstruction based on general Poster API
// conventions (the "response" success envelope, numeric IDs serialized as strings) and have
// NOT been independently re-verified against raw captured request/response payloads in this
// conversation. Per the Phase 0 plan, these are isolated entirely inside this module and this
// file. Before relying on this against production traffic, confirm the exact wire format
// against Poster's own API docs or a freshly captured real payload.

export interface PosterApiSuccessEnvelope<T> {
  response: T;
}

// PARTIALLY VERIFIED live against the real Poster API (2026-09-17, during Phase 0
// implementation): an invalid token produced HTTP 200 with body
// {"error":{"code":11,"message":"Bad access token"}}. This confirms Poster reports
// application-level errors via HTTP 200 with a truthy top-level "error" key, at least for
// auth failures. The internal shape of `error` (code/message fields) is treated as opaque
// beyond that — logged for diagnostics, never parsed field-by-field — since only this one
// error case has actually been observed.
export interface PosterApiErrorEnvelope {
  error?: unknown;
  message?: unknown;
  [key: string]: unknown;
}

export interface PosterCategory {
  category_id: string; // UNVERIFIED field name, VERIFIED that Poster ids are numeric-as-string
  category_name: string; // UNVERIFIED field name
}

export interface PosterProduct {
  product_id: string; // VERIFIED live (2026-09-17 smoke test): "3" is "Капучино 250 мл"
  product_name: string; // VERIFIED live: "Капучино 250 мл" (Cyrillic in the real account)
  // VERIFIED live: the real field is "menu_category_id", NOT "category_id" (products carry no
  // "category_id" field at all). The original "category_id" assumption was wrong and caused
  // every product to fail category lookup on the first real catalog sync — caught cleanly by
  // the per-product skip/report handling, not a crash. Corrected against the real payload.
  menu_category_id: string;
  // VERIFIED live (2026-09-23): Poster reports this directly on the product even when
  // menu_category_id is "0" (its own sentinel for "unfiled / on the register's Top screen quick-access
  // grid, not under any category tab") — every such product carries the literal value "Top screen".
  // catalog.service.ts uses it as a fallback category name so these products are never silently
  // dropped from CUP's catalog. See CatalogService.sync() for the incident this fixes.
  category_name: string;
  // VERIFIED live: keyed by spot_id (string), e.g. {"1": "300"} — the original assumption
  // about this structure was correct.
  price: Record<string, string>;
}

// Finance-1 — VERIFIED live (2026-09-24) against menu.getProduct?product_id=X (docs:
// en/web/menu/getProduct.md) for a real "Dish" (type "2") the owner had just configured a recipe
// for: `ingredients` carries one line per component, `structure_selfprice` is that component's
// cost contribution in Poster wire units (kopeck/tiyin, same /100 rule as poster-money.ts). A
// product with NO recipe configured in Poster (the vast majority in this account today) is type
// "3" and either has no `ingredients` array at all or an empty one — never fabricated here.
export interface PosterProductRecipeLine {
  ingredient_id: string;
  ingredient_name: string;
  structure_unit: string; // g | ml | kg | l | p — display-only, CUP never converts units itself
  structure_brutto: number | string;
  structure_selfprice: string; // this component's cost, Poster wire units
}

// menu.getProduct's response — a strict superset of PosterProduct's fields for the one product
// requested, plus `cost` (Poster's own pre-summed total, verified to equal the sum of
// ingredients[].structure_selfprice) and `ingredients` when the product is a configured Dish.
export interface PosterProductDetail {
  product_id: string;
  product_name: string;
  type: string; // documented: "2" = dish (has a recipe), others do not
  cost?: string; // Poster wire units — total theoretical cost, present only for a configured Dish
  ingredients?: PosterProductRecipeLine[];
}

// CONFIRMED against official docs (github.com/joinposter/docs,
// ru/web/incomingOrders/createIncomingOrder.md), 2026-09-17 — not yet re-verified against a
// successful live response (the one live attempt so far was rejected for missing `phone`).
export interface CreatePosterOrderItemInput {
  product_id: number;
  count: number;
  // Phase 8.1: DOCUMENTED in the same official page (re-read verbatim 2026-09-19): "price —
  // Цена товара в копейках, по умолчанию берется цена товара в указанном заведении" (product
  // price in kopecks; defaults to the product's price at the given establishment). Phase 8
  // wrongly stated Poster had no price field. What the docs do NOT say: whether 0 is honored
  // (vs treated as "not provided"), and Poster's create/get responses never echo price back, so
  // the effect is only observable at the POS. UNVERIFIED LIVE. Sent ONLY for a free reward line
  // (OrdersService.sendToPoster) and only when REWARD_CHECKOUT_ENABLED — every other line is
  // sent exactly as before (no price), so normal checkout payloads are unchanged. 0 is used
  // because it is unit-independent (kopecks vs whole so'm is irrelevant for zero).
  price?: number;
}

// CONFIRMED against official docs, 2026-09-17. Per docs: `phone` is required if `client_id`
// is absent — Poster will match/create a customer by phone. `client_id` is preferred when the
// local Customer is already linked to a Poster client (see PosterService buildClientIdentity
// usage in orders.service.ts). Both fields are optional here because exactly one is required,
// enforced by the caller, not by this type.
export interface CreatePosterOrderInput {
  spot_id: number; // VERIFIED live: 1
  phone?: string;
  client_id?: number;
  products: CreatePosterOrderItemInput[];
}

// CONFIRMED against official docs: on success, `response` is an OBJECT containing
// `incoming_order_id`, `spot_id`, `status`, `client_id`, and customer/product fields — not a
// bare id as one of the two originally-guessed shapes assumed. PosterService.createOrder()
// already handled the object case defensively, so no logic change was needed, only this
// type/comment correction now that the real shape is documented rather than guessed.
export type CreatePosterOrderRawResponse = string | number | { incoming_order_id: string | number };

// VERIFIED live (2026-09-17, real order incoming_order_id=3): querying
// incomingOrders.getOwnIncomingOrders?incoming_order_id={id} returns `response` as a SINGLE
// OBJECT, not an array as originally assumed — PosterService.getOrderStatus() was fixed to
// match. Fields are raw JSON numbers, not numeric strings, contrary to the original guess
// (which happened to still work at runtime due to JS's implicit object-key coercion, but the
// type was wrong). The "not found" shape (e.g. an invalid incoming_order_id) has NOT been
// observed live — treated defensively as "no incoming_order_id present in the response".
export interface PosterIncomingOrder {
  incoming_order_id: number; // VERIFIED live: numeric
  status: number; // VERIFIED live: numeric. Values observed: 0 then 1, after manual
  // acceptance in Poster POS by staff — consistent with the original Phase 0 finding, no
  // auto-acceptance behavior (an earlier note here speculating otherwise was incorrect and
  // has been retracted: the order was manually accepted in the real-time gap while diagnostic
  // work was happening between order creation and the status check).
  spot_id?: number; // VERIFIED live: present, numeric
}

// VERIFIED live (2026-09-18, real access.getSpots call): `response` is an array, matching
// official docs (github.com/joinposter/docs, ru/web/access/getSpots.md). Real payload also
// included undocumented fields (`name: null`, `region_id`, `lat`, `lng`, `storages`) — not
// modeled here at all, deliberately: Phase 1 doesn't need them, and modeling unverified extra
// fields would just be inventing structure we have no use for. spot_id is a numeric STRING
// (e.g. "1"), NOT a raw number — unlike incoming_order_id/status above, which ARE raw
// numbers. Poster is simply inconsistent about this across endpoints; never assume, always
// check per-field.
export interface PosterSpot {
  spot_id: string; // VERIFIED live: e.g. "1"
  spot_name: string; // VERIFIED live: e.g. "iwyoqar"
  spot_adress: string; // VERIFIED live field name (Poster's spelling, one "d") — may be "" (empty)
}

// Phase 11 — READ-ONLY clients.getClients (official docs: ru/web/clients/getClients.md; verified live
// 2026-09-20: filtering by the international-format `phone` parameter returns exactly the matching
// client). Only the fields CUP uses are declared. Money-like fields on this object (bonus,
// total_payed_sum, ewallet) are in Poster kopecks and are deliberately NOT read by CUP.
export interface PosterClient {
  client_id: string | number;
  firstname?: string | null;
  lastname?: string | null;
  phone?: string | null;
  phone_number?: string | null; // digits only
  card_number?: string | null;
}

// Phase 11.2 — READ-ONLY dash.getTransactions?include_products=true (official docs: ru/web/dash/getTransactions.md;
// shape inspected live 2026-09-20). Only fields CUP uses are declared; everything arrives as a string except where
// noted. Money-like fields are Poster wire units (see poster-money.ts). NOT used for any decision, on purpose:
// application_id, order_source, auto_accept, processing_status (undocumented by Poster).
export interface PosterTransactionLine {
  product_id: string;
  modification_id?: string;
  num: string; // quantity, e.g. "9.0000000"
  product_price: string; // observed: equals the LINE total for `num` units (undocumented for lines) — stored as-is
  payed_sum: string;
}

export interface PosterTransaction {
  transaction_id: string;
  status: string; // documented: 1 open, 2 closed, 3 deleted
  pay_type: string; // documented: 0 closed without payment, 1 cash, 2 card, 3 mixed
  client_id: string; // documented: 0 = no client
  spot_id: string;
  sum: string;
  payed_sum: string;
  date_close: string; // documented: ms epoch, 0 while open
  // Phase 22 — VERIFIED live (2026-09-22, real open test order, transaction_id 46): present on both
  // dash.getTransactions (list) and dash.getTransaction (singular), ms epoch, identical value and
  // shape to the POS JS API's orders.getActive().order.id / .dateStart. This is the cross-reference
  // key PosterRewardMutationService uses to independently resolve a widget-claimed posterOrderId to
  // a REST transaction_id, without trusting the widget for that mapping.
  date_start?: string;
  application_id?: string | number | null; // UNDOCUMENTED (observed: set on receipts created by CUP's incoming orders). Phase 19 reads it ONLY as a safety hint to SKIP, never to import or attribute.
  products?: PosterTransactionLine[];
}

// Phase 22 — VERIFIED live (2026-09-22, transactions.addTransactionProduct against real open test
// order 46, product 35, price 0): response is {"transaction_product": <number>}, matching docs
// exactly (en/web/transactions/addTransactionProduct.md).
export interface AddTransactionProductInput {
  spot_id: number;
  spot_tablet_id: number;
  transaction_id: number;
  product_id: number;
  price: number; // kopecks/tiyin, same wire unit as everywhere else in Poster's API (see poster-money.ts) — 0 is unit-independent
}

export interface AddTransactionProductRawResponse {
  transaction_product: number;
}

// incomingOrders.getIncomingOrder — only the documented link to the resulting receipt ("Id связанного чека").
export interface PosterIncomingOrderLinkInfo {
  incoming_order_id: string | number;
  transaction_id?: string | number | null;
}

// Reports Phase B1 — dash.getSpotsSales (official docs: en/web/dash/getSpotsSales.md). VERIFIED live (2026-09-24)
// against the real account: `revenue`/`middle_invoice` are ALREADY whole so'm-equivalent units here, NOT the
// raw-kopeck wire format menu.getProducts/dash.getTransactions use elsewhere in this module — poster-money.ts's
// /100 rule does NOT apply to this endpoint. Confirmed by comparing a real week's value (revenue 3,864,509) against
// CUP's own canonical revenue for the identical range (3,635,266 so'm) — the same order of magnitude; dividing by
// 100 would give an implausible ~38,645 so'm for a week of sales at this business. `clients`, despite its name, is
// documented as "Order count" (a receipt count), never a distinct-customer count. `profit`/`profit_netto` exist on
// the real response but are deliberately NOT modeled here: the Reports Phase 1 audit found Poster silently treats a
// product with no configured recipe as zero-cost, making these figures unreliable — nothing in this codebase may
// read or display them.
export interface PosterSpotsSales {
  revenue: number;
  clients: number; // Poster's own field name; documented meaning is ORDER COUNT, not distinct customers
  middle_invoice: number;
}

// Reports Phase B2 — dash.getPaymentsReport (official docs: en/web/dash/getPaymentsReport.md). Documented GET params:
// date_from / date_to (Ymd, inclusive — NOTE the snake_case, unlike dash.getSpotsSales's dateFrom/dateTo) and an
// optional spot_id. Documented response: { days: [...], total: {...} } where every `payed_*_sum` is "in kopecks"
// (days carry numeric STRINGS, total carries NUMBERS in the docs' own example); `days` switches to monthly buckets
// for ranges over 65 days, so CUP reads `total` only. `payed_sum_sum` is Poster's own all-methods total. The docs
// list payed_cash_sum, payed_card_sum, payed_third_party_sum (total only), payed_cert_in_sum, payed_cert_out_sum,
// payed_bonus_sum and payed_incust_sum; any further `payed_*_sum` key the real account returns is kept, never
// dropped or renamed. NOT verified live yet (no Poster credentials in the environment this was written in) —
// PosterReportsService validates every field at runtime instead of trusting this shape.
export type PosterPaymentsReportAmount = number | string;

export interface PosterPaymentsReportTotal {
  payed_sum_sum?: PosterPaymentsReportAmount;
  [key: string]: PosterPaymentsReportAmount | undefined;
}

export interface PosterPaymentsReportRaw {
  days?: ({ date?: string } & Record<string, PosterPaymentsReportAmount | undefined>)[];
  total?: PosterPaymentsReportTotal;
}

// Reports Phase C1 — dash.getProductsSales (official docs: en/web/dash/getProductsSales.md). Documented GET params:
// snake_case date_from/date_to (Ymd, inclusive) + optional spot_id. Response: an ARRAY, one row per product AND
// modification (the same product_id can appear several times). `count` is a decimal string ("171.0000") because
// weight-sold products exist; `payed_sum` is documented "paid ... including discount" in kopecks — the same field name
// and scale as dash.getTransactions's payed_sum, which IS verified live as kopecks (poster-money.ts). The
// product_profit / product_profit_netto fields exist but are deliberately NOT modeled: the Reports audit found Poster
// silently treats a product without a recipe as zero-cost, so nothing in CUP may read them. NOT verified live yet.
export interface PosterProductsSalesRow {
  product_id?: string | number;
  product_name?: string;
  modification_id?: string | number;
  category_id?: string | number;
  count?: string | number;
  payed_sum?: string | number;
  weight_flag?: string | number;
}

// Reports Phase C2 — dash.getCategoriesSales (official docs: en/web/dash/getCategoriesSales.md). Documented GET
// params: camelCase dateFrom/dateTo (Ymd) + optional spot_id — the same convention as dash.getSpotsSales. Response:
// an ARRAY of { category_id, category_name, count, revenue, profit, profit_netto }; category_id 0 is Poster's
// "Главный экран"/top-screen pseudo-category. `revenue` is documented in kopecks, but so is dash.getSpotsSales's
// `revenue`, which was VERIFIED live (Phase B1) to be whole so'm — see PosterReportsService for which scale is used.
// profit / profit_netto are deliberately NOT modeled (same reason as above). NOT verified live yet.
export interface PosterCategoriesSalesRow {
  category_id?: string | number;
  category_name?: string;
  count?: string | number;
  revenue?: string | number;
}

// Reports Phase D2 — dash.getWaitersSales (official docs: en/web/dash/getWaitersSales.md). Documented GET params:
// dateFrom/dateTo (Ymd, inclusive) ONLY — no spot_id, and no branch/spot field in the response, so employee sales
// cannot be split by branch. Response: an ARRAY of { user_id, name, revenue, clients, middle_invoice, profit,
// profit_netto, middle_time, worked_time }. `clients` is documented as "Closed orders count" (a receipt count, not
// customers — the same field dash.getSpotsSales documents as "Order count"). `revenue` is documented in kopecks, but
// dash.getSpotsSales's identically-documented `revenue` was VERIFIED live to be whole so'm (see poster-money.ts's
// posterAnalyticsRevenueToCupUzs). profit / profit_netto / middle_time / worked_time are deliberately NOT modeled.
// NOT verified live yet.
export interface PosterWaiterSalesRow {
  user_id?: string | number;
  name?: string;
  revenue?: string | number;
  clients?: string | number;
}

// Reports Phase D2 — access.getEmployees (official docs: en/web/access/getEmployees.md). Metadata only: user_id,
// name, role_name, user_type. Poster documents NO active/inactive flag for employees. NOT verified live yet.
export interface PosterEmployee {
  user_id?: string | number;
  name?: string;
  role_name?: string;
  user_type?: string | number;
}

// Reports Phase E — finance.getTaxes (official docs: en/web/finance/getTaxes.md). This is Poster's tax CONFIGURATION
// list — { tax_id, tax_name, tax_value (percent), type (1 sales tax, 2 turnover tax, 3 VAT, 4 no tax), fiscal, fixed,
// delete } — with NO date parameters and NO amounts. It therefore cannot answer "how much tax in this period"; CUP
// shows it as Poster's configured taxes only. The docs describe `delete` inconsistently ("0—removed, 1—not removed"),
// so CUP passes the raw flag through without interpreting it. NOT verified live yet.
export interface PosterTaxRow {
  tax_id?: string | number;
  tax_name?: string;
  tax_value?: string | number;
  type?: string | number;
  fiscal?: string | number;
  fixed?: string | number;
  delete?: string | number;
}

// Phase 25 — clients.createClient. CONFIRMED against official docs (github.com/joinposter/docs,
// en/web/clients/createClient.md) AND against a real live create on the development account
// (2026-09-23, disposable test phone +998900000001 -> client_id 3): response is a bare number
// (the created client_id), matching the docs example ({"response":4082}) exactly. Poster's docs
// table doesn't mark any field required, but the live account rejected a create missing either
// `client_name` (error 34: "client_name is empty") or `client_groups_id_client` (error 34: "The
// field «Customer group» must be completed") — both are treated as required here, contrary to
// the docs table, because that's what the real account actually enforces.
export interface CreatePosterClientInput {
  phone: string;
  client_name: string;
  client_groups_id_client: number;
}
