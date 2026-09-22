-- Phase 23 follow-up: a name snapshot on the attempt row, mirroring RewardRedemptionAttempt.rewardProductName exactly. Needed so an idempotent
-- replay (which returns the STORED row, never re-loading the Promotion) can still populate RedeemPromotionResponse.promotionName without a lookup.
ALTER TABLE "promotion_redemption_attempts" ADD COLUMN "promotionName" TEXT;
