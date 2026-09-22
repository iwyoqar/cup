// Phase 24 — derives prisma/schema.production.prisma from prisma/schema.prisma MECHANICALLY, every time, so there is exactly ONE place model
// definitions are hand-maintained (the existing schema.prisma, used for local SQLite dev, untouched by this script). The only difference between the
// two files is the `datasource db` block's `provider`: this project's schema was deliberately kept portable since Phase 0 (no Prisma enum, no
// Decimal, no @db.* native type overrides, no other sqlite-specific field syntax — see schema.prisma's own header comment), so a straight provider
// swap is sufficient; nothing else needs to change for PostgreSQL to accept the same model definitions.
//
// Run via `npm run prisma:generate:prod` / `npm run prisma:migrate:prod` (see package.json) — never by hand, so the generated file can never go
// stale relative to schema.prisma. The generated file IS committed (so it is diffable in git like everything else here), but must always be
// regenerated, never hand-edited — a hand edit would just be silently overwritten the next time either script runs.
const fs = require('fs');
const path = require('path');

const SOURCE = path.join(__dirname, '..', 'prisma', 'schema.prisma');
const TARGET_DIR = path.join(__dirname, '..', 'prisma', 'postgres');
const TARGET = path.join(TARGET_DIR, 'schema.prisma');
// Prisma's migration tooling always looks for a `migrations` folder next to the schema file it was pointed at (no CLI flag changes this) — the
// production schema lives in its own prisma/postgres/ directory specifically so its migrations (prisma/postgres/migrations/) never collide with,
// or get confused with, the SQLite dev migrations in prisma/migrations/.

const source = fs.readFileSync(SOURCE, 'utf8');

const datasourceBlock = /datasource\s+db\s*\{[^}]*\}/s;
if (!datasourceBlock.test(source)) {
  console.error('generate-production-schema: could not find a `datasource db { ... }` block in prisma/schema.prisma — refusing to write a possibly-wrong output.');
  process.exit(1);
}
if (!/provider\s*=\s*"sqlite"/.test(source)) {
  console.error('generate-production-schema: prisma/schema.prisma\'s datasource provider is not "sqlite" as expected — refusing to guess. Check this script is still correct.');
  process.exit(1);
}

const header = `// GENERATED FILE — do not hand-edit. Produced from prisma/schema.prisma by scripts/generate-production-schema.js (Phase 24).
// The ONLY difference from prisma/schema.prisma is the datasource provider below (sqlite -> postgresql). Every model, field, index, and relation is
// identical, because prisma/schema.prisma was kept portable since Phase 0 (no enum, no Decimal, no @db.* native overrides, no other sqlite-specific
// field syntax). Regenerate with \`npm run prisma:generate:prod\` (which runs this script first) whenever prisma/schema.prisma changes — never edit
// this file directly, it will be overwritten.

`;

const production = header + source.replace(datasourceBlock, 'datasource db {\n  provider = "postgresql"\n  url      = env("DATABASE_URL")\n}');

fs.mkdirSync(TARGET_DIR, { recursive: true });
fs.writeFileSync(TARGET, production);
console.log(`generate-production-schema: wrote ${path.relative(process.cwd(), TARGET)} from ${path.relative(process.cwd(), SOURCE)}.`);
