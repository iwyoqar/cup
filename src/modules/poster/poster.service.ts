import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../../common/config/config.service';
import { PosterAmbiguousError, PosterDefiniteError } from './poster.errors';
import {
  AddTransactionProductInput,
  AddTransactionProductRawResponse,
  CreatePosterClientInput,
  CreatePosterOrderInput,
  CreatePosterOrderRawResponse,
  PosterApiErrorEnvelope,
  PosterApiSuccessEnvelope,
  PosterCategory,
  PosterClient,
  PosterIncomingOrder,
  PosterIncomingOrderLinkInfo,
  PosterProduct,
  PosterSpot,
  PosterTransaction,
} from './poster.types';

export type PosterCreateOrderOutcome =
  | { kind: 'success'; incomingOrderId: string }
  | { kind: 'definite_failure'; reason: string }
  | { kind: 'ambiguous_failure'; reason: string };

// Phase 22 — mirrors PosterCreateOrderOutcome's shape exactly, on purpose: this is a second real
// Poster mutation, and it gets the same definite-vs-ambiguous discipline as createOrder, not a
// bespoke one-off.
export type PosterAddTransactionProductOutcome =
  | { kind: 'success'; transactionProductId: number }
  | { kind: 'definite_failure'; reason: string }
  | { kind: 'ambiguous_failure'; reason: string };

// Phase 25 — a third real Poster mutation, same definite-vs-ambiguous discipline as the two above.
export type PosterCreateClientOutcome =
  | { kind: 'success'; clientId: string }
  | { kind: 'definite_failure'; reason: string }
  | { kind: 'ambiguous_failure'; reason: string };

const REQUEST_TIMEOUT_MS = 10_000;

// The ONLY class in the codebase allowed to make an HTTP request to Poster, or to hold the
// Poster API token. Every other module depends on the typed methods below, never on raw
// HTTP or the token itself. See docs/PHASE-0-PLAN.md section 6.
@Injectable()
export class PosterService {
  private readonly logger = new Logger(PosterService.name);

  constructor(private readonly config: ConfigService) {}

  async getCategories(): Promise<PosterCategory[]> {
    return this.get<PosterCategory[]>('menu.getCategories');
  }

  async getProducts(): Promise<PosterProduct[]> {
    return this.get<PosterProduct[]>('menu.getProducts');
  }

  // Phase 11 — READ-ONLY. Poster requires the phone in international format ("+998..."). The caller
  // (PosterClientsService) still verifies every returned row itself rather than trusting the filter.
  async getClientsByPhone(internationalPhone: string): Promise<PosterClient[]> {
    const raw = await this.get<unknown>('clients.getClients', { phone: internationalPhone });
    return Array.isArray(raw) ? (raw as PosterClient[]) : [];
  }

  // Phase 25 — VERIFIED live (2026-09-23) against the real development account: response is the
  // created client_id as a bare number, unwrapped by execute() the same way as every other Poster
  // method. See poster.types.ts for the fields the live account actually requires.
  async createClient(input: CreatePosterClientInput): Promise<PosterCreateClientOutcome> {
    try {
      const raw = await this.post<unknown>('clients.createClient', input);
      if (typeof raw !== 'number' && typeof raw !== 'string') {
        return { kind: 'ambiguous_failure', reason: `Unexpected createClient response shape: ${JSON.stringify(raw)}` };
      }
      return { kind: 'success', clientId: String(raw) };
    } catch (err) {
      if (err instanceof PosterDefiniteError) {
        return { kind: 'definite_failure', reason: err.message };
      }
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(`createClient ambiguous outcome: ${reason}`);
      return { kind: 'ambiguous_failure', reason };
    }
  }

  // Phase 11.2 — READ-ONLY. Closed receipts (status=2) with their product lines for an inclusive account-date range
  // (Ymd, e.g. "20260919"). One request for the whole window; the caller bounds the window and the row count.
  // Phase 20 hardening: `nextTr` is the documented cursor — verified live to return only transactions whose id is GREATER than it (0 = from the start; a cursor past the
  // end gives an empty list). Used by the checkpoint reconciliation to page through a window without assuming Poster's response size is unlimited.
  async getClosedTransactions(dateFrom: string, dateTo: string, nextTr?: number): Promise<PosterTransaction[]> {
    const raw = await this.get<unknown>('dash.getTransactions', { dateFrom, dateTo, status: '2', include_products: 'true', ...(nextTr !== undefined ? { next_tr: String(nextTr) } : {}) });
    return Array.isArray(raw) ? (raw as PosterTransaction[]) : [];
  }

  // Phase 20 — READ-ONLY. One transaction by id with its product lines (documented dash.getTransaction: the response is an ARRAY holding the single
  // transaction; an unknown id gives an empty array). status 0 = every status, so an open / closed / removed receipt is all returned.
  async getTransactionById(transactionId: string): Promise<PosterTransaction | null> {
    const raw = await this.get<unknown>('dash.getTransaction', { transaction_id: transactionId, include_products: 'true', status: '0' });
    const first = Array.isArray(raw) ? raw[0] : raw;
    return first && typeof first === 'object' && 'transaction_id' in (first as object) ? (first as PosterTransaction) : null;
  }

  // Phase 19 — READ-ONLY. Receipts Poster reports as deleted (documented status 3) for the same inclusive Ymd range. Used only to WARN about an
  // already-imported receipt that Poster now lists as deleted; nothing is ever reversed from it.
  async getDeletedTransactions(dateFrom: string, dateTo: string): Promise<PosterTransaction[]> {
    const raw = await this.get<unknown>('dash.getTransactions', { dateFrom, dateTo, status: '3' });
    return Array.isArray(raw) ? (raw as PosterTransaction[]) : [];
  }

  // Phase 22 — READ-ONLY. Currently-open register orders (documented status 1) for the given inclusive Ymd range. VERIFIED live (2026-09-22): a
  // just-opened order was visible here within one 20 s poll (effectively immediate, not a multi-minute sync delay). Used by PosterRewardMutationService
  // to independently resolve a widget-claimed posterOrderId (a millisecond timestamp) to a REST transaction_id, by matching date_start — never by
  // trusting the widget's own claim of which transaction_id that order has.
  async getOpenTransactions(dateFrom: string, dateTo: string): Promise<PosterTransaction[]> {
    const raw = await this.get<unknown>('dash.getTransactions', { dateFrom, dateTo, status: '1', include_products: 'true' });
    return Array.isArray(raw) ? (raw as PosterTransaction[]) : [];
  }

  // Phase 11.2 — READ-ONLY. The documented link from an incoming order to its receipt. `transactionId` is null
  // until Poster reports one (when that happens relative to acceptance is undocumented).
  async getIncomingOrderTransactionLink(incomingOrderId: string): Promise<{ found: boolean; transactionId: string | null }> {
    const raw = await this.get<unknown>('incomingOrders.getIncomingOrder', { incoming_order_id: incomingOrderId });
    const info = (Array.isArray(raw) ? raw[0] : raw) as PosterIncomingOrderLinkInfo | undefined;
    if (!info || typeof info !== 'object' || !('incoming_order_id' in info)) return { found: false, transactionId: null };
    const id = info.transaction_id;
    const asString = id === null || id === undefined ? '' : String(id).trim();
    return { found: true, transactionId: asString !== '' && asString !== '0' ? asString : null };
  }

  async getSpots(): Promise<PosterSpot[]> {
    return this.get<PosterSpot[]>('access.getSpots');
  }

  async createOrder(input: CreatePosterOrderInput): Promise<PosterCreateOrderOutcome> {
    try {
      const raw = await this.post<CreatePosterOrderRawResponse>('incomingOrders.createIncomingOrder', input);
      const incomingOrderId = this.extractIncomingOrderId(raw);
      if (incomingOrderId === null) {
        // The call succeeded at the HTTP level but the response shape didn't match either
        // of the two forms we anticipated (see poster.types.ts). Refuse to guess further.
        return {
          kind: 'ambiguous_failure',
          reason: `Unexpected createIncomingOrder response shape: ${JSON.stringify(raw)}`,
        };
      }
      return { kind: 'success', incomingOrderId };
    } catch (err) {
      if (err instanceof PosterDefiniteError) {
        return { kind: 'definite_failure', reason: err.message };
      }
      // Anything else — including PosterAmbiguousError and any unexpected exception — is
      // treated as ambiguous. We do NOT know whether Poster created the order. See the
      // idempotency "uncertain" state in docs/PHASE-0-PLAN.md section 8.
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(`createOrder ambiguous outcome: ${reason}`);
      return { kind: 'ambiguous_failure', reason };
    }
  }

  // Phase 22 — the SECOND (and only other) Poster mutation this codebase makes. VERIFIED live (2026-09-22) against a real, disposable, unpaid test order:
  // the added line appeared on the register's own screen in real time, priced at 0, and the order's own `sum` stayed unchanged — see docs/PHASE-22-AUDIT.md
  // §15. `spot_id`/`spot_tablet_id` MUST come from the caller's already-verified signed context (never re-derived here), matching the same trust rule the
  // rest of Phase 22 already follows. This method never trusts the caller's `transaction_id` blindly either — resolving which REST transaction_id to pass
  // is PosterRewardMutationService's job (via getOpenTransactions + a date_start match), not this method's.
  async addTransactionProduct(input: AddTransactionProductInput): Promise<PosterAddTransactionProductOutcome> {
    try {
      const raw = await this.post<AddTransactionProductRawResponse>('transactions.addTransactionProduct', input);
      if (!raw || typeof raw !== 'object' || typeof raw.transaction_product !== 'number') {
        return { kind: 'ambiguous_failure', reason: `Unexpected addTransactionProduct response shape: ${JSON.stringify(raw)}` };
      }
      return { kind: 'success', transactionProductId: raw.transaction_product };
    } catch (err) {
      if (err instanceof PosterDefiniteError) {
        return { kind: 'definite_failure', reason: err.message };
      }
      // Same rule as createOrder: anything else (PosterAmbiguousError, network failure, unexpected throw) is ambiguous, never definite. The caller must
      // never treat an ambiguous outcome as either success or failure — see PosterRewardMutationService.
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(`addTransactionProduct ambiguous outcome: ${reason}`);
      return { kind: 'ambiguous_failure', reason };
    }
  }

  async getOrderStatus(incomingOrderId: string): Promise<PosterIncomingOrder | null> {
    // VERIFIED live: `response` is a single object when queried by incoming_order_id, not a
    // list — see poster.types.ts. The "not found" shape is unverified, so anything without a
    // recognizable incoming_order_id is treated as "no order" rather than guessed at further.
    const raw = await this.get<unknown>('incomingOrders.getOwnIncomingOrders', {
      incoming_order_id: incomingOrderId,
    });
    if (raw && typeof raw === 'object' && 'incoming_order_id' in raw) {
      return raw as PosterIncomingOrder;
    }
    return null;
  }

  private extractIncomingOrderId(raw: CreatePosterOrderRawResponse): string | null {
    if (typeof raw === 'string' || typeof raw === 'number') {
      return String(raw);
    }
    if (raw && typeof raw === 'object' && 'incoming_order_id' in raw) {
      return String((raw as { incoming_order_id: string | number }).incoming_order_id);
    }
    return null;
  }

  private buildUrl(method: string, query?: Record<string, string>): string {
    const url = new URL(`${this.config.env.POSTER_API_BASE_URL.replace(/\/$/, '')}/${method}`);
    // Poster's documented auth convention: the API token travels as a query parameter on
    // every call, GET and POST alike. Never logged, never included in any thrown error.
    url.searchParams.set('token', this.config.env.POSTER_API_TOKEN);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        url.searchParams.set(key, value);
      }
    }
    return url.toString();
  }

  private redact(url: string): string {
    const redacted = new URL(url);
    redacted.searchParams.set('token', '***REDACTED***');
    return redacted.toString();
  }

  private async get<T>(method: string, query?: Record<string, string>): Promise<T> {
    return this.execute<T>('GET', method, undefined, query);
  }

  private async post<T>(method: string, body: unknown): Promise<T> {
    return this.execute<T>('POST', method, body);
  }

  private async execute<T>(
    httpMethod: 'GET' | 'POST',
    apiMethod: string,
    body?: unknown,
    query?: Record<string, string>,
  ): Promise<T> {
    const url = this.buildUrl(apiMethod, query);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(url, {
        method: httpMethod,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      // Network failure, DNS failure, or abort/timeout — we do not know if Poster ever
      // received or processed the request.
      const message = err instanceof Error ? err.message : String(err);
      throw new PosterAmbiguousError(`Poster request failed before a response was received: ${message}`);
    } finally {
      clearTimeout(timeout);
    }

    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = text.length > 0 ? JSON.parse(text) : undefined;
    } catch {
      // Non-JSON body: cannot confirm whether Poster processed the request.
      throw new PosterAmbiguousError(
        `Poster (${this.redact(url)}) returned a non-JSON response (HTTP ${res.status})`,
      );
    }

    if (res.ok) {
      // VERIFIED live against the real Poster API (2026-09-17): an invalid token produced
      // HTTP 200 with body {"error":{"code":11,"message":"Bad access token"}} — Poster
      // reports application-level errors via HTTP 200, not via a 4xx/5xx status. A truthy
      // "error" key at this point means Poster clearly processed and rejected the request,
      // so this is a definite (not ambiguous) failure.
      if (parsed && typeof parsed === 'object' && 'error' in parsed && (parsed as PosterApiErrorEnvelope).error) {
        throw new PosterDefiniteError(
          `Poster (${this.redact(url)}) reported an error (HTTP ${res.status}): ${text}`,
          parsed,
        );
      }
      if (parsed && typeof parsed === 'object' && 'response' in parsed) {
        return (parsed as PosterApiSuccessEnvelope<T>).response;
      }
      throw new PosterAmbiguousError(
        `Poster (${this.redact(url)}) returned HTTP ${res.status} without a recognized "response" or "error" envelope: ${text}`,
      );
    }

    if (res.status >= 400 && res.status < 500) {
      // A clean 4xx with a parseable body means Poster processed and explicitly rejected
      // the request — safe to treat as a definite (not ambiguous) failure.
      const errorBody = parsed as PosterApiErrorEnvelope | undefined;
      if (errorBody) {
        throw new PosterDefiniteError(
          `Poster (${this.redact(url)}) rejected the request (HTTP ${res.status}): ${text}`,
          errorBody,
        );
      }
    }

    // 5xx, or a 4xx with an unparseable/empty body: Poster's own processing state is
    // unknown to us. Treated as ambiguous, never as a definite failure.
    throw new PosterAmbiguousError(
      `Poster (${this.redact(url)}) returned HTTP ${res.status} with an indeterminate body: ${text}`,
    );
  }
}
