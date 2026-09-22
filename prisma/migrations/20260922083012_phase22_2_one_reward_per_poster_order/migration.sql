-- Phase 22.2: ONE Poster order = maximum one reward redemption.
-- Purely additive: a new nullable column + two new indexes. No existing column, row, or
-- constraint is touched. Existing rows get redeemedForPosterOrderId = NULL (SQLite ALTER TABLE
-- ADD COLUMN default), which is valid and collides with nothing under the new unique index.

-- AlterTable
ALTER TABLE "reward_redemption_attempts" ADD COLUMN "redeemedForPosterOrderId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "reward_redemption_attempts_redeemedForPosterOrderId_key" ON "reward_redemption_attempts"("redeemedForPosterOrderId");

-- CreateIndex
CREATE INDEX "reward_redemption_attempts_posterOrderId_status_idx" ON "reward_redemption_attempts"("posterOrderId", "status");
