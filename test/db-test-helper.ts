import { PrismaService } from '../src/common/prisma/prisma.service';

export async function cleanDatabase(prisma: PrismaService): Promise<void> {
  // Children before parents, respecting FK constraints.
  // Phase 22/22.3/23 — these four all reference Customer (and RewardProgram/Promotion, which reference Category), so they must be cleared before
  // customer/category below, regardless of which spec file created them. Fixed here (once, in the shared helper) after a real cross-file test-isolation
  // bug: two spec files sharing one test.db, each cleaning only its OWN tables, left the OTHER's rows behind and broke this function's own
  // customer.deleteMany() with a foreign key violation depending on run order.
  await prisma.rewardRedemptionAttempt.deleteMany();
  await prisma.rewardRedemption.deleteMany();
  await prisma.promotionRedemptionAttempt.deleteMany();
  await prisma.promotionRedemption.deleteMany();
  await prisma.cartItem.deleteMany();
  await prisma.cart.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.idempotencyKey.deleteMany();
  await prisma.order.deleteMany();
  await prisma.rewardProgram.deleteMany();
  await prisma.promotion.deleteMany();
  await prisma.segmentCondition.deleteMany();
  await prisma.segment.deleteMany();
  await prisma.product.deleteMany();
  await prisma.category.deleteMany();
  await prisma.telegramAccount.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.branch.deleteMany();
}
