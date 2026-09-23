-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_customers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "posterClientId" TEXT,
    "loyaltyCode" TEXT,
    "displayName" TEXT,
    "phone" TEXT,
    "birthDate" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_customers" ("birthDate", "createdAt", "displayName", "id", "loyaltyCode", "phone", "posterClientId", "updatedAt") SELECT "birthDate", "createdAt", "displayName", "id", "loyaltyCode", "phone", "posterClientId", "updatedAt" FROM "customers";
DROP TABLE "customers";
ALTER TABLE "new_customers" RENAME TO "customers";
CREATE UNIQUE INDEX "customers_posterClientId_key" ON "customers"("posterClientId");
CREATE UNIQUE INDEX "customers_loyaltyCode_key" ON "customers"("loyaltyCode");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
