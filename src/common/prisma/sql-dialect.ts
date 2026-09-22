import { Prisma } from '@prisma/client';

// Phase 24 — the ONLY place this codebase decides which SQL dialect it is talking to, and the ONLY reason it needs to: a handful of raw SQL queries
// (business-local calendar-day grouping, hour-of-day, day-of-week, birthday month/day matching) use SQLite's strftime(), because Prisma's SQLite
// connector stores every DateTime column as an integer Unix epoch in MILLISECONDS. Prisma's PostgreSQL connector stores DateTime as a native
// TIMESTAMP(3) already in UTC — a completely different on-disk representation, not just a syntax difference — so these queries cannot be made
// "portable" by translating strftime() 1:1; they need a real per-dialect expression. Every other query in the codebase goes through Prisma's own
// query builder and needs no changes at all (see docs/PHASE-0-PLAN.md's original portability rules: no Prisma enum, no Decimal, no other raw SQL).
//
// NOT YET LIVE-VERIFIED against a real PostgreSQL database (Phase 24 prepares for deployment; it does not deploy — see PROJECT_STATE.md). The SQLite
// branch is untouched (byte-identical to the expressions this replaces) and remains exactly as verified throughout Phases 17/18/20.
export type SqlDialect = 'sqlite' | 'postgresql';

let cached: SqlDialect | null = null;

export function sqlDialect(): SqlDialect {
  if (cached) return cached;
  const url = process.env.DATABASE_URL ?? '';
  cached = /^postgres(ql)?:\/\//i.test(url) ? 'postgresql' : 'sqlite';
  return cached;
}

// Only for tests that need to force a dialect without setting DATABASE_URL (e.g. asserting the generated SQL text). Never called by application code.
export function resetSqlDialectCacheForTests(): void {
  cached = null;
}

const col = (column: string) => Prisma.raw(column); // column is always a fixed, hardcoded, already-quoted identifier from within this codebase, never user input

// Business-local calendar day ("YYYY-MM-DD") for a DateTime column, shifted by a fixed UTC offset in minutes (BUSINESS_TIMEZONE_OFFSET_MINUTES).
export function dayBucketSql(column: string, offsetMinutes: number): Prisma.Sql {
  if (sqlDialect() === 'postgresql') {
    return Prisma.sql`to_char(${col(column)} + (${offsetMinutes} || ' minutes')::interval, 'YYYY-MM-DD')`;
  }
  return Prisma.sql`strftime('%Y-%m-%d', (${col(column)} / 1000) + ${offsetMinutes * 60}, 'unixepoch')`;
}

// Local hour-of-day (0-23) as an integer, same offset convention as dayBucketSql.
export function hourOfDaySql(column: string, offsetMinutes: number): Prisma.Sql {
  if (sqlDialect() === 'postgresql') {
    return Prisma.sql`CAST(EXTRACT(HOUR FROM ${col(column)} + (${offsetMinutes} || ' minutes')::interval) AS INTEGER)`;
  }
  return Prisma.sql`CAST(strftime('%H', ${col(column)} / 1000 + ${offsetMinutes * 60}, 'unixepoch') AS INTEGER)`;
}

// Whether the local calendar day is a weekend. SQLite's %w and Postgres's EXTRACT(DOW ...) use the SAME convention (0 = Sunday .. 6 = Saturday), so
// the two branches only differ in syntax, not meaning.
export function isWeekendSql(column: string, offsetMinutes: number): Prisma.Sql {
  if (sqlDialect() === 'postgresql') {
    return Prisma.sql`EXTRACT(DOW FROM ${col(column)} + (${offsetMinutes} || ' minutes')::interval) IN (0, 6)`;
  }
  return Prisma.sql`strftime('%w', ${col(column)} / 1000 + ${offsetMinutes * 60}, 'unixepoch') IN ('0', '6')`;
}

// "MM-DD" for birthday matching — deliberately NOT offset-shifted (matches the existing behaviour exactly: a birthday match is a UTC calendar-date
// comparison today, unchanged by this phase).
export function monthDaySql(column: string): Prisma.Sql {
  if (sqlDialect() === 'postgresql') {
    return Prisma.sql`to_char(${col(column)}, 'MM-DD')`;
  }
  return Prisma.sql`strftime('%m-%d', CAST(${col(column)} AS INTEGER) / 1000, 'unixepoch')`;
}

// A DateTime value as a raw-SQL comparison parameter, matching how each dialect's DateTime column is actually stored: SQLite compares against an
// integer epoch-ms, PostgreSQL compares against a native timestamp (the Date object itself — Prisma's pg driver parameterizes it correctly).
export function dateTimeParam(d: Date): number | Date {
  return sqlDialect() === 'postgresql' ? d : d.getTime();
}

// Same as dateTimeParam, but for callers (branch-intelligence, automations) whose own public contract is already "epoch milliseconds as a plain
// number" (RangeMs, EventCursor) rather than a Date — preserved unchanged by Phase 24 (fixing those contracts would mean redesigning a completed
// phase's API, explicitly out of scope). Only the SQL comparing a raw ms number against a NATIVE DateTime column needs this; a comparison against
// a column already normalized to an epoch-ms integer via epochMsCastSql (below) needs no conversion in either dialect.
export function epochMsParam(ms: number): number | Date {
  return sqlDialect() === 'postgresql' ? new Date(ms) : ms;
}

// Projects a native DateTime column AS an epoch-ms integer, so downstream SQL (comparisons against a plain ms number, MAX()/MIN(), ORDER BY,
// day-bucketing) can keep working with one uniform "t is a number" contract regardless of dialect — exactly what branch-intelligence.repository.ts's
// PURCHASES/SEQUENCED CTEs and automations.repository.ts's purchase-event streams already assumed SQLite gives them for free.
export function epochMsCastSql(column: string): Prisma.Sql {
  if (sqlDialect() === 'postgresql') {
    return Prisma.sql`CAST(EXTRACT(EPOCH FROM ${col(column)}) * 1000 AS BIGINT)`;
  }
  return Prisma.sql`CAST(${col(column)} AS INTEGER)`;
}

// Business-local calendar day ("YYYY-MM-DD") for a column that is ALREADY an epoch-ms integer (e.g. the `t` alias epochMsCastSql produces) — the
// counterpart to dayBucketSql above, which instead takes a native DateTime column directly. Used wherever a query builds its own epoch-ms `t` once
// and buckets it by day later, rather than bucketing a raw table column in the same expression.
export function dayBucketFromEpochMsSql(epochMsColumn: string, offsetMinutes: number): Prisma.Sql {
  if (sqlDialect() === 'postgresql') {
    return Prisma.sql`to_char(to_timestamp(${col(epochMsColumn)} / 1000.0 + ${offsetMinutes * 60}), 'YYYY-MM-DD')`;
  }
  return Prisma.sql`strftime('%Y-%m-%d', (${col(epochMsColumn)} / 1000) + ${offsetMinutes * 60}, 'unixepoch')`;
}
