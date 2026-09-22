-- CreateTable
CREATE TABLE "promotion_redemption_attempts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "attemptId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "benefitType" TEXT NOT NULL,
    "posterAccount" TEXT NOT NULL,
    "posterSpotId" TEXT,
    "posterTabletId" TEXT,
    "posterOrderId" TEXT NOT NULL,
    "employeeIdentifier" TEXT,
    "status" TEXT NOT NULL,
    "failureReason" TEXT,
    "redemptionId" TEXT,
    "redeemedForPosterOrderId" TEXT,
    "requestedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "promotion_redemption_attempts_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "promotion_redemption_attempts_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "promotions" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "promotion_redemption_attempts_attemptId_key" ON "promotion_redemption_attempts"("attemptId");

-- CreateIndex
CREATE UNIQUE INDEX "promotion_redemption_attempts_redemptionId_key" ON "promotion_redemption_attempts"("redemptionId");

-- CreateIndex
CREATE UNIQUE INDEX "promotion_redemption_attempts_redeemedForPosterOrderId_key" ON "promotion_redemption_attempts"("redeemedForPosterOrderId");

-- CreateIndex
CREATE INDEX "promotion_redemption_attempts_customerId_idx" ON "promotion_redemption_attempts"("customerId");

-- CreateIndex
CREATE INDEX "promotion_redemption_attempts_promotionId_customerId_status_idx" ON "promotion_redemption_attempts"("promotionId", "customerId", "status");

-- CreateIndex
CREATE INDEX "promotion_redemption_attempts_posterOrderId_status_idx" ON "promotion_redemption_attempts"("posterOrderId", "status");

