const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 20;

// Shared by every cursor-paginated list endpoint (orders, loyalty transactions, ...) — never
// trusts the raw query value beyond a bounded, sane integer; an invalid or absent value
// silently falls back to the default rather than erroring, since page size is a display
// preference, not something worth rejecting a request over.
export function clampPageSize(raw: string | undefined): number {
  const parsed = raw ? Number(raw) : DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(parsed) || parsed < 1) {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.min(parsed, MAX_PAGE_SIZE);
}
