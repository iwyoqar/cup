import type { ErrorKind } from './types';

// The ONLY door to the Poster POS JS API. It types exactly the documented calls Phase 21 is allowed to make, so anything else — Poster.makeApiRequest, any
// Poster.orders.* mutation (addProduct, changeProductCount, setOrderClient, setOrderBonus, setOrderComment, create, closeOrder), Poster.clients.create — is not
// even expressible in this codebase (it would not compile). No `before*` event is declared either: the widget must never be able to hold up a checkout.
//
// Documented at https://dev.joinposter.com/en/docs/v3/pos/ (events, orders/getActive, clients/get|find, interface/*, users/getActiveUser, settings, environment,
// requests/makeRequest). Field names below are the ones those pages state; nothing is guessed.
export interface PosterOrder {
  id: number;
  clientId?: number | string;
  products?: Record<string, { count?: number }> | unknown[];
  total?: number;
}
export interface PosterClient {
  id: number;
  firstname?: string;
  lastname?: string;
  phone?: string;
  cardNumber?: string;
}
export interface PosterNotification {
  title: string;
  message: string;
}
export type PosterEventName = 'orderClientChange' | 'orderOpen' | 'applicationIconClicked' | 'notificationClick';

export interface PosterApi {
  on(event: PosterEventName, handler: (data: any) => void): void;
  // Phase 22 widens this to allow 'post' + a `data` body (Poster's own documented shape for makeRequest — see requests/makeRequest.md), for the ONE new
  // outbound call this bundle makes: POST to our own backend's /pos-widget/rewards/redeem. This does NOT add any Poster order-mutation capability: it is
  // still the exact same proxied HTTP call to OUR server that GET already used, just with a method and a body. `orders.*` below is unchanged.
  makeRequest(url: string, options: { method?: 'get' | 'post'; headers?: string[]; data?: unknown; timeout?: number }, callback: (answer: { result: unknown; code: number } | false) => void): void;
  orders: { getActive(): Promise<{ order?: PosterOrder }> };
  clients: {
    get(id: number): Promise<PosterClient | false>;
    find(request: { searchVal: string }): Promise<{ foundClients?: PosterClient[]; foundByCard?: PosterClient[] }>;
  };
  users: { getActiveUser(): Promise<{ id?: number; name?: string } | false> };
  interface: {
    popup(options: { width: number; height: number; title: string }): void;
    closePopup(): void;
    showApplicationIconAt(places: { order?: string; functions?: string }): void;
    showNotification(notification: PosterNotification): Promise<unknown>;
    scanBarcode(): Promise<{ barcode: string }>;
  };
  settings?: { accountUrl?: string; spotId?: number | string; spotTabletId?: number | string };
  environment?: { android?: boolean; iOS?: boolean; windows?: boolean; desktop?: boolean };
}

declare global {
  interface Window {
    Poster?: PosterApi;
  }
}

// Poster's own reference code (joinposter/pos-platform-boilerplate: ESLint `globals: { Poster: true }`, examples/hello-world/app.jsx) reaches the API through the BARE global
// identifier `Poster`, never through `window.Poster`. The two are the same only if Poster is a property of the window object; a top-level lexical binding, or a variable
// injected into the scope the bundle is evaluated in, is visible to the bare identifier and NOT to `window.Poster`. So the bare identifier is resolved first (`typeof` never
// throws for an undeclared name; the try/catch covers a lexical global that is still in its temporal dead zone) and `window.Poster` stays as the fallback.
declare const Poster: PosterApi | undefined;

export const poster = (): PosterApi | null => {
  try {
    if (typeof Poster !== 'undefined' && Poster) return Poster;
  } catch {
    /* not (yet) readable as a bare identifier: fall through to window */
  }
  return typeof window !== 'undefined' && window.Poster ? window.Poster : null;
};

// TEMPORARY DIAGNOSTIC (Phase 21 real-POS run): what this bundle can actually see, so the console shows WHY Poster was or was not found.
export const posterProbe = (): Record<string, unknown> => {
  const probe: Record<string, unknown> = {};
  try {
    probe.bareIdentifier = typeof Poster;
  } catch (err) {
    probe.bareIdentifier = `threw: ${String(err)}`;
  }
  probe.windowPoster = typeof window !== 'undefined' ? typeof window.Poster : 'no window';
  probe.readyState = typeof document !== 'undefined' ? document.readyState : 'no document';
  try {
    probe.inIframe = window.self !== window.top;
  } catch {
    probe.inIframe = 'cross-origin parent';
  }
  probe.origin = typeof location !== 'undefined' ? location.origin : null;
  return probe;
};

export const isMobile = (): boolean => !!(poster()?.environment?.android || poster()?.environment?.iOS);

const REQUEST_TIMEOUT_MS = 8000;
// Phase 27.2 — VERIFIED LIVE (2026-09-23): a real reward redemption confirmed REDEEMED server-side in 4.2s, but the round trip through Poster's own
// proxy on top of that occasionally exceeds REQUEST_TIMEOUT_MS, so the widget reported a transport timeout to the barista even though the backend had
// already succeeded (mutation + RewardRedemption both correct; the money/data were never wrong, only what the barista saw). Root cause: applyToOrder()
// makes up to THREE sequential Poster REST calls (list open transactions, add the product, re-verify), each with its own PosterService-side 10s budget
// — a worst case near 30s, well past this file's original single-hop GET timeout. The redeem/promote calls get their own longer budget; the plain GET
// overview call (genuinely one hop) keeps the original, tighter one.
const REDEEM_REQUEST_TIMEOUT_MS = 35000;

// Poster documents `makeRequest`'s `result` only as "Response body" (its sibling `makeApiRequest` is the one documented to JSON.parse the response), so the real POS may hand
// over the parsed object OR the raw JSON text. Both are accepted; anything else is "not readable" (undefined), never a crash. Content is never logged, only its shape.
const bodyOf = (raw: unknown): unknown => {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
};

// TEMPORARY DIAGNOSTIC: what shape Poster's makeRequest answer really has (once for the first answer, then only when it is not a plain 200 + readable object).
let answerShapeLogged = false;
function noteAnswerShape(code: number, result: unknown): void {
  const shape = { code, resultType: result === null ? 'null' : Array.isArray(result) ? 'array' : typeof result, resultLength: typeof result === 'string' ? result.length : undefined, parsesAsJson: typeof result === 'string' ? bodyOf(result) !== undefined : undefined };
  if (!answerShapeLogged) {
    answerShapeLogged = true;
    console.info('[CUP widget] first makeRequest answer:', shape);
  } else if (code !== 200 || result === false) {
    console.error('[CUP widget] makeRequest answer was not a plain 200:', shape);
  }
}

export type CupResponse = { kind: 'OK'; body: unknown } | { kind: 'ERROR'; error: ErrorKind };

// Shared by cupGet and cupPost: the SAME response-code mapping either way (Poster's answer shape is documented once, for makeRequest generally — nothing
// here is GET- or POST-specific). Extracted so the two call sites can never silently diverge in how they read an answer.
function settleAnswer(answer: { result: unknown; code: number } | false): CupResponse {
  if (!answer) return { kind: 'ERROR', error: 'UNAVAILABLE' };
  const code = Number(answer.code);
  noteAnswerShape(code, answer.result); // TEMPORARY DIAGNOSTIC (first real-POS runs)
  if (code === 200 && answer.result !== false) {
    const body = bodyOf(answer.result);
    if (body !== null && typeof body === 'object') return { kind: 'OK', body };
    return { kind: 'ERROR', error: 'INVALID' }; // 200, but the body is not a JSON object we can read
  }
  if (code === 0) return { kind: 'ERROR', error: 'TIMEOUT' }; // documented: 0 = timeout
  if (code === 1) return { kind: 'ERROR', error: 'INVALID' }; // documented: 1 = invalid JSON
  if (code === 401) return { kind: 'ERROR', error: 'UNAUTHORIZED' };
  if (code === 403) return { kind: 'ERROR', error: 'FORBIDDEN' };
  if (code === 400) return { kind: 'ERROR', error: 'BAD_REQUEST' };
  const errBody = bodyOf(answer.result);
  if (code === 503 && errBody && typeof errBody === 'object' && (errBody as { enabled?: boolean }).enabled === false) return { kind: 'ERROR', error: 'DISABLED' };
  return { kind: 'ERROR', error: 'UNAVAILABLE' };
}

// The shared call boilerplate: it always settles (Poster's own timeout is passed, and an independent timer covers a callback that never fires), and
// nothing thrown here can reach Poster's UI.
function callPoster(url: string, options: { method?: 'get' | 'post'; headers?: string[]; data?: unknown; timeout?: number }): Promise<CupResponse> {
  return new Promise((resolve) => {
    const p = poster();
    if (!p) return resolve({ kind: 'ERROR', error: 'UNAVAILABLE' });
    let settled = false;
    const done = (r: CupResponse) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(r);
    };
    // Phase 27.2 — REAL BUG FOUND LIVE: this independent watchdog was hardcoded to the single (short) REQUEST_TIMEOUT_MS + 2000 regardless of what
    // `options.timeout` actually asked Poster for, so a redeem call (already given a longer budget above) could still be given up on LOCALLY well before
    // that budget elapsed — exactly what happened during live verification: the backend confirmed REDEEMED in 4.2s, but the full round trip through
    // Poster's own proxy pushed just past this timer's old fixed 10s, so the widget reported a transport timeout for an attempt that had already
    // succeeded. Now derived from the SAME timeout the caller actually requested, plus the same 2s margin for Poster's own callback overhead.
    const timer = window.setTimeout(() => done({ kind: 'ERROR', error: 'TIMEOUT' }), (options.timeout ?? REQUEST_TIMEOUT_MS) + 2000);
    try {
      p.makeRequest(url, options, (answer) => done(settleAnswer(answer)));
    } catch {
      done({ kind: 'ERROR', error: 'UNAVAILABLE' });
    }
  });
}

// A GET to the CUP backend THROUGH Poster (Poster.makeRequest is proxied by Poster's servers, which is also what signs the request).
export function cupGet(url: string): Promise<CupResponse> {
  return callPoster(url, { method: 'get', headers: ['Accept: application/json'], timeout: REQUEST_TIMEOUT_MS });
}

// Phase 22 — a POST to the CUP backend THROUGH Poster, for the write calls this bundle makes (rewards/redeem, promotions/redeem). Same signed proxy,
// same response handling; the ONLY difference from cupGet is `method: 'post'`, a JSON `data` body, and — Phase 27.2 — a longer client-side timeout
// (REDEEM_REQUEST_TIMEOUT_MS, see its own comment above), since these two calls are the only ones that trigger a real, multi-hop Poster mutation on our
// backend. Whether Poster's real POST signs that body the way our backend expects is UNVERIFIED (docs/PHASE-22-AUDIT.md §7) — this function does not and
// cannot change that; it only sends the documented shape.
export function cupPost(url: string, data: unknown): Promise<CupResponse> {
  return callPoster(url, { method: 'post', headers: ['Accept: application/json', 'Content-Type: application/json'], data, timeout: REDEEM_REQUEST_TIMEOUT_MS });
}
