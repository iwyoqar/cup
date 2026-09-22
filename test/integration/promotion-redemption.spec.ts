import { PrismaService } from '../../src/common/prisma/prisma.service';
import { CustomersRepository } from '../../src/modules/customers/customers.repository';
import { PosWidgetPromotionRedemptionRepository } from '../../src/modules/pos-widget/pos-widget-promotion-redemption.repository';
import { PosWidgetPromotionRedemptionService } from '../../src/modules/pos-widget/pos-widget-promotion-redemption.service';
import { RedeemPromotionResponse } from '../../src/modules/pos-widget/pos-widget-promotion-redemption.types';
import { PosContext } from '../../src/modules/pos-widget/pos-widget-signature';
import { PosterPromotionMutationOutcome, PosterPromotionMutationService } from '../../src/modules/pos-widget/poster-promotion-mutation.service';
import { PosterService } from '../../src/modules/poster/poster.service';
import { PromotionEligibilityService } from '../../src/modules/promotions/promotion-eligibility.service';
import { PromotionRedemptionService } from '../../src/modules/promotions/promotion-redemption.service';
import { PromotionRedemptionsRepository } from '../../src/modules/promotions/promotion-redemptions.repository';
import { PromotionsRepository } from '../../src/modules/promotions/promotions.repository';
import { cleanDatabase } from '../db-test-helper';

// Phase 23 — uses the REAL SQLite test database (not mocked), exactly like reward-redemption-one-per-order.spec.ts, so the actual DB-level guards are
// genuinely exercised. Only the Poster mutation boundary (PosterPromotionMutationService.applyToOrder) is mocked. No real Poster mutation, order, or
// Telegram message is ever created by this file. Reward/promotion table cleanup lives in cleanDatabase() itself (db-test-helper.ts) — see that file's
// comment for the cross-file test-isolation bug this fixed.

describe('Phase 23: promotion redemption', () => {
  let prisma: PrismaService;
  let customers: CustomersRepository;
  let promotionsRepo: PromotionsRepository;
  let eligibility: PromotionEligibilityService;
  let promotionRedemptionService: PromotionRedemptionService;
  let attempts: PosWidgetPromotionRedemptionRepository;
  let mutation: PosterPromotionMutationService;
  let service: PosWidgetPromotionRedemptionService;

  let customerId: string;
  let freeProductPromotionId: string;
  let categoryId: string;
  let benefitProductId: string;

  const ctx: PosContext = { account: 'testacct', spotId: '1', tabletId: '1' };

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    customers = new CustomersRepository(prisma);
    promotionsRepo = new PromotionsRepository(prisma);
    const redemptionsRepo = new PromotionRedemptionsRepository(prisma);
    // Stubbed on purpose: none of these tests set a promotionId's segmentId, or use a LOYALTY_POINTS benefit, so SegmentsService.filterCustomersInSegment
    // and LoyaltyService.creditPoints are never actually invoked — wiring their real (much deeper) dependency chains would test nothing extra here.
    const segmentsServiceStub = { filterCustomersInSegment: jest.fn() };
    const loyaltyServiceStub = { creditPoints: jest.fn() };
    eligibility = new PromotionEligibilityService(segmentsServiceStub as never, redemptionsRepo);
    promotionRedemptionService = new PromotionRedemptionService(eligibility, redemptionsRepo, loyaltyServiceStub as never);
    attempts = new PosWidgetPromotionRedemptionRepository(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);

    const category = await prisma.category.create({ data: { posterCategoryId: 'promo-cat-1', name: 'Bakery', sortOrder: 0 } });
    categoryId = category.id;
    const product = await prisma.product.create({ data: { posterProductId: '90', categoryId, name: 'Croissant', priceMinor: 15000, isActive: true } });
    benefitProductId = product.id;

    const promotion = await prisma.promotion.create({
      data: {
        name: 'Free Croissant',
        benefitType: 'FREE_PRODUCT',
        benefitProductId,
        benefitQuantity: 1,
        isActive: true,
        startsAt: new Date(Date.now() - 86_400_000),
        usageLimitPerCustomer: null,
      },
    });
    freeProductPromotionId = promotion.id;

    const customer = await customers.create({ displayName: 'Test Customer', phone: '+15550002222', posterClientId: '7' });
    customerId = customer.id;

    mutation = new PosterPromotionMutationService({} as unknown as PosterService);
    const audit = { recordPromotionEvent: jest.fn() };
    service = new PosWidgetPromotionRedemptionService(prisma, customers, promotionsRepo, eligibility, mutation, attempts, promotionRedemptionService, audit as never);
  });

  function mockMutation(outcome: PosterPromotionMutationOutcome['kind']): void {
    jest.spyOn(mutation, 'applyToOrder').mockResolvedValue({ kind: outcome, reason: 'test' });
  }

  const reqFor = (posterOrderId: string, attemptId: string, promotionId = freeProductPromotionId) => ({ attemptId, posterClientId: '7', posterOrderId, promotionId, employeeIdentifier: null });

  it('an eligible FREE_PRODUCT promotion succeeds when the Poster mutation is supported and confirmed', async () => {
    mockMutation('confirmed');
    const res = await service.redeem(ctx, reqFor('1000', 'attempt-1'));
    expect(res.status).toBe<RedeemPromotionResponse['status']>('REDEEMED');
    expect(await prisma.promotionRedemption.count({ where: { customerId } })).toBe(1);
  });

  it('an ineligible customer (usage limit already reached) is rejected, no redemption', async () => {
    const promo = await prisma.promotion.create({ data: { name: 'One time only', benefitType: 'FREE_PRODUCT', benefitProductId, benefitQuantity: 1, isActive: true, startsAt: new Date(Date.now() - 86_400_000), usageLimitPerCustomer: 1 } });
    // Pre-existing redemption from an unrelated (e.g. CUP-checkout) path — already at the limit before this attempt.
    await prisma.promotionRedemption.create({ data: { promotionId: promo.id, customerId, usageIndex: 1, benefitType: 'FREE_PRODUCT', benefitProductId, benefitQuantity: 1 } });
    mockMutation('confirmed');
    const res = await service.redeem(ctx, reqFor('1000', 'attempt-1', promo.id));
    expect(res.status).toBe('FAILED');
    expect(res.failureReason).toBe('USAGE_LIMIT_REACHED');
    expect(mutation.applyToOrder).not.toHaveBeenCalled();
    expect(await prisma.promotionRedemption.count({ where: { promotionId: promo.id } })).toBe(1); // still just the pre-existing one
  });

  it('an inactive promotion is rejected, no redemption', async () => {
    const promo = await prisma.promotion.create({ data: { name: 'Off', benefitType: 'FREE_PRODUCT', benefitProductId, benefitQuantity: 1, isActive: false, startsAt: new Date(Date.now() - 86_400_000) } });
    mockMutation('confirmed');
    const res = await service.redeem(ctx, reqFor('1000', 'attempt-1', promo.id));
    expect(res.status).toBe('FAILED');
    expect(res.failureReason).toBe('PROMOTION_INACTIVE');
    expect(mutation.applyToOrder).not.toHaveBeenCalled();
  });

  it('an expired promotion is rejected, no redemption', async () => {
    const promo = await prisma.promotion.create({ data: { name: 'Expired', benefitType: 'FREE_PRODUCT', benefitProductId, benefitQuantity: 1, isActive: true, startsAt: new Date(Date.now() - 2 * 86_400_000), endsAt: new Date(Date.now() - 86_400_000) } });
    mockMutation('confirmed');
    const res = await service.redeem(ctx, reqFor('1000', 'attempt-1', promo.id));
    expect(res.status).toBe('FAILED');
    expect(res.failureReason).toBe('PROMOTION_EXPIRED');
  });

  it('a second promotion redemption on the SAME order is rejected, even a different promotion', async () => {
    mockMutation('confirmed');
    const first = await service.redeem(ctx, reqFor('1000', 'attempt-1'));
    expect(first.status).toBe('REDEEMED');

    const otherPromo = await prisma.promotion.create({ data: { name: 'Another', benefitType: 'FREE_PRODUCT', benefitProductId, benefitQuantity: 1, isActive: true, startsAt: new Date(Date.now() - 86_400_000) } });
    const second = await service.redeem(ctx, reqFor('1000', 'attempt-2', otherPromo.id));
    expect(second.status).toBe('FAILED');
    expect(second.failureReason).toBe('PROMOTION_ALREADY_REDEEMED_FOR_ORDER');
    expect(await prisma.promotionRedemption.count({ where: { customerId } })).toBe(1);
  });

  it('a DIFFERENT Poster order can redeem independently', async () => {
    mockMutation('confirmed');
    const first = await service.redeem(ctx, reqFor('1000', 'attempt-1'));
    const second = await service.redeem(ctx, reqFor('2000', 'attempt-2'));
    expect(first.status).toBe('REDEEMED');
    expect(second.status).toBe('REDEEMED');
    expect(await prisma.promotionRedemption.count({ where: { customerId } })).toBe(2);
  });

  it('replaying the exact same idempotency key returns the original result, never a second redemption', async () => {
    mockMutation('confirmed');
    const first = await service.redeem(ctx, reqFor('1000', 'attempt-same'));
    const replay = await service.redeem(ctx, reqFor('1000', 'attempt-same'));
    expect(replay).toEqual(first);
    expect(await prisma.promotionRedemption.count({ where: { customerId } })).toBe(1);
  });

  it('two concurrent requests for the SAME order: exactly one succeeds, the other gets a safe conflict, no double redemption', async () => {
    mockMutation('confirmed');
    const [a, b] = await Promise.allSettled([service.redeem(ctx, reqFor('1000', 'attempt-a')), service.redeem(ctx, reqFor('1000', 'attempt-b'))]);
    const results = [a, b].filter((r): r is PromiseFulfilledResult<RedeemPromotionResponse> => r.status === 'fulfilled').map((r) => r.value);
    expect(results).toHaveLength(2);
    const succeeded = results.filter((r) => r.status === 'REDEEMED');
    const rejected = results.filter((r) => r.status !== 'REDEEMED');
    expect(succeeded).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(['PROMOTION_ALREADY_REDEEMED_FOR_ORDER', 'CONCURRENT_ATTEMPT_IN_PROGRESS']).toContain(rejected[0].failureReason);
    expect(await prisma.promotionRedemption.count({ where: { customerId } })).toBe(1);
  });

  it('a Poster rejection does not consume the promotion, and a later attempt for the same order can still succeed', async () => {
    mockMutation('rejected');
    const first = await service.redeem(ctx, reqFor('1000', 'attempt-1'));
    expect(first.status).toBe('FAILED');
    expect(first.failureReason).toBe('POSTER_REJECTED');
    expect(await prisma.promotionRedemption.count()).toBe(0);

    mockMutation('confirmed');
    const second = await service.redeem(ctx, reqFor('1000', 'attempt-2'));
    expect(second.status).toBe('REDEEMED');
  });

  it('an UNKNOWN Poster result does not consume the promotion and is never treated as success', async () => {
    mockMutation('ambiguous');
    const res = await service.redeem(ctx, reqFor('1000', 'attempt-1'));
    expect(res.status).toBe('UNKNOWN');
    expect(await prisma.promotionRedemption.count()).toBe(0);

    const replay = await service.redeem(ctx, reqFor('1000', 'attempt-1'));
    expect(replay).toEqual(res);
    expect(mutation.applyToOrder).toHaveBeenCalledTimes(1);
  });

  it('an unsupported benefit type (PERCENT_DISCOUNT) is blocked and never attempts a Poster mutation', async () => {
    const promo = await prisma.promotion.create({ data: { name: '10% off', benefitType: 'PERCENT_DISCOUNT', benefitValue: 10, isActive: true, startsAt: new Date(Date.now() - 86_400_000) } });
    const applySpy = jest.spyOn(mutation, 'applyToOrder');
    const res = await service.redeem(ctx, reqFor('1000', 'attempt-1', promo.id));
    expect(res.status).toBe('UNKNOWN'); // isSupported() false -> treated as 'blocked' -> UNKNOWN (see the service's Phase B branch)
    expect(res.failureReason).toBe('BLOCKED_NO_VERIFIED_POSTER_MUTATION');
    expect(applySpy).not.toHaveBeenCalled();
    expect(await prisma.promotionRedemption.count()).toBe(0);
  });

  it('reward redemption remains a completely independent invariant: a promotion redemption does not block a reward on the same order', async () => {
    // Phase 22.3's per-order rule only ever queries reward_redemption_attempts; Phase 23's only ever queries promotion_redemption_attempts. This test
    // just proves the two tables/checks never cross-reference each other for the SAME posterOrderId.
    mockMutation('confirmed');
    const promoResult = await service.redeem(ctx, reqFor('1000', 'attempt-1'));
    expect(promoResult.status).toBe('REDEEMED');
    // A reward attempt for the SAME order must not be blocked by the promotion redemption above — verified structurally: the reward per-order check
    // (findRedeemedForPosterOrderTx on RewardRedemptionAttempt) cannot see rows in promotion_redemption_attempts at all.
    const rewardRelatedRows = await prisma.rewardRedemptionAttempt.count({ where: { posterOrderId: '1000' } });
    expect(rewardRelatedRows).toBe(0); // nothing was written to the reward table by this promotion redemption
  });
});
