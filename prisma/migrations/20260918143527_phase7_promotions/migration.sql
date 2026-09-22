-- CreateTable
CREATE TABLE "promotions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "segmentId" TEXT,
    "benefitType" TEXT NOT NULL,
    "benefitValue" INTEGER,
    "benefitProductId" TEXT,
    "benefitQuantity" INTEGER,
    "startsAt" DATETIME NOT NULL,
    "endsAt" DATETIME,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "usageLimitPerCustomer" INTEGER,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "promotions_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "segments" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "promotions_benefitProductId_fkey" FOREIGN KEY ("benefitProductId") REFERENCES "products" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "promotion_redemptions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "promotionId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "orderId" TEXT,
    "usageIndex" INTEGER NOT NULL,
    "benefitType" TEXT NOT NULL,
    "benefitValue" INTEGER,
    "benefitProductId" TEXT,
    "benefitProductName" TEXT,
    "benefitQuantity" INTEGER,
    "redeemedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "promotion_redemptions_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "promotions" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "promotion_redemptions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "promotion_redemptions_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "promotion_redemptions_promotionId_customerId_usageIndex_key" ON "promotion_redemptions"("promotionId", "customerId", "usageIndex");
