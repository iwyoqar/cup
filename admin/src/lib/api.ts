// Small typed HTTP client for the Admin Panel — same shape/conventions as frontend/'s
// lib/api/client.ts (Part 3: "use existing project conventions if possible"), but talks to the
// /admin/* routes with the ADMIN session token, never the customer one. The two frontends never
// share a token or a client instance.

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly backendMessage: string,
  ) {
    super(backendMessage);
  }
}

const TOKEN_STORAGE_KEY = 'cup_admin_session_token';

// sessionStorage (not localStorage): survives a page reload within the same tab — necessary
// since, unlike the Mini App, there is no Telegram initData to silently re-authenticate with —
// but clears when the tab/browser closes, rather than persisting an admin session indefinitely
// on a shared machine.
export function getStoredToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function storeToken(token: string): void {
  try {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    // Ignore — a blocked/unavailable sessionStorage just means the session won't survive a
    // reload, not a functional failure of this request.
  }
}

export function clearStoredToken(): void {
  try {
    sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // Ignore.
  }
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL.replace(/\/+$/, '');

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Optional AbortSignal (Reports Phase H): lets a superseded filter request be cancelled in the browser. */
  signal?: AbortSignal;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  const token = getStoredToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    });
  } catch {
    throw new ApiError(0, 'network_error');
  }

  if (response.status === 401) {
    // An admin session never silently re-authenticates (there is no equivalent of Telegram
    // initData to fall back on) — clear the stale token so the app cleanly returns to the
    // login screen instead of looping on repeated 401s.
    clearStoredToken();
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
    // zod's .flatten() shape from the backend's BadRequestException(parsed.error.flatten())
    if (message && typeof message === 'object' && 'fieldErrors' in message) {
      const fieldErrors = (message as { fieldErrors: Record<string, string[]> }).fieldErrors;
      const parts = Object.entries(fieldErrors)
        .filter(([, errors]) => errors.length > 0)
        .map(([field, errors]) => `${field}: ${errors.join(', ')}`);
      if (parts.length > 0) {
        return parts.join('; ');
      }
    }
  }
  return null;
}
