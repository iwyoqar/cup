-- AlterTable
ALTER TABLE "subscription_purchases" ADD COLUMN "posterAccount" TEXT;
ALTER TABLE "subscription_purchases" ADD COLUMN "posterOrderId" TEXT;
ALTER TABLE "subscription_purchases" ADD COLUMN "posterSpotId" TEXT;
ALTER TABLE "subscription_purchases" ADD COLUMN "posterTabletId" TEXT;
ALTER TABLE "subscription_purchases" ADD COLUMN "posterTransactionId" TEXT;
ALTER TABLE "subscription_purchases" ADD COLUMN "posterTransactionProductId" TEXT;
ALTER TABLE "subscription_purchases" ADD COLUMN "reconciledAt" DATETIME;
ALTER TABLE "subscription_purchases" ADD COLUMN "reconciliationStatus" TEXT;

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN "posterProductId" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_subscription_plans" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priceMinor" INTEGER NOT NULL,
    "durationDays" INTEGER NOT NULL,
    "totalPortions" INTEGER NOT NULL,
    "dailyPortionLimit" INTEGER NOT NULL,
    "cooldownMinutes" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "productId" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "subscription_plans_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_subscription_plans" ("cooldownMinutes", "createdAt", "createdBy", "dailyPortionLimit", "description", "durationDays", "id", "isActive", "name", "priceMinor", "sortOrder", "totalPortions", "updatedAt", "updatedBy") SELECT "cooldownMinutes", "createdAt", "createdBy", "dailyPortionLimit", "description", "durationDays", "id", "isActive", "name", "priceMinor", "sortOrder", "totalPortions", "updatedAt", "updatedBy" FROM "subscription_plans";
DROP TABLE "subscription_plans";
ALTER TABLE "new_subscription_plans" RENAME TO "subscription_plans";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "subscription_purchases_posterTransactionId_key" ON "subscription_purchases"("posterTransactionId");

