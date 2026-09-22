import { createHash } from 'crypto';

// Deterministic JSON stringify: recursively sorts OBJECT keys, but preserves ARRAY element
// order intentionally — this is a generic utility and array order may be semantically
// meaningful for some future caller. If a specific caller's arrays represent an unordered
// set (as order line items do — see normalizeItemsForHash in orders.service.ts), normalize
// that array yourself before passing it in; don't change this function's semantics for one
// caller's needs.
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const entries = keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`);
  return `{${entries.join(',')}}`;
}

export function hashPayload(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}
