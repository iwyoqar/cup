-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_poster_imported_transactions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "posterTransactionId" TEXT NOT NULL,
    "posterClientId" TEXT,
    "customerId" TEXT,
    "branchId" TEXT NOT NULL,
    "posterSpotId" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "unresolvedReason" TEXT,
    "posterStatus" TEXT NOT NULL,
    "posterPayType" TEXT NOT NULL,
    "occurredAt" DATETIME NOT NULL,
    "totalMinor" INTEGER NOT NULL,
    "paidMinor" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'POS',
    "importedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "poster_imported_transactions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "poster_imported_transactions_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_poster_imported_transactions" ("branchId", "createdAt", "customerId", "id", "importedAt", "occurredAt", "paidMinor", "posterClientId", "posterPayType", "posterSpotId", "posterStatus", "posterTransactionId", "source", "status", "totalMinor", "unresolvedReason", "updatedAt") SELECT "branchId", "createdAt", "customerId", "id", "importedAt", "occurredAt", "paidMinor", "posterClientId", "posterPayType", "posterSpotId", "posterStatus", "posterTransactionId", "source", "status", "totalMinor", "unresolvedReason", "updatedAt" FROM "poster_imported_transactions";
DROP TABLE "poster_imported_transactions";
ALTER TABLE "new_poster_imported_transactions" RENAME TO "poster_imported_transactions";
CREATE UNIQUE INDEX "poster_imported_transactions_posterTransactionId_key" ON "poster_imported_transactions"("posterTransactionId");
CREATE INDEX "poster_imported_transactions_customerId_status_idx" ON "poster_imported_transactions"("customerId", "status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
