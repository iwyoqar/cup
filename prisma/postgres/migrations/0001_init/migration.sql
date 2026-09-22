-- Phase 24 — the initial PostgreSQL schema, generated from prisma/schema.production.prisma via
--   prisma migrate diff --from-empty --to-schema-datamodel=prisma/schema.production.prisma --script
-- (no live database connection required or used to generate this). It mirrors every table, index, and foreign key in the
-- SQLite dev schema/migration history exactly (schema.production.prisma is generated 1:1 from schema.prisma — see
-- scripts/generate-production-schema.js). NOT YET APPLIED to any real database — Phase 24 prepares for deployment, it does
-- not deploy (see PROJECT_STATE.md). Apply with `npm run prisma:migrate:prod` against the real Supabase DATABASE_URL when
-- ready to provision it for the first time; never against the local SQLite dev.db.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "posterClientId" TEXT,
    "loyaltyCode" TEXT,
    "displayName" TEXT,
    "phone" TEXT,
    "birthDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_accounts" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "telegramUserId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "username" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "languageCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "telegram_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" TEXT NOT NULL,
    "posterSpotId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carts" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "branchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "checkoutLockedAt" TIMESTAMP(3),
    "checkoutIdempotencyKey" TEXT,
    "rewardProgramId" TEXT,
    "rewardProductId" TEXT,

    CONSTRAINT "carts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cart_items" (
    "id" TEXT NOT NULL,
    "cartId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "posterCategoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "posterProductId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceMinor" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "posterSpotId" INTEGER NOT NULL,
    "posterIncomingOrderId" TEXT,
    "status" TEXT NOT NULL,
    "totalMinor" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "branchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_status_notifications" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderStatus" TEXT NOT NULL,
    "deliveryState" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_status_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "posterProductId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPriceMinor" INTEGER NOT NULL,
    "totalPriceMinor" INTEGER NOT NULL,
    "isRewardItem" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "key" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "responseSnapshot" TEXT,
    "orderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "admins" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'ADMIN',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "valueType" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "loyalty_accounts" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "lifetimeEarned" INTEGER NOT NULL DEFAULT 0,
    "lifetimeSpent" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loyalty_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_transactions" (
    "id" TEXT NOT NULL,
    "loyaltyAccountId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "orderId" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loyalty_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "segments" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "logic" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "segment_conditions" (
    "id" TEXT NOT NULL,
    "segmentId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "segment_conditions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "segmentId" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'telegram',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "messageText" TEXT NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_recipients" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "telegramAccountId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "telegramMessageId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "sentAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "segmentId" TEXT,
    "benefitType" TEXT NOT NULL,
    "benefitValue" INTEGER,
    "benefitProductId" TEXT,
    "benefitQuantity" INTEGER,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "usageLimitPerCustomer" INTEGER,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_redemptions" (
    "id" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "orderId" TEXT,
    "usageIndex" INTEGER NOT NULL,
    "benefitType" TEXT NOT NULL,
    "benefitValue" INTEGER,
    "benefitProductId" TEXT,
    "benefitProductName" TEXT,
    "benefitQuantity" INTEGER,
    "redeemedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promotion_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reward_programs" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL,
    "qualifyingCategoryId" TEXT NOT NULL,
    "buyQuantity" INTEGER NOT NULL,
    "rewardQuantity" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reward_programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reward_redemptions" (
    "id" TEXT NOT NULL,
    "rewardProgramId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "orderId" TEXT,
    "redemptionIndex" INTEGER NOT NULL,
    "rewardProductId" TEXT,
    "rewardProductName" TEXT,
    "rewardQuantity" INTEGER NOT NULL,
    "buyQuantitySnapshot" INTEGER NOT NULL,
    "qualifyingCategoryName" TEXT,
    "redeemedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reward_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reward_redemption_attempts" (
    "id" TEXT NOT NULL,
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
    "redeemedForPosterOrderId" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reward_redemption_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_redemption_attempts" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "promotionName" TEXT,
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
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promotion_redemption_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_members" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "branchId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_scan_events" (
    "id" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "customerId" TEXT,
    "branchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_scan_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "poster_imported_transactions" (
    "id" TEXT NOT NULL,
    "posterTransactionId" TEXT NOT NULL,
    "posterClientId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "posterSpotId" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "unresolvedReason" TEXT,
    "posterStatus" TEXT NOT NULL,
    "posterPayType" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "totalMinor" INTEGER NOT NULL,
    "paidMinor" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'POS',
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "poster_imported_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "poster_imported_transaction_items" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "lineIndex" INTEGER NOT NULL,
    "posterProductId" TEXT NOT NULL,
    "productId" TEXT,
    "quantity" INTEGER NOT NULL,
    "posterProductPriceMinor" INTEGER NOT NULL,
    "posterPayedSumMinor" INTEGER NOT NULL,

    CONSTRAINT "poster_imported_transaction_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "poster_incoming_order_links" (
    "id" TEXT NOT NULL,
    "posterIncomingOrderId" TEXT NOT NULL,
    "posterTransactionId" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "poster_incoming_order_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_levels" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "minLifetimeSpend" INTEGER NOT NULL,
    "cashbackRateBps" INTEGER NOT NULL DEFAULT 0,
    "pointMultiplierPercent" INTEGER NOT NULL DEFAULT 100,
    "prioritySupport" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loyalty_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_accruals" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "levelCode" TEXT,
    "pointsAwarded" INTEGER NOT NULL DEFAULT 0,
    "cashbackMinor" INTEGER NOT NULL DEFAULT 0,
    "cashbackRateBps" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loyalty_accruals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cashback_transactions" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "levelCode" TEXT,
    "rateBps" INTEGER,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cashback_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "achievements" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "conditionType" TEXT NOT NULL,
    "conditionValue" INTEGER NOT NULL,
    "conditionParam" INTEGER,
    "categoryId" TEXT,
    "rewardPoints" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "achievements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_achievements" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "achievementId" TEXT NOT NULL,
    "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pointsAwarded" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "customer_achievements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_level_ups" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "levelCode" TEXT NOT NULL,
    "levelName" TEXT NOT NULL,
    "reachedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loyalty_level_ups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "birthday_reward_claims" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 0,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "birthday_reward_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referrals" (
    "id" TEXT NOT NULL,
    "referrerCustomerId" TEXT NOT NULL,
    "referredCustomerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "referralCode" TEXT,
    "attributedAt" TIMESTAMP(3),
    "registeredAt" TIMESTAMP(3),
    "qualifiedAt" TIMESTAMP(3),
    "rewardedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closeReason" TEXT,
    "qualifyingPurchaseKey" TEXT,
    "qualifyingAmountMinor" INTEGER,
    "checkedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_codes" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_rewards" (
    "id" TEXT NOT NULL,
    "referralId" TEXT NOT NULL,
    "beneficiary" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "rewardType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "skipReason" TEXT,
    "points" INTEGER NOT NULL DEFAULT 0,
    "loyaltyTransactionId" TEXT,
    "ordinal" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_rewards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "triggerType" TEXT NOT NULL,
    "triggerConfig" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "segmentId" TEXT,
    "cooldownHours" INTEGER NOT NULL DEFAULT 24,
    "maxSendsPerCustomer" INTEGER,
    "activatedAt" TIMESTAMP(3),
    "eventCursor" TEXT,
    "lastRunKey" TEXT,
    "lastRunAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_executions" (
    "id" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "triggerKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "notBeforeAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),
    "telegramMessageId" TEXT,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "automation_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_send_slots" (
    "id" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "executionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_send_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_daily_slots" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "dayKey" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "executionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_daily_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "poster_webhook_events" (
    "id" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "object" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "eventAt" TIMESTAMP(3) NOT NULL,
    "account" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "deliveries" INTEGER NOT NULL DEFAULT 1,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "outcome" TEXT,
    "lastError" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastDeliveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "poster_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customers_posterClientId_key" ON "customers"("posterClientId");

-- CreateIndex
CREATE UNIQUE INDEX "customers_loyaltyCode_key" ON "customers"("loyaltyCode");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_accounts_customerId_key" ON "telegram_accounts"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_accounts_telegramUserId_key" ON "telegram_accounts"("telegramUserId");

-- CreateIndex
CREATE UNIQUE INDEX "branches_posterSpotId_key" ON "branches"("posterSpotId");

-- CreateIndex
CREATE UNIQUE INDEX "carts_customerId_key" ON "carts"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "cart_items_cartId_productId_key" ON "cart_items"("cartId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "categories_posterCategoryId_key" ON "categories"("posterCategoryId");

-- CreateIndex
CREATE UNIQUE INDEX "products_posterProductId_key" ON "products"("posterProductId");

-- CreateIndex
CREATE UNIQUE INDEX "orders_posterIncomingOrderId_key" ON "orders"("posterIncomingOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "orders_idempotencyKey_key" ON "orders"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "order_status_notifications_orderId_orderStatus_key" ON "order_status_notifications"("orderId", "orderStatus");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_orderId_key" ON "idempotency_keys"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "admins_email_key" ON "admins"("email");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_accounts_customerId_key" ON "loyalty_accounts"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_recipients_campaignId_customerId_key" ON "campaign_recipients"("campaignId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "promotion_redemptions_promotionId_customerId_usageIndex_key" ON "promotion_redemptions"("promotionId", "customerId", "usageIndex");

-- CreateIndex
CREATE UNIQUE INDEX "reward_redemptions_rewardProgramId_customerId_redemptionInd_key" ON "reward_redemptions"("rewardProgramId", "customerId", "redemptionIndex");

-- CreateIndex
CREATE UNIQUE INDEX "reward_redemption_attempts_attemptId_key" ON "reward_redemption_attempts"("attemptId");

-- CreateIndex
CREATE UNIQUE INDEX "reward_redemption_attempts_redemptionId_key" ON "reward_redemption_attempts"("redemptionId");

-- CreateIndex
CREATE UNIQUE INDEX "reward_redemption_attempts_redeemedForPosterOrderId_key" ON "reward_redemption_attempts"("redeemedForPosterOrderId");

-- CreateIndex
CREATE INDEX "reward_redemption_attempts_customerId_idx" ON "reward_redemption_attempts"("customerId");

-- CreateIndex
CREATE INDEX "reward_redemption_attempts_rewardProgramId_customerId_statu_idx" ON "reward_redemption_attempts"("rewardProgramId", "customerId", "status");

-- CreateIndex
CREATE INDEX "reward_redemption_attempts_posterOrderId_status_idx" ON "reward_redemption_attempts"("posterOrderId", "status");

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

-- CreateIndex
CREATE UNIQUE INDEX "staff_members_username_key" ON "staff_members"("username");

-- CreateIndex
CREATE INDEX "staff_scan_events_customerId_idx" ON "staff_scan_events"("customerId");

-- CreateIndex
CREATE INDEX "staff_scan_events_actorId_createdAt_idx" ON "staff_scan_events"("actorId", "createdAt");

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

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_levels_code_key" ON "loyalty_levels"("code");

-- CreateIndex
CREATE INDEX "loyalty_accruals_customerId_occurredAt_idx" ON "loyalty_accruals"("customerId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_accruals_sourceType_sourceId_key" ON "loyalty_accruals"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "cashback_transactions_customerId_createdAt_idx" ON "cashback_transactions"("customerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "cashback_transactions_sourceType_sourceId_key" ON "cashback_transactions"("sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "achievements_code_key" ON "achievements"("code");

-- CreateIndex
CREATE UNIQUE INDEX "customer_achievements_customerId_achievementId_key" ON "customer_achievements"("customerId", "achievementId");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_level_ups_customerId_levelCode_key" ON "loyalty_level_ups"("customerId", "levelCode");

-- CreateIndex
CREATE UNIQUE INDEX "birthday_reward_claims_customerId_year_key" ON "birthday_reward_claims"("customerId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "referrals_referredCustomerId_key" ON "referrals"("referredCustomerId");

-- CreateIndex
CREATE INDEX "referrals_referrerCustomerId_idx" ON "referrals"("referrerCustomerId");

-- CreateIndex
CREATE INDEX "referrals_status_idx" ON "referrals"("status");

-- CreateIndex
CREATE INDEX "referrals_createdAt_idx" ON "referrals"("createdAt");

-- CreateIndex
CREATE INDEX "referrals_status_checkedAt_idx" ON "referrals"("status", "checkedAt");

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

-- CreateIndex
CREATE UNIQUE INDEX "poster_webhook_events_dedupeKey_key" ON "poster_webhook_events"("dedupeKey");

-- CreateIndex
CREATE INDEX "poster_webhook_events_status_nextAttemptAt_idx" ON "poster_webhook_events"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "poster_webhook_events_object_objectId_idx" ON "poster_webhook_events"("object", "objectId");

-- CreateIndex
CREATE INDEX "poster_webhook_events_receivedAt_idx" ON "poster_webhook_events"("receivedAt");

-- AddForeignKey
ALTER TABLE "telegram_accounts" ADD CONSTRAINT "telegram_accounts_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carts" ADD CONSTRAINT "carts_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carts" ADD CONSTRAINT "carts_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "carts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_status_notifications" ADD CONSTRAINT "order_status_notifications_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_accounts" ADD CONSTRAINT "loyalty_accounts_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_transactions" ADD CONSTRAINT "loyalty_transactions_loyaltyAccountId_fkey" FOREIGN KEY ("loyaltyAccountId") REFERENCES "loyalty_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_transactions" ADD CONSTRAINT "loyalty_transactions_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segment_conditions" ADD CONSTRAINT "segment_conditions_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "segments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "segments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "segments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_benefitProductId_fkey" FOREIGN KEY ("benefitProductId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_redemptions" ADD CONSTRAINT "promotion_redemptions_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "promotions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_redemptions" ADD CONSTRAINT "promotion_redemptions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_redemptions" ADD CONSTRAINT "promotion_redemptions_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_programs" ADD CONSTRAINT "reward_programs_qualifyingCategoryId_fkey" FOREIGN KEY ("qualifyingCategoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_redemptions" ADD CONSTRAINT "reward_redemptions_rewardProgramId_fkey" FOREIGN KEY ("rewardProgramId") REFERENCES "reward_programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_redemptions" ADD CONSTRAINT "reward_redemptions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_redemptions" ADD CONSTRAINT "reward_redemptions_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_redemption_attempts" ADD CONSTRAINT "reward_redemption_attempts_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_redemption_attempts" ADD CONSTRAINT "reward_redemption_attempts_rewardProgramId_fkey" FOREIGN KEY ("rewardProgramId") REFERENCES "reward_programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_redemption_attempts" ADD CONSTRAINT "promotion_redemption_attempts_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_redemption_attempts" ADD CONSTRAINT "promotion_redemption_attempts_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "promotions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_members" ADD CONSTRAINT "staff_members_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "poster_imported_transactions" ADD CONSTRAINT "poster_imported_transactions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "poster_imported_transactions" ADD CONSTRAINT "poster_imported_transactions_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "poster_imported_transaction_items" ADD CONSTRAINT "poster_imported_transaction_items_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "poster_imported_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "poster_imported_transaction_items" ADD CONSTRAINT "poster_imported_transaction_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_accruals" ADD CONSTRAINT "loyalty_accruals_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cashback_transactions" ADD CONSTRAINT "cashback_transactions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_achievements" ADD CONSTRAINT "customer_achievements_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_achievements" ADD CONSTRAINT "customer_achievements_achievementId_fkey" FOREIGN KEY ("achievementId") REFERENCES "achievements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_level_ups" ADD CONSTRAINT "loyalty_level_ups_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "birthday_reward_claims" ADD CONSTRAINT "birthday_reward_claims_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrerCustomerId_fkey" FOREIGN KEY ("referrerCustomerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referredCustomerId_fkey" FOREIGN KEY ("referredCustomerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_codes" ADD CONSTRAINT "referral_codes_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_rewards" ADD CONSTRAINT "referral_rewards_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "referrals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_rewards" ADD CONSTRAINT "referral_rewards_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automations" ADD CONSTRAINT "automations_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automations" ADD CONSTRAINT "automations_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "segments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_executions" ADD CONSTRAINT "automation_executions_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "automations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_executions" ADD CONSTRAINT "automation_executions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

