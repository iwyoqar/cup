-- Coffee Subscription — real Poster order purchase (POS_SUBSCRIPTION_POSTER_PURCHASE_ENABLED, ships OFF by default). Additive only —
-- no existing data is changed. Mirrors prisma/migrations/<sqlite-timestamp>_subscription_poster_purchase; that dev migration's SQLite
-- whole-table redefine for subscription_plans (needed only because SQLite cannot ADD a foreign-key column directly) has no equivalent
-- here — Postgres adds the column and the constraint directly.

-- AlterTable
ALTER TABLE "subscription_plans" ADD COLUMN     "productId" TEXT;

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "posterProductId" TEXT;

-- AlterTable
ALTER TABLE "subscription_purchases" ADD COLUMN     "posterAccount" TEXT,
ADD COLUMN     "posterSpotId" TEXT,
ADD COLUMN     "posterTabletId" TEXT,
ADD COLUMN     "posterOrderId" TEXT,
ADD COLUMN     "posterTransactionId" TEXT,
ADD COLUMN     "posterTransactionProductId" TEXT,
ADD COLUMN     "reconciliationStatus" TEXT,
ADD COLUMN     "reconciledAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "subscription_purchases_posterTransactionId_key" ON "subscription_purchases"("posterTransactionId");

-- AddForeignKey
ALTER TABLE "subscription_plans" ADD CONSTRAINT "subscription_plans_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
