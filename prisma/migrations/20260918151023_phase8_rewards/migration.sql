-- AlterTable
ALTER TABLE "carts" ADD COLUMN "rewardProductId" TEXT;
ALTER TABLE "carts" ADD COLUMN "rewardProgramId" TEXT;

-- CreateTable
CREATE TABLE "reward_programs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL,
    "qualifyingCategoryId" TEXT NOT NULL,
    "buyQuantity" INTEGER NOT NULL,
    "rewardQuantity" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "startsAt" DATETIME NOT NULL,
    "endsAt" DATETIME,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "reward_programs_qualifyingCategoryId_fkey" FOREIGN KEY ("qualifyingCategoryId") REFERENCES "categories" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "reward_redemptions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rewardProgramId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "orderId" TEXT,
    "redemptionIndex" INTEGER NOT NULL,
    "rewardProductId" TEXT,
    "rewardProductName" TEXT,
    "rewardQuantity" INTEGER NOT NULL,
    "buyQuantitySnapshot" INTEGER NOT NULL,
    "qualifyingCategoryName" TEXT,
    "redeemedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "reward_redemptions_rewardProgramId_fkey" FOREIGN KEY ("rewardProgramId") REFERENCES "reward_programs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "reward_redemptions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "reward_redemptions_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_order_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "posterProductId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPriceMinor" INTEGER NOT NULL,
    "totalPriceMinor" INTEGER NOT NULL,
    "isRewardItem" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "order_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_order_items" ("id", "orderId", "posterProductId", "productId", "quantity", "totalPriceMinor", "unitPriceMinor") SELECT "id", "orderId", "posterProductId", "productId", "quantity", "totalPriceMinor", "unitPriceMinor" FROM "order_items";
DROP TABLE "order_items";
ALTER TABLE "new_order_items" RENAME TO "order_items";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "reward_redemptions_rewardProgramId_customerId_redemptionIndex_key" ON "reward_redemptions"("rewardProgramId", "customerId", "redemptionIndex");
