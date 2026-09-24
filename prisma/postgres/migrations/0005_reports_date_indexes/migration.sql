-- Reports Phase H: two plain b-tree indexes for the date-range filters every Analytics/Finance/Reports query uses
-- (orders.createdAt, poster_imported_transactions.occurredAt). Generated with `prisma migrate diff` (schema-to-schema, no
-- database needed) to mirror prisma/migrations/20260924200000_reports_date_indexes. Additive only — no data is changed.
-- CreateIndex
CREATE INDEX "orders_createdAt_idx" ON "orders"("createdAt");

-- CreateIndex
CREATE INDEX "poster_imported_transactions_occurredAt_idx" ON "poster_imported_transactions"("occurredAt");

