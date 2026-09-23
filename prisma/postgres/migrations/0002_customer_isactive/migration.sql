-- Phase 26: Customer soft-delete/deactivation flag, same convention as every other isActive
-- column in this schema (Branch, Product, StaffMember, etc.). Hand-authored to mirror exactly
-- what `prisma migrate diff` would produce for this one-column change — `prisma migrate diff
-- --from-migrations` needs a live shadow database to replay history against, which is not
-- available in this environment (see prisma/postgres/migrations/0001_init's own generation
-- note). Verified equivalent to the applied SQLite migration
-- (prisma/migrations/20260923144722_phase26_customer_isactive), adjusted for Postgres syntax.
ALTER TABLE "customers" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
