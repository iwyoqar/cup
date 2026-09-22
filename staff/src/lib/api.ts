// Small typed HTTP client for the Staff Panel. Talks ONLY to /staff/* with the STAFF session token —
// never a customer or admin token. The token lives in sessionStorage (survives a reload within the tab,
// disappears when the browser closes, so a shared counter tablet does not keep a session indefinitely).

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly backendMessage: string,
  ) {
    super(backendMessage);
  }
}

const TOKEN_KEY = 'cup_staff_session_token';

export function getStoredToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function storeToken(token: string): void {
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    // A blocked sessionStorage only means the session will not survive a reload.
  }
}

export function clearStoredToken(): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Ignore.
  }
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL.replace(/\/+$/, '');

export async function apiRequest<T>(path: string, options: { method?: 'GET' | 'POST'; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const token = getStoredToken();
  if (token) headers.Authorization = `Bearer ${token}`;

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

  const raw = await response.text();
  let data: unknown = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    const message = data && typeof data === 'object' && 'message' in data && typeof (data as { message: unknown }).message === 'string' ? (data as { message: string }).message : response.statusText;
    throw new ApiError(response.status, message);
  }
  return data as T;
}

// Friendly Uzbek text only — never a raw backend string, status code or stack.
export function toUserMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return "Kutilmagan xatolik. Qayta urinib ko'ring.";
  if (err.status === 0) return "Server bilan bog'lanib bo'lmadi. Internetni tekshiring.";
  if (err.status === 401) return "Kirish muddati tugagan. Qayta kiring.";
  if (err.status === 404) return 'Mijoz topilmadi.';
  if (err.status === 429) return "Juda ko'p urinish. Birozdan so'ng qayta urinib ko'ring.";
  if (err.status === 409) return err.backendMessage;
  if (err.status === 400) return "Ma'lumot noto'g'ri kiritildi.";
  return "Server xatoligi. Birozdan so'ng qayta urinib ko'ring.";
}
