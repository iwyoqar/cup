// Shared across any repository/service that races a unique-constraint insert against a
// concurrent duplicate (orders idempotency keys, first-login TelegramAccount creation, etc.)
// — the database constraint is always the final protection; this just recognizes that outcome.
export function isUniqueConstraintViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002';
}

// Phase 6: raised when deleting/updating a row that another row still references via a required
// relation with no onDelete override (e.g. a Segment still referenced by a Campaign — see
// schema.prisma's comment on Segment.campaigns). P2003 is Prisma's standard code for this under
// the default "foreignKeys" relation mode; P2014 is the equivalent code Prisma can use for the
// same underlying condition depending on the query shape. Checking both is defensive, not a sign
// either is expected in practice for this project's schema.
export function isForeignKeyConstraintViolation(err: unknown): boolean {
  const code = typeof err === 'object' && err !== null ? (err as { code?: string }).code : undefined;
  return code === 'P2003' || code === 'P2014';
}
