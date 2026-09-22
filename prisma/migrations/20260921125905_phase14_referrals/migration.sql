-- AlterTable
ALTER TABLE "referrals" ADD COLUMN "attributedAt" DATETIME;
ALTER TABLE "referrals" ADD COLUMN "checkedAt" DATETIME;
ALTER TABLE "referrals" ADD COLUMN "closeReason" TEXT;
ALTER TABLE "referrals" ADD COLUMN "closedAt" DATETIME;
ALTER TABLE "referrals" ADD COLUMN "qualifiedAt" DATETIME;
ALTER TABLE "referrals" ADD COLUMN "qualifyingAmountMinor" INTEGER;
ALTER TABLE "referrals" ADD COLUMN "qualifyingPurchaseKey" TEXT;
ALTER TABLE "referrals" ADD COLUMN "referralCode" TEXT;
ALTER TABLE "referrals" ADD COLUMN "registeredAt" DATETIME;
ALTER TABLE "referrals" ADD COLUMN "rewardedAt" DATETIME;
ALTER TABLE "referrals" ADD COLUMN "updatedAt" DATETIME;

-- CreateTable
CREATE TABLE "referral_codes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "referral_codes_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "referral_rewards" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "referralId" TEXT NOT NULL,
    "beneficiary" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "rewardType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "skipReason" TEXT,
    "points" INTEGER NOT NULL DEFAULT 0,
    "loyaltyTransactionId" TEXT,
    "ordinal" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "referral_rewards_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "referrals" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "referral_rewards_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "referral_codes_customerId_key" ON "referral_codes"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "referral_codes_code_key" ON "referral_codes"("code");

-- CreateIndex
CREATE UNIQUE INDEX "referral_rewards_loyaltyTransactionId_key" ON "referral_rewards"("loyaltyTransactionId");

-- CreateIndex
CREATE INDEX "referral_rewards_customerId_idx" ON "referral_rewards"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "referral_rewards_referralId_beneficiary_key" ON "referral_rewards"("referralId", "beneficiary");

-- CreateIndex
CREATE UNIQUE INDEX "referral_rewards_customerId_beneficiary_ordinal_key" ON "referral_rewards"("customerId", "beneficiary", "ordinal");

-- CreateIndex
CREATE INDEX "referrals_status_idx" ON "referrals"("status");

-- CreateIndex
CREATE INDEX "referrals_createdAt_idx" ON "referrals"("createdAt");

-- CreateIndex
CREATE INDEX "referrals_status_checkedAt_idx" ON "referrals"("status", "checkedAt");
