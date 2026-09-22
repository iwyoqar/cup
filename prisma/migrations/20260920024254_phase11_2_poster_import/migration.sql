-- CreateTable
CREATE TABLE "poster_imported_transactions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "posterTransactionId" TEXT NOT NULL,
    "posterClientId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "posterSpotId" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "unresolvedReason" TEXT,
    "posterStatus" TEXT NOT NULL,
    "posterPayType" TEXT NOT NULL,
    "occurredAt" DATETIME NOT NULL,
    "totalMinor" INTEGER NOT NULL,
    "paidMinor" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'POS',
    "importedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "poster_imported_transactions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "poster_imported_transactions_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "poster_imported_transaction_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "transactionId" TEXT NOT NULL,
    "lineIndex" INTEGER NOT NULL,
    "posterProductId" TEXT NOT NULL,
    "productId" TEXT,
    "quantity" INTEGER NOT NULL,
    "posterProductPriceMinor" INTEGER NOT NULL,
    "posterPayedSumMinor" INTEGER NOT NULL,
    CONSTRAINT "poster_imported_transaction_items_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "poster_imported_transactions" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "poster_imported_transaction_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "poster_incoming_order_links" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "posterIncomingOrderId" TEXT NOT NULL,
    "posterTransactionId" TEXT NOT NULL,
    "resolvedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "poster_imported_transactions_posterTransactionId_key" ON "poster_imported_transactions"("posterTransactionId");

-- CreateIndex
CREATE INDEX "poster_imported_transactions_customerId_status_idx" ON "poster_imported_transactions"("customerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "poster_imported_transaction_items_transactionId_lineIndex_key" ON "poster_imported_transaction_items"("transactionId", "lineIndex");

-- CreateIndex
CREATE UNIQUE INDEX "poster_incoming_order_links_posterIncomingOrderId_key" ON "poster_incoming_order_links"("posterIncomingOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "poster_incoming_order_links_posterTransactionId_key" ON "poster_incoming_order_links"("posterTransactionId");

