-- CreateTable
CREATE TABLE "reward_redemption_attempts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "attemptId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "rewardProgramId" TEXT NOT NULL,
    "rewardProductId" TEXT,
    "rewardProductName" TEXT,
    "posterAccount" TEXT NOT NULL,
    "posterSpotId" TEXT,
    "posterTabletId" TEXT,
    "posterOrderId" TEXT NOT NULL,
    "employeeIdentifier" TEXT,
    "status" TEXT NOT NULL,
    "failureReason" TEXT,
    "redemptionId" TEXT,
    "requestedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "reward_redemption_attempts_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "reward_redemption_attempts_rewardProgramId_fkey" FOREIGN KEY ("rewardProgramId") REFERENCES "reward_programs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "reward_redemption_attempts_attemptId_key" ON "reward_redemption_attempts"("attemptId");

-- CreateIndex
CREATE UNIQUE INDEX "reward_redemption_attempts_redemptionId_key" ON "reward_redemption_attempts"("redemptionId");

-- CreateIndex
CREATE INDEX "reward_redemption_attempts_customerId_idx" ON "reward_redemption_attempts"("customerId");

-- CreateIndex
CREATE INDEX "reward_redemption_attempts_rewardProgramId_customerId_status_idx" ON "reward_redemption_attempts"("rewardProgramId", "customerId", "status");
