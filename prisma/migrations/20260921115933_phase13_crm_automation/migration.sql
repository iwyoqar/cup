-- CreateTable
CREATE TABLE "automations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "triggerType" TEXT NOT NULL,
    "triggerConfig" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "segmentId" TEXT,
    "cooldownHours" INTEGER NOT NULL DEFAULT 24,
    "maxSendsPerCustomer" INTEGER,
    "activatedAt" DATETIME,
    "eventCursor" TEXT,
    "lastRunKey" TEXT,
    "lastRunAt" DATETIME,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "automations_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "automations_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "segments" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "automation_executions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "automationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "triggerKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "notBeforeAt" DATETIME,
    "claimedAt" DATETIME,
    "telegramMessageId" TEXT,
    "errorCode" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" DATETIME,
    "sentAt" DATETIME,
    CONSTRAINT "automation_executions_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "automations" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "automation_executions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "automation_send_slots" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "automationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "executionId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "crm_daily_slots" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "dayKey" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "executionId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "automation_executions_status_notBeforeAt_idx" ON "automation_executions"("status", "notBeforeAt");

-- CreateIndex
CREATE INDEX "automation_executions_customerId_createdAt_idx" ON "automation_executions"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "automation_executions_automationId_createdAt_idx" ON "automation_executions"("automationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "automation_executions_automationId_triggerKey_key" ON "automation_executions"("automationId", "triggerKey");

-- CreateIndex
CREATE UNIQUE INDEX "automation_send_slots_executionId_key" ON "automation_send_slots"("executionId");

-- CreateIndex
CREATE INDEX "automation_send_slots_customerId_createdAt_idx" ON "automation_send_slots"("customerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "automation_send_slots_automationId_customerId_ordinal_key" ON "automation_send_slots"("automationId", "customerId", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "crm_daily_slots_executionId_key" ON "crm_daily_slots"("executionId");

-- CreateIndex
CREATE UNIQUE INDEX "crm_daily_slots_customerId_dayKey_slot_key" ON "crm_daily_slots"("customerId", "dayKey", "slot");
