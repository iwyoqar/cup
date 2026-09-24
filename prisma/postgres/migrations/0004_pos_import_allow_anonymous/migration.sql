-- Owner decision (2026-09-24): a Poster receipt with no client, or an unlinked one, is now imported ANONYMOUSLY
-- (customerId: null) instead of being skipped, so Analytics/Finance revenue reflects real total sales. Hand-authored
-- to mirror the applied SQLite migration (prisma/migrations/20260924074607_pos_import_allow_anonymous), adjusted for
-- Postgres syntax — see 0002_customer_isactive's own note on why (`prisma migrate diff --from-migrations` needs a
-- live shadow database not available in this environment).

ALTER TABLE "poster_imported_transactions" DROP CONSTRAINT "poster_imported_transactions_customerId_fkey";
ALTER TABLE "poster_imported_transactions" ALTER COLUMN "posterClientId" DROP NOT NULL;
ALTER TABLE "poster_imported_transactions" ALTER COLUMN "customerId" DROP NOT NULL;
ALTER TABLE "poster_imported_transactions" ADD CONSTRAINT "poster_imported_transactions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
