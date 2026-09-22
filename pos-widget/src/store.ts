import { useSyncExternalStore } from 'react';
import { apiConfigured, fetchOverview, redeemPromotion, redeemReward } from './api';
import { isMobile, poster, posterProbe } from './poster';
import type { PosterApi } from './poster';
import type { PosterClient } from './poster';
import type { EligibleRewardProduct, ErrorKind, Identifier, Overview, PosterClientInfo, RedeemPromotionResult, RedeemRewardResult } from './types';

// The widget's whole behaviour, outside React because Poster's events live outside it. Everything is READ-ONLY and NON-BLOCKING:
//   * handlers are registered for non-blocking events only (orderOpen, orderClientChange, applicationIconClicked, notificationClick) and never take a `next`;
//   * the widget never attaches a customer to the order, never touches the order's lines, prices, discounts or payment;
//   * every CUP request carries the (orderId, clientId, generation) it was made for and a response is applied ONLY if that is still the current one.
export type Phase = 'NO_POSTER' | 'IDLE' | 'LOADING' | 'READY' | 'ERROR';

// Phase 22 — the redemption UI is a small phase machine layered ON TOP of the main Ready view, not a replacement of it: it is only ever entered from
// `READY` + `FOUND`, and it deliberately does NOT reset when the order/customer changes mid-flight (see confirmRedeem's comment) — a POST that was
// actually sent must always resolve to a shown result, never be silently dropped the way a stale GET is.
export type RedemptionPhase = 'idle' | 'selecting' | 'confirming' | 'applying' | 'done';

export interface RedemptionUiState {
  phase: RedemptionPhase;
  programId: string | null;
  programName: string | null;
  products: EligibleRewardProduct[]; // populated only when phase is 'selecting' (more than one eligible product)
  selected: EligibleRewardProduct | null;
  result: RedeemRewardResult | null; // set once phase is 'done' and the call completed (any status, including FAILED/UNKNOWN)
  transportError: ErrorKind | null; // set once phase is 'done' and the CALL ITSELF failed (feature off, auth, network) — distinct from a business FAILED/UNKNOWN
}

const redemptionIdle: RedemptionUiState = { phase: 'idle', programId: null, programName: null, products: [], selected: null, result: null, transportError: null };

// Phase 23 — the promotion equivalent of RedemptionUiState. No 'selecting' phase: a promotion's benefit product (if any) is fixed on the record itself,
// never chosen by the cashier — "selecting WHICH promotion" is just the existing promotions list, not a sub-phase of this flow.
export type PromotionRedemptionPhase = 'idle' | 'confirming' | 'applying' | 'done';

export interface PromotionRedemptionUiState {
  phase: PromotionRedemptionPhase;
  promotionId: string | null;
  promotionName: string | null;
  result: RedeemPromotionResult | null;
  transportError: ErrorKind | null;
}

const promotionRedemptionIdle: PromotionRedemptionUiState = { phase: 'idle', promotionId: null, promotionName: null, result: null, transportError: null };

export interface WidgetState {
  phase: Phase;
  source: 'ORDER' | 'MANUAL' | null;
  orderId: number | null;
  clientId: number | null;
  posterClient: PosterClientInfo | null; // from Poster.clients.get / find — shown while CUP loads and when the customer is not linked
  overview: Overview | null;
  error: ErrorKind | null;
  inputError: string | null;
  orderItems: number | null;
  employee: string | null;
  where: string;
  mobile: boolean;
  configured: boolean;
  redemption: RedemptionUiState;
  // Phase 22.2 — ONE POSTER ORDER = MAXIMUM ONE REWARD REDEMPTION. Set to the order id a redemption was confirmed REDEEMED for (or the order id the
  // backend said REWARD_ALREADY_REDEEMED_FOR_ORDER for), so the "Sovg'ani ishlatish" button stays hidden for THIS order even after the result screen is
  // closed — never reset explicitly: comparing it against the CURRENT `orderId` at render time is enough, since a genuinely new order gets a new id.
  // This is UX only; the server is what actually enforces the rule (see pos-widget-reward-redemption.service.ts) — a stale or missing value here can
  // only ever make the button show when it shouldn't (backend rejects it anyway), never let a second redemption actually go through.
  redeemedOrderId: number | null;
  promotionRedemption: PromotionRedemptionUiState;
  // Phase 23 — the promotion equivalent of redeemedOrderId. A SEPARATE field on purpose: a reward AND a promotion may each be redeemed once on the same
  // order (two independent invariants, see pos-widget-promotion-redemption.service.ts).
  redeemedPromotionOrderId: number | null;
}

const initial: WidgetState = {
  phase: 'IDLE',
  source: null,
  orderId: null,
  clientId: null,
  posterClient: null,
  overview: null,
  error: null,
  inputError: null,
  orderItems: null,
  employee: null,
  where: '',
  mobile: false,
  configured: apiConfigured,
  redemption: redemptionIdle,
  redeemedOrderId: null,
  promotionRedemption: promotionRedemptionIdle,
  redeemedPromotionOrderId: null,
};

let state: WidgetState = initial;
let generation = 0; // bumped by EVERY context change; an in-flight response from an older generation is discarded
let lastRequest: (() => void) | null = null;
let lastLoadedAt = 0;
const notified = new Set<string>();
const listeners = new Set<() => void>();

const set = (patch: Partial<WidgetState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};
export const getState = () => state;
export const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export const useWidget = (): WidgetState => useSyncExternalStore(subscribe, getState, getState);

const nameOf = (c: PosterClient): PosterClientInfo => ({ id: Number(c.id), name: [c.firstname, c.lastname].filter(Boolean).join(' ').trim() || `Poster #${c.id}`, phone: c.phone ?? null });
const refOf = (gen: number) => `${state.orderId ?? 'x'}.${state.clientId ?? 'm'}.${gen}`;
const safe = <T>(fn: () => T): T | undefined => {
  try {
    return fn();
  } catch {
    return undefined; // a widget failure must never surface in Poster
  }
};

// A redemption POST that is actually in flight must always resolve to a shown result (see the module comment above RedemptionUiState) — every other
// context change resets the redemption panel back to idle, but never while 'applying'.
const nextRedemption = (): RedemptionUiState => (state.redemption.phase === 'applying' ? state.redemption : redemptionIdle);
const nextPromotionRedemption = (): PromotionRedemptionUiState => (state.promotionRedemption.phase === 'applying' ? state.promotionRedemption : promotionRedemptionIdle);

// ---- context changes ---------------------------------------------------------------------------------------------------

// The customer on the order changed (or was removed): drop EVERYTHING about the previous customer immediately, so old data can never be shown for the new one.
function resetTo(patch: Partial<WidgetState>) {
  generation += 1;
  lastRequest = null;
  set({ phase: 'IDLE', source: null, overview: null, error: null, inputError: null, posterClient: null, redemption: nextRedemption(), promotionRedemption: nextPromotionRedemption(), ...patch });
}

function loadForOrderCustomer(orderId: number | null, clientId: number) {
  generation += 1;
  const gen = generation;
  set({ phase: 'LOADING', source: 'ORDER', orderId, clientId, overview: null, error: null, inputError: null, posterClient: null, redemption: nextRedemption(), promotionRedemption: nextPromotionRedemption() });
  const run = () => {
    const my = ++generation; // a Retry is a new generation too
    set({ phase: 'LOADING', error: null });
    void requestOverview(my, { posterClientId: String(clientId) }, 'ORDER');
    void loadPosterClient(my, clientId);
  };
  lastRequest = run;
  void requestOverview(gen, { posterClientId: String(clientId) }, 'ORDER');
  void loadPosterClient(gen, clientId);
}

async function loadPosterClient(gen: number, clientId: number) {
  const p = poster();
  if (!p) return;
  try {
    const c = await p.clients.get(clientId);
    if (gen !== generation || !c) return; // stale, or Poster has no such customer
    set({ posterClient: nameOf(c) });
  } catch {
    /* the Poster name is a convenience; CUP data does not depend on it */
  }
}

async function requestOverview(gen: number, id: Identifier, source: 'ORDER' | 'MANUAL'): Promise<void> {
  const ref = refOf(gen);
  const result = await fetchOverview(id, ref);
  if (gen !== generation) return; // STALE: the order / customer changed while this was in flight
  if (result.kind === 'ERROR') return set({ phase: 'ERROR', error: result.error, overview: null });
  if (result.overview.ref !== ref) return; // the server echoes our ref; anything else is not the response to this request
  lastLoadedAt = Date.now();
  set({ phase: 'READY', overview: result.overview, error: null });
  if (source === 'ORDER') maybeNotify(result.overview);
}

// A non-blocking notification when the customer has an actionable reward. Once per (order, customer, amount); clicking it opens the popup.
function maybeNotify(o: Overview) {
  if (o.state !== 'FOUND' || !o.rewards || o.rewards.availableTotal < 1) return;
  const key = `${state.orderId}:${state.clientId}:${o.rewards.availableTotal}`;
  if (notified.has(key)) return;
  notified.add(key);
  const program = o.rewards.programs.find((p) => p.available > 0);
  safe(() => {
    void poster()?.interface.showNotification({ title: `CUP · ${o.customer?.displayName ?? 'Mijoz'}`, message: `${o.rewards!.availableTotal} ta bepul mahsulot mavjud${program ? ` (${program.name})` : ''}` });
  });
}

// ---- Poster events ------------------------------------------------------------------------------------------------------

// Poster does not document what the event payload carries, so it is only a trigger and a fallback: the ACTIVE ORDER (Poster.orders.getActive()) is the authority
// for orderId + clientId. `changeSeq` makes a newer change supersede an older one that is still waiting for getActive(), so an old answer can never win.
let changeSeq = 0;
async function onOrderClientChange(data: { clientId?: number | string; orderId?: number | string } | undefined) {
  const seq = ++changeSeq;
  let orderId = data?.orderId !== undefined ? Number(data.orderId) : state.orderId;
  let clientId = data?.clientId !== undefined ? Number(data.clientId) : Number.NaN; // NaN = the event did not say
  if (clientId === 0) resetTo({ phase: 'IDLE', orderId, clientId: null, source: null }); // customer removed: drop the old context right away, no CUP call
  else {
    // the customer changed: whatever is in flight for the previous one is now stale, and the old card must not stay on screen while the new one is resolved
    generation += 1;
    lastRequest = null;
    set({ phase: 'LOADING', source: 'ORDER', overview: null, error: null, inputError: null, posterClient: null, redemption: nextRedemption(), promotionRedemption: nextPromotionRedemption() });
  }
  try {
    const active = await poster()?.orders.getActive();
    if (seq !== changeSeq) return; // a newer change superseded this one
    if (active?.order) {
      orderId = Number(active.order.id);
      clientId = Number(active.order.clientId ?? 0);
    }
  } catch {
    if (seq !== changeSeq) return; // getActive unavailable: fall back to what the event said
  }
  if (Number.isNaN(clientId)) return resetTo({ phase: 'IDLE', orderId: Number.isNaN(orderId) ? state.orderId : orderId, clientId: null, source: null }); // nobody says who the customer is: never guess, never call CUP with a stale identity
  if (!clientId) return resetTo({ phase: 'IDLE', orderId: Number.isNaN(orderId) ? state.orderId : orderId, clientId: null, source: null });
  loadForOrderCustomer(Number.isNaN(orderId) ? state.orderId : orderId, clientId);
}

function onOrderOpen(data: { order?: { id?: number } } | { id?: number } | undefined) {
  changeSeq += 1;
  const id = (data as { order?: { id?: number } })?.order?.id ?? (data as { id?: number })?.id ?? null;
  resetTo({ phase: 'IDLE', orderId: id === null ? null : Number(id), clientId: null, orderItems: null });
  void syncFromOrder(); // a reopened order may already have a customer attached
}

function openPopup() {
  safe(() => poster()?.interface.popup({ width: 520, height: 600, title: 'CUP' }));
}

// Reads the current order (documented: only on the order / payment screens), refreshes the customer if the popup is opened on a different / older context.
async function syncFromOrder(): Promise<void> {
  const p = poster();
  if (!p) return;
  try {
    const { order } = await p.orders.getActive();
    if (!order) return; // not on an order screen: keep whatever the widget shows
    const items = Array.isArray(order.products) ? order.products.length : order.products ? Object.values(order.products).reduce((n, x) => n + Number((x as { count?: number })?.count ?? 0), 0) : 0;
    const clientId = Number(order.clientId ?? 0);
    set({ orderItems: items });
    if (!clientId) {
      if (state.source === 'ORDER') resetTo({ phase: 'IDLE', orderId: Number(order.id), clientId: null, orderItems: items });
      else set({ orderId: Number(order.id) });
      return;
    }
    const same = state.source === 'ORDER' && state.orderId === Number(order.id) && state.clientId === clientId;
    if (same && state.phase === 'READY' && Date.now() - lastLoadedAt < 20_000) return; // fresh enough; reward availability is never shown older than 20 s
    loadForOrderCustomer(Number(order.id), clientId);
  } catch {
    /* Poster context unavailable: the popup still opens with what it has */
  }
}

function onIconOrNotification() {
  openPopup();
  void syncFromOrder();
}

// ---- manual lookup (fallback when no customer is on the order) -----------------------------------------------------------

export function lookup(raw: string) {
  const text = raw.trim();
  if (!text) return set({ inputError: 'CUP kodi yoki telefon raqamini kiriting.' });
  const digits = text.replace(/\D/g, '');
  const id: Identifier | null = /[A-Za-z]/.test(text) ? { code: text } : digits.length >= 9 ? { phone: text } : null;
  if (!id) return set({ inputError: 'Telefon raqami kamida 9 ta raqamdan iborat bo‘lishi kerak.' });
  generation += 1;
  const gen = generation;
  set({ phase: 'LOADING', source: 'MANUAL', clientId: null, overview: null, error: null, inputError: null, posterClient: null });
  lastRequest = () => lookup(raw);
  void (async () => {
    const ref = refOf(gen);
    const first = await fetchOverview(id, ref);
    if (gen !== generation) return;
    if (first.kind === 'ERROR') return set({ phase: 'ERROR', error: first.error });
    if (first.overview.ref !== ref) return;
    // Typed phone unknown to CUP: is it a POSTER customer? (Poster's own search — read-only.) If so, ask CUP about that Poster customer instead: FOUND when CUP has
    // an explicit link to it, NOT_LINKED otherwise. Nothing is attached to the order and no customer is created.
    if (first.overview.state === 'NOT_FOUND' && 'phone' in id) {
      const found = await poster()?.clients.find({ searchVal: digits }).catch(() => null);
      if (gen !== generation) return;
      const c = found?.foundClients?.[0] ?? found?.foundByCard?.[0];
      if (c) {
        set({ posterClient: nameOf(c) });
        const second = await fetchOverview({ posterClientId: String(c.id) }, refOf(gen));
        if (gen !== generation) return;
        if (second.kind === 'ERROR') return set({ phase: 'ERROR', error: second.error });
        if (second.overview.ref !== refOf(gen)) return;
        lastLoadedAt = Date.now();
        return set({ phase: 'READY', overview: second.overview });
      }
    }
    lastLoadedAt = Date.now();
    set({ phase: 'READY', overview: first.overview });
  })();
}

export function scan() {
  const p = poster();
  if (!p || !isMobile()) return;
  void p.interface
    .scanBarcode()
    .then((r) => {
      if (r && r.barcode) lookup(r.barcode);
    })
    .catch(() => set({ inputError: 'Skaner ishlamadi. Kodni qo‘lda kiriting.' }));
}

export function retry() {
  if (lastRequest) lastRequest();
}

export function clearManual() {
  resetTo({ phase: 'IDLE', clientId: state.source === 'ORDER' ? state.clientId : null });
}

// ---- reward redemption (Phase 22) ---------------------------------------------------------------------------------------

// A widget-generated idempotency key, one per confirm press. crypto.randomUUID() is the normal path; the fallback (crypto.getRandomValues, then Math.random
// as a last resort for a very old webview) still produces something matching the backend's `^[A-Za-z0-9_-]{8,64}$`.
function newAttemptId(): string {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    }
  } catch {
    /* fall through */
  }
  return `fallback-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// Only ever offered from the READY + FOUND view (see App.tsx), so state.orderId/clientId are the live order's — never a manual-lookup context (which has
// no order to redeem onto at all).
export function startRedeem(programId: string, programName: string, products: EligibleRewardProduct[]) {
  if (products.length === 1) {
    set({ redemption: { phase: 'confirming', programId, programName, products: [], selected: products[0], result: null, transportError: null } });
    return;
  }
  set({ redemption: { phase: 'selecting', programId, programName, products, selected: null, result: null, transportError: null } });
}

export function selectRewardProduct(product: EligibleRewardProduct) {
  if (state.redemption.phase !== 'selecting') return;
  set({ redemption: { ...state.redemption, phase: 'confirming', selected: product } });
}

export function cancelRedeem() {
  if (state.redemption.phase === 'applying') return; // a request already in flight cannot be cancelled from here — see nextRedemption()
  set({ redemption: redemptionIdle });
}

// Fires the ONE write request this widget makes. Captures the order/customer identity and the reward's own generation-tied `ref` semantics are not
// reused here on purpose: a redemption is not a stale-discardable read (see the module comment on RedemptionUiState) — once sent, its result is always
// shown, however the surrounding order/customer state moves on in the meantime.
export function confirmRedeem() {
  const r = state.redemption;
  if (r.phase !== 'confirming' || !r.programId || !r.selected) return;
  if (state.source !== 'ORDER' || state.orderId === null || state.clientId === null) return;
  const attemptId = newAttemptId();
  const capturedOrderId = state.orderId; // Phase 22.2: the order this specific attempt is FOR, captured before anything can change it
  const posterOrderId = String(capturedOrderId);
  const posterClientId = String(state.clientId);
  const posterProductId = r.selected.posterProductId;
  const programId = r.programId;
  set({ redemption: { ...r, phase: 'applying' } });
  void (async () => {
    const res = await redeemReward({ attemptId, posterClientId, posterOrderId, rewardProgramId: programId, posterProductId, employeeIdentifier: state.employee });
    if (res.kind === 'ERROR') {
      set({ redemption: { ...state.redemption, phase: 'done', transportError: res.error, result: null } });
      return;
    }
    // Phase 22.2: once this order is known (to us, or per the server) to have used its one reward, remember it by order id — see the WidgetState
    // comment. This is set regardless of whether THIS click is what redeemed it (REWARD_ALREADY_REDEEMED_FOR_ORDER means some other click already did).
    if (res.result.status === 'REDEEMED' || res.result.failureReason === 'REWARD_ALREADY_REDEEMED_FOR_ORDER') {
      set({ redeemedOrderId: capturedOrderId });
    }
    set({ redemption: { ...state.redemption, phase: 'done', result: res.result, transportError: null } });
    // Refresh the reward/loyalty figures shown behind the result — read-only, and only if this order/customer is still the one on screen (skip silently
    // otherwise: the redemption result itself is unaffected either way, and a stale refresh must never overwrite whatever the NEW context is showing).
    if (state.source === 'ORDER' && String(state.orderId) === posterOrderId && String(state.clientId) === posterClientId) {
      const gen = ++generation;
      void requestOverview(gen, { posterClientId }, 'ORDER');
    }
  })();
}

export function closeRedemption() {
  if (state.redemption.phase === 'applying') return;
  set({ redemption: redemptionIdle });
}

// ---- promotion redemption (Phase 23) ------------------------------------------------------------------------------------

// Only ever offered from the READY + FOUND view, same as startRedeem — state.orderId/clientId are the live order's.
export function startPromotionRedeem(promotionId: string, promotionName: string) {
  set({ promotionRedemption: { phase: 'confirming', promotionId, promotionName, result: null, transportError: null } });
}

export function cancelPromotionRedeem() {
  if (state.promotionRedemption.phase === 'applying') return;
  set({ promotionRedemption: promotionRedemptionIdle });
}

// Mirrors confirmRedeem exactly — see its comment for why the order/customer identity is captured up front and the result is always shown regardless
// of what the surrounding context does in the meantime.
export function confirmPromotionRedeem() {
  const r = state.promotionRedemption;
  if (r.phase !== 'confirming' || !r.promotionId) return;
  if (state.source !== 'ORDER' || state.orderId === null || state.clientId === null) return;
  const attemptId = newAttemptId();
  const capturedOrderId = state.orderId;
  const posterOrderId = String(capturedOrderId);
  const posterClientId = String(state.clientId);
  const promotionId = r.promotionId;
  set({ promotionRedemption: { ...r, phase: 'applying' } });
  void (async () => {
    const res = await redeemPromotion({ attemptId, posterClientId, posterOrderId, promotionId, employeeIdentifier: state.employee });
    if (res.kind === 'ERROR') {
      set({ promotionRedemption: { ...state.promotionRedemption, phase: 'done', transportError: res.error, result: null } });
      return;
    }
    // Phase 23: same "remember by order id" rule as rewards (Phase 22.2), in its own field — a reward AND a promotion may each be used once on the
    // same order, so this must never share state with redeemedOrderId.
    if (res.result.status === 'REDEEMED' || res.result.failureReason === 'PROMOTION_ALREADY_REDEEMED_FOR_ORDER') {
      set({ redeemedPromotionOrderId: capturedOrderId });
    }
    set({ promotionRedemption: { ...state.promotionRedemption, phase: 'done', result: res.result, transportError: null } });
    if (state.source === 'ORDER' && String(state.orderId) === posterOrderId && String(state.clientId) === posterClientId) {
      const gen = ++generation;
      void requestOverview(gen, { posterClientId }, 'ORDER');
    }
  })();
}

export function closePromotionRedemption() {
  if (state.promotionRedemption.phase === 'applying') return;
  set({ promotionRedemption: promotionRedemptionIdle });
}

// ---- start -------------------------------------------------------------------------------------------------------------

// Initialisation is a set of idempotent STEPS, each marked done only after it succeeded. Poster documents no "ready" event and its own example calls the API synchronously
// while the bundle runs, so the normal case is: everything succeeds on the first pass. If Poster is not readable yet (or a step throws) nothing is latched: the missing steps are
// retried on a bounded timer, and every failure is reported with console.error (TEMPORARY DIAGNOSTIC for the first real-POS runs) instead of being swallowed. A step that
// succeeded is never run again, so subscriptions are registered exactly once.
type InitStep = { name: string; run: (p: PosterApi) => unknown };

const initSteps: InitStep[] = [
  {
    name: 'settings',
    run: (p) => {
      const s = p.settings;
      set({ mobile: isMobile(), where: [s?.accountUrl, s?.spotId ? `spot ${s.spotId}` : null, s?.spotTabletId ? `kassa ${s.spotTabletId}` : null].filter(Boolean).join(' · ') });
    },
  },
  // The argument shape is Poster's documented one ({ order, functions }) and must not change.
  { name: 'interface.showApplicationIconAt', run: (p) => p.interface.showApplicationIconAt({ order: 'CUP', functions: 'CUP' }) },
  // Non-blocking events ONLY. (The blocking `before*` events are deliberately never subscribed: a widget must not be able to hold up a checkout.)
  { name: 'on(orderClientChange)', run: (p) => p.on('orderClientChange', (d) => safe(() => onOrderClientChange(d))) },
  { name: 'on(orderOpen)', run: (p) => p.on('orderOpen', (d) => safe(() => onOrderOpen(d))) },
  { name: 'on(applicationIconClicked)', run: (p) => p.on('applicationIconClicked', () => safe(onIconOrNotification)) },
  { name: 'on(notificationClick)', run: (p) => p.on('notificationClick', () => safe(onIconOrNotification)) },
  { name: 'users.getActiveUser', run: (p) => p.users.getActiveUser().then((u) => u && set({ employee: u.name ?? null })) },
];

const INIT_FAST_RETRIES = 40; // 250 ms apart (10 s), then 1 s apart ...
const INIT_MAX_ATTEMPTS = 340; // ... for about 5 minutes in total, then give up (loudly)
const initDone = new Set<string>();
let initAttempts = 0;
let initTimer: ReturnType<typeof setTimeout> | null = null;
let initSynced = false;

const isThenable = (v: unknown): v is PromiseLike<unknown> => !!v && typeof (v as { then?: unknown }).then === 'function';

function scheduleInitRetry(): void {
  if (initTimer !== null) return;
  if (initAttempts >= INIT_MAX_ATTEMPTS) {
    console.error('[CUP widget] Poster initialisation gave up after', initAttempts, 'attempts. Missing steps:', initSteps.filter((s) => !initDone.has(s.name)).map((s) => s.name), posterProbe());
    return;
  }
  initTimer = setTimeout(() => {
    initTimer = null;
    start();
  }, initAttempts < INIT_FAST_RETRIES ? 250 : 1000);
}

export function start(): void {
  initAttempts += 1;
  const p = poster();
  if (!p) {
    if (initAttempts === 1 || initAttempts % 40 === 0) console.error('[CUP widget] Poster API is not available yet (attempt ' + initAttempts + '); will retry.', posterProbe());
    if (state.phase !== 'NO_POSTER') set({ phase: 'NO_POSTER' });
    return scheduleInitRetry();
  }
  if (initDone.size === 0) console.info('[CUP widget] Poster API found (attempt ' + initAttempts + ').', posterProbe()); // TEMPORARY DIAGNOSTIC
  if (state.phase === 'NO_POSTER') set({ phase: 'IDLE' });

  let failed = false;
  for (const step of initSteps) {
    if (initDone.has(step.name)) continue;
    try {
      const result = step.run(p);
      initDone.add(step.name);
      // Some Poster calls may answer with a promise: a rejection is a failure to report, not to swallow. (It is not retried: the call itself was accepted.)
      if (isThenable(result)) result.then(undefined, (err: unknown) => console.error('[CUP widget] Poster init step rejected:', step.name, err));
    } catch (err) {
      failed = true;
      console.error('[CUP widget] Poster init step failed:', step.name, '(attempt ' + initAttempts + ')', err);
    }
  }
  if (!initSynced) {
    initSynced = true;
    void syncFromOrder(); // the widget may be (re)loaded while an order is already open
  }
  if (failed) scheduleInitRetry();
  else if (initAttempts > 1) console.info('[CUP widget] Poster initialisation completed on attempt ' + initAttempts + '.'); // TEMPORARY DIAGNOSTIC
}
