// Small typed HTTP client shared by every api/*.ts module. Centralizes: base URL, the
// Authorization header, JSON parsing, and error normalization — see Phase 1.7 spec section 28.
//
// The session token lives ONLY in memory (this module-level variable), never in
// localStorage/sessionStorage. Telegram always hands the Mini App fresh initData on every
// launch, so re-authenticating on each app start is cheap and avoids persisting a JWT at all.

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly backendMessage: string,
  ) {
    super(backendMessage);
  }
}

let currentToken: string | null = null;
// Set once by the auth bootstrap flow (see features/auth) so the client can transparently
// re-authenticate exactly once after a 401, instead of every caller handling that itself.
let reauthenticate: (() => Promise<string>) | null = null;

export function setToken(token: string | null): void {
  currentToken = token;
}

export function setReauthenticator(fn: (() => Promise<string>) | null): void {
  reauthenticate = fn;
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL.replace(/\/+$/, '');

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  /**
   * Public endpoints (the catalog) never need the session token. Omitting Authorization also makes a
   * body-less GET a CORS "simple" request — no preflight round trip — and lets it start before the
   * session exists at all.
   */
  skipAuth?: boolean;
  /** Internal: prevents a second reauth attempt from looping forever. */
  _retried?: boolean;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { ...options.headers };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (currentToken && !options.skipAuth) {
    headers.Authorization = `Bearer ${currentToken}`;
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'network_error');
  }

  if (response.status === 401 && !options._retried && reauthenticate) {
    try {
      const newToken = await reauthenticate();
      setToken(newToken);
      return apiRequest<T>(path, { ...options, _retried: true });
    } catch {
      // Fall through to normal 401 handling below — reauthentication itself failed.
    }
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const raw = await response.text();
  const data = raw ? safeJsonParse(raw) : null;

  if (!response.ok) {
    const message = extractBackendMessage(data) ?? response.statusText;
    throw new ApiError(response.status, message);
  }

  return data as T;
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function extractBackendMessage(data: unknown): string | null {
  if (data && typeof data === 'object' && 'message' in data) {
    const message = (data as { message: unknown }).message;
    if (typeof message === 'string') {
      return message;
    }
    if (Array.isArray(message) && message.every((m) => typeof m === 'string')) {
      return message.join(' ');
    }
  }
  return null;
}
