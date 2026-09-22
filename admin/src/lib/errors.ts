import { ApiError } from './api';

// The backend's own message when it sent one; otherwise a plain fallback. Never a stack trace, never a raw response.
export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError && err.backendMessage ? err.backendMessage : fallback;
}
