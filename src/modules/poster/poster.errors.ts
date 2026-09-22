// PosterService classifies every failure into one of two buckets so callers (OrdersService)
// can decide whether it is safe to treat the attempt as known-not-created (definite) or
// unknown (ambiguous — the request may or may not have reached/succeeded on Poster's side).
// This distinction is the basis of the idempotency "uncertain" state documented in
// docs/PHASE-0-PLAN.md. Never collapse these two into one generic error.

export class PosterDefiniteError extends Error {
  constructor(message: string, readonly raw?: unknown) {
    super(message);
    this.name = 'PosterDefiniteError';
  }
}

export class PosterAmbiguousError extends Error {
  constructor(message: string, readonly raw?: unknown) {
    super(message);
    this.name = 'PosterAmbiguousError';
  }
}

// Thrown when Poster returns a status value with no known mapping to a CUP OrderStatus.
// Per the Phase 0 rule against inventing undocumented Poster behavior, an unmapped status
// is never guessed at — it is surfaced loudly instead.
export class UnmappedPosterStatusError extends Error {
  constructor(readonly posterStatus: string) {
    super(`Unmapped Poster order status "${posterStatus}" — refusing to guess its meaning.`);
    this.name = 'UnmappedPosterStatusError';
  }
}
