// Tiny className joiner (no dependency): falsy parts are dropped.
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}
