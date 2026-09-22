-- CreateTable
CREATE TABLE "poster_webhook_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dedupeKey" TEXT NOT NULL,
    "object" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "eventAt" DATETIME NOT NULL,
    "account" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "deliveries" INTEGER NOT NULL DEFAULT 1,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" DATETIME,
    "outcome" TEXT,
    "lastError" TEXT,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastDeliveredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "poster_webhook_events_dedupeKey_key" ON "poster_webhook_events"("dedupeKey");

-- CreateIndex
CREATE INDEX "poster_webhook_events_status_nextAttemptAt_idx" ON "poster_webhook_events"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "poster_webhook_events_object_objectId_idx" ON "poster_webhook_events"("object", "objectId");

-- CreateIndex
CREATE INDEX "poster_webhook_events_receivedAt_idx" ON "poster_webhook_events"("receivedAt");
