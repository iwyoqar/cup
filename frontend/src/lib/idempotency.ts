// Phase 1.8 spec section 5: never Date.now()/Math.random()/an incrementing counter as the sole
// mechanism — those can collide or be guessed. crypto.randomUUID() is available in every
// Telegram Mini App WebView (HTTPS-only secure context on modern Chrome/WebKit); the
// getRandomValues()-based fallback below only matters for an unexpected older runtime, and
// still never falls back to Math.random() alone.
export function generateIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  throw new Error('No secure random source available to generate an Idempotency-Key.');
}
