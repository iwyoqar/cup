-- Coffee Subscription: new tables + one additive column (customers.subscriptionLockVersion, default 0). Generated with
-- `prisma migrate diff` (schema-to-schema) to mirror prisma/migrations/20260927090000_coffee_subscriptions. Additive only — no existing data is changed.
-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "subscriptionLockVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "subscription_plans" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priceMinor" INTEGER NOT NULL,
    "durationDays" INTEGER NOT NULL,
    "totalPortions" INTEGER NOT NULL,
    "dailyPortionLimit" INTEGER NOT NULL,
    "cooldownMinutes" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_products" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "portionCost" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "planName" TEXT NOT NULL,
    "priceMinor" INTEGER NOT NULL,
    "durationDays" INTEGER NOT NULL,
    "totalPortions" INTEGER NOT NULL,
    "dailyPortionLimit" INTEGER NOT NULL,
    "cooldownMinutes" INTEGER NOT NULL,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "startBusinessDate" TEXT,
    "endBusinessDate" TEXT,
    "activatedAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "expiredAt" TIMESTAMP(3),
    "usageVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_purchases" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'UZS',
    "provider" TEXT,
    "providerPaymentId" TEXT,
    "activationSource" TEXT,
    "activatedBy" TEXT,
    "activationNote" TEXT,
    "failureReason" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_redemptions" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "posterProductId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "portionCost" INTEGER NOT NULL,
    "branchId" TEXT,
    "posterAccount" TEXT NOT NULL,
    "posterSpotId" TEXT,
    "posterTabletId" TEXT,
    "posterOrderId" TEXT NOT NULL,
    "posterTransactionId" TEXT,
    "posterTransactionProductId" TEXT,
    "employeeIdentifier" TEXT,
    "status" TEXT NOT NULL,
    "failureReason" TEXT,
    "claimSequence" INTEGER,
    "businessDate" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "redeemedAt" TIMESTAMP(3),
    "redeemedForPosterOrderId" TEXT,
    "reconciliationStatus" TEXT,
    "reconciledAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "subscription_products_productId_key" ON "subscription_products"("productId");

-- CreateIndex
CREATE INDEX "subscriptions_customerId_status_idx" ON "subscriptions"("customerId", "status");

-- CreateIndex
CREATE INDEX "subscriptions_status_endsAt_idx" ON "subscriptions"("status", "endsAt");

-- CreateIndex
CREATE INDEX "subscriptions_planId_idx" ON "subscriptions"("planId");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_purchases_subscriptionId_key" ON "subscription_purchases"("subscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_purchases_idempotencyKey_key" ON "subscription_purchases"("idempotencyKey");

-- CreateIndex
CREATE INDEX "subscription_purchases_customerId_status_idx" ON "subscription_purchases"("customerId", "status");

-- CreateIndex
CREATE INDEX "subscription_purchases_status_paidAt_idx" ON "subscription_purchases"("status", "paidAt");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_purchases_provider_providerPaymentId_key" ON "subscription_purchases"("provider", "providerPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_redemptions_attemptId_key" ON "subscription_redemptions"("attemptId");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_redemptions_redeemedForPosterOrderId_key" ON "subscription_redemptions"("redeemedForPosterOrderId");

-- CreateIndex
CREATE INDEX "subscription_redemptions_subscriptionId_status_idx" ON "subscription_redemptions"("subscriptionId", "status");

-- CreateIndex
CREATE INDEX "subscription_redemptions_customerId_requestedAt_idx" ON "subscription_redemptions"("customerId", "requestedAt");

-- CreateIndex
CREATE INDEX "subscription_redemptions_businessDate_idx" ON "subscription_redemptions"("businessDate");

-- CreateIndex
CREATE INDEX "subscription_redemptions_posterTransactionId_idx" ON "subscription_redemptions"("posterTransactionId");

-- CreateIndex
CREATE INDEX "subscription_redemptions_branchId_requestedAt_idx" ON "subscription_redemptions"("branchId", "requestedAt");

-- CreateIndex
CREATE INDEX "subscription_redemptions_status_requestedAt_idx" ON "subscription_redemptions"("status", "requestedAt");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_redemptions_subscriptionId_claimSequence_key" ON "subscription_redemptions"("subscriptionId", "claimSequence");

-- AddForeignKey
ALTER TABLE "subscription_products" ADD CONSTRAINT "subscription_products_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "subscription_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_purchases" ADD CONSTRAINT "subscription_purchases_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_purchases" ADD CONSTRAINT "subscription_purchases_planId_fkey" FOREIGN KEY ("planId") REFERENCES "subscription_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_purchases" ADD CONSTRAINT "subscription_purchases_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_redemptions" ADD CONSTRAINT "subscription_redemptions_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_redemptions" ADD CONSTRAINT "subscription_redemptions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_redemptions" ADD CONSTRAINT "subscription_redemptions_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_redemptions" ADD CONSTRAINT "subscription_redemptions_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

