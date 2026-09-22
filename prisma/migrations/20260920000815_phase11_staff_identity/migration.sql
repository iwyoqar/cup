-- AlterTable
ALTER TABLE "customers" ADD COLUMN "loyaltyCode" TEXT;

-- CreateTable
CREATE TABLE "staff_members" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "branchId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "staff_members_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "staff_scan_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "customerId" TEXT,
    "branchId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "staff_members_username_key" ON "staff_members"("username");

-- CreateIndex
CREATE INDEX "staff_scan_events_customerId_idx" ON "staff_scan_events"("customerId");

-- CreateIndex
CREATE INDEX "staff_scan_events_actorId_createdAt_idx" ON "staff_scan_events"("actorId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "customers_loyaltyCode_key" ON "customers"("loyaltyCode");

