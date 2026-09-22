import { PrismaService } from '../../src/common/prisma/prisma.service';
import { CatalogRepository } from '../../src/modules/catalog/catalog.repository';
import { CustomersRepository } from '../../src/modules/customers/customers.repository';
import { PosWidgetRewardRedemptionRepository } from '../../src/modules/pos-widget/pos-widget-reward-redemption.repository';
import { PosWidgetRewardRedemptionService } from '../../src/modules/pos-widget/pos-widget-reward-redemption.service';
import { RedeemRewardResponse } from '../../src/modules/pos-widget/pos-widget-reward-redemption.types';
import { PosContext } from '../../src/modules/pos-widget/pos-widget-signature';
import { PosterRewardMutationOutcome, PosterRewardMutationService } from '../../src/modules/pos-widget/poster-reward-mutation.service';
import { PosterService } from '../../src/modules/poster/poster.service';
import { RewardEligibilityService } from '../../src/modules/rewards/reward-eligibility.service';
import { RewardProgressRepository } from '../../src/modules/rewards/reward-progress.repository';
import { RewardProgressService } from '../../src/modules/rewards/reward-progress.service';
import { toRecord } from '../../src/modules/rewards/reward-programs.service';
import { RewardProgramsRepository } from '../../src/modules/rewards/reward-programs.repository';
import { RewardRedemptionService } from '../../src/modules/rewards/reward-redemption.service';
import { RewardRedemptionsRepository } from '../../src/modules/rewards/reward-redemptions.repository';
import { cleanDatabase } from '../db-test-helper';

// Phase 22.2 — ONE POSTER ORDER = MAXIMUM ONE REWARD REDEMPTION. Uses the REAL SQLite test database (not mocked), exactly like
// orders-concurrency.spec.ts, so the actual DB-level guard (the "claim" transaction + the redeemedForPosterOrderId unique
// constraint) is genuinely exercised, not simulated. Only the Poster mutation boundary (PosterRewardMutationService.applyToOrder)
// is mocked — the point of these tests is the redemption-count invariant, never a real or fake HTTP call. No real Poster
// mutation, order, or Telegram message is ever created by this file. Reward/promotion table cleanup lives in cleanDatabase()
// itself (db-test-helper.ts) — a real cross-file test-isolation bug (Phase 23) showed a locally-duplicated cleanup helper here
// isn't enough once another spec file's rows are also present in the same shared test.db.

describe('Phase 22.2: one Poster order = maximum one reward redemption', () => {
  let prisma: PrismaService;
  let customers: CustomersRepository;
  let catalog: CatalogRepository;
  let programsRepo: RewardProgramsRepository;
  let eligibility: RewardEligibilityService;
  let progressService: RewardProgressService;
  let redemptionsRepo: PosWidgetRewardRedemptionRepository;
  let rewardRedemptionService: RewardRedemptionService;
  let mutation: PosterRewardMutationService;
  let service: PosWidgetRewardRedemptionService;

  let customerId: string;
  let programId: string;
  let productId: string;
  let posterProductId: string;

  const ctx: PosContext = { account: 'testacct', spotId: '1', tabletId: '1' };

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    customers = new CustomersRepository(prisma);
    catalog = new CatalogRepository(prisma);
    const progressRepo = new RewardProgressRepository(prisma);
    const rewardRedemptionsRepo = new RewardRedemptionsRepository(prisma);
    programsRepo = new RewardProgramsRepository(prisma);
    progressService = new RewardProgressService(progressRepo, rewardRedemptionsRepo);
    eligibility = new RewardEligibilityService(progressService, catalog);
    rewardRedemptionService = new RewardRedemptionService(programsRepo, eligibility, catalog, rewardRedemptionsRepo, progressRepo);
    redemptionsRepo = new PosWidgetRewardRedemptionRepository(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);

    const category = await catalog.upsertCategory({ posterCategoryId: '1', name: 'Coffee', sortOrder: 0 });
    const product = await catalog.upsertProduct({ posterProductId: '35', categoryId: category.id, name: 'Americano', priceMinor: 18000 });
    productId = product.id;
    posterProductId = product.posterProductId;

    const program = await prisma.rewardProgram.create({
      data: { name: '5+1', type: 'BUY_N_GET_ONE', qualifyingCategoryId: category.id, buyQuantity: 5, rewardQuantity: 1, isActive: true, startsAt: new Date(Date.now() - 86_400_000) },
    });
    programId = program.id;

    const customer = await customers.create({ displayName: 'Test Customer', phone: '+15550001111', posterClientId: '2' });
    customerId = customer.id;

    // 10 available rewards: 50 qualifying units at buyQuantity 5, 0 prior redemptions — same math RewardProgressService.getProgress documents.
    const order = await prisma.order.create({ data: { customerId, posterSpotId: 1, status: 'completed', totalMinor: 0, idempotencyKey: `seed-${customerId}` } });
    await prisma.orderItem.create({ data: { orderId: order.id, productId, posterProductId, quantity: 50, unitPriceMinor: 18000, totalPriceMinor: 0, isRewardItem: false } });

    mutation = new PosterRewardMutationService({} as unknown as PosterService); // PosterService itself is never called — applyToOrder is mocked per test
    const audit = { recordRewardEvent: jest.fn() };
    service = new PosWidgetRewardRedemptionService(prisma, customers, programsRepo, eligibility, catalog, mutation, redemptionsRepo, rewardRedemptionService, audit as never);
  });

  function mockMutation(outcome: PosterRewardMutationOutcome['kind']): void {
    jest.spyOn(mutation, 'applyToOrder').mockResolvedValue({ kind: outcome, reason: 'test' });
  }

  const reqFor = (posterOrderId: string, attemptId: string) => ({ attemptId, posterClientId: '2', posterOrderId, rewardProgramId: programId, posterProductId, employeeIdentifier: null });

  async function availableRewards(): Promise<number> {
    const row = await programsRepo.findById(programId);
    const progress = await progressService.getProgress(toRecord(row!), customerId);
    return progress.availableRewards;
  }

  it('the first redemption in an order succeeds', async () => {
    mockMutation('confirmed');
    const res = await service.redeem(ctx, reqFor('1000', 'attempt-1'));
    expect(res.status).toBe<RedeemRewardResponse['status']>('REDEEMED');
    expect(await prisma.rewardRedemption.count({ where: { customerId } })).toBe(1);
  });

  it('a second redemption in the SAME order is rejected with a dedicated reason, even with a fresh attemptId', async () => {
    mockMutation('confirmed');
    const first = await service.redeem(ctx, reqFor('1000', 'attempt-1'));
    expect(first.status).toBe('REDEEMED');

    const second = await service.redeem(ctx, reqFor('1000', 'attempt-2'));
    expect(second.status).toBe('FAILED');
    expect(second.failureReason).toBe('REWARD_ALREADY_REDEEMED_FOR_ORDER');

    expect(await prisma.rewardRedemption.count({ where: { customerId } })).toBe(1); // still just the one
  });

  it('a DIFFERENT Poster order can redeem independently', async () => {
    mockMutation('confirmed');
    const first = await service.redeem(ctx, reqFor('1000', 'attempt-1'));
    const second = await service.redeem(ctx, reqFor('2000', 'attempt-2'));
    expect(first.status).toBe('REDEEMED');
    expect(second.status).toBe('REDEEMED');
    expect(await prisma.rewardRedemption.count({ where: { customerId } })).toBe(2);
  });

  it('replaying the exact same idempotency key returns the original result, never a second redemption', async () => {
    mockMutation('confirmed');
    const first = await service.redeem(ctx, reqFor('1000', 'attempt-same'));
    const replay = await service.redeem(ctx, reqFor('1000', 'attempt-same'));
    expect(replay).toEqual(first);
    expect(await prisma.rewardRedemption.count({ where: { customerId } })).toBe(1);
  });

  it('two concurrent requests for the SAME order: exactly one succeeds, the other gets a safe conflict, no double redemption', async () => {
    mockMutation('confirmed');
    // Fired together, not awaited individually, so both race past the initial "is this order already redeemed" read before either has committed —
    // exactly the TOCTOU window the application-level check alone cannot close (same reasoning as orders-concurrency.spec.ts).
    const [a, b] = await Promise.allSettled([service.redeem(ctx, reqFor('1000', 'attempt-a')), service.redeem(ctx, reqFor('1000', 'attempt-b'))]);
    const results = [a, b].filter((r): r is PromiseFulfilledResult<RedeemRewardResponse> => r.status === 'fulfilled').map((r) => r.value);
    expect(results).toHaveLength(2); // neither request should ever throw — a losing race is a normal FAILED result, not an exception

    const succeeded = results.filter((r) => r.status === 'REDEEMED');
    const rejected = results.filter((r) => r.status !== 'REDEEMED');
    expect(succeeded).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(['REWARD_ALREADY_REDEEMED_FOR_ORDER', 'CONCURRENT_ATTEMPT_IN_PROGRESS']).toContain(rejected[0].failureReason);

    // The database is the source of truth on who won — not application bookkeeping.
    expect(await prisma.rewardRedemption.count({ where: { customerId } })).toBe(1);
    expect(await prisma.rewardRedemptionAttempt.count({ where: { posterOrderId: '1000', status: 'REDEEMED' } })).toBe(1);
  });

  it('a Poster rejection does not consume the reward, and a later attempt for the same order can still succeed', async () => {
    mockMutation('rejected');
    const first = await service.redeem(ctx, reqFor('1000', 'attempt-1'));
    expect(first.status).toBe('FAILED');
    expect(first.failureReason).toBe('POSTER_REJECTED');
    expect(await prisma.rewardRedemption.count({ where: { customerId } })).toBe(0);

    mockMutation('confirmed');
    const second = await service.redeem(ctx, reqFor('1000', 'attempt-2'));
    expect(second.status).toBe('REDEEMED'); // nothing succeeded the first time, so the order is NOT considered "already redeemed"
    expect(await prisma.rewardRedemption.count({ where: { customerId } })).toBe(1);
  });

  it('an UNKNOWN Poster result does not consume the reward, and is never auto-retried or treated as success', async () => {
    mockMutation('ambiguous');
    const res = await service.redeem(ctx, reqFor('1000', 'attempt-1'));
    expect(res.status).toBe('UNKNOWN');
    expect(await prisma.rewardRedemption.count({ where: { customerId } })).toBe(0);

    // Replaying the SAME attemptId must return the identical UNKNOWN state, not re-call Poster or change the outcome.
    const replay = await service.redeem(ctx, reqFor('1000', 'attempt-1'));
    expect(replay).toEqual(res);
    expect(mutation.applyToOrder).toHaveBeenCalledTimes(1);

    // A FRESH attemptId for the SAME order is deliberately still blocked while the earlier attempt sits at UNKNOWN — matching this codebase's existing
    // rule for the customer+program guard (UNRESOLVED_STATUSES includes UNKNOWN): since Poster's actual result for that first call was never confirmed
    // one way or the other, a second real mutation attempt for the same order risks silently giving the reward twice if the first one had actually
    // succeeded. This is the SAFE, conservative choice, not a limitation — never auto-retry an UNKNOWN, for this order OR this customer+program.
    mockMutation('confirmed');
    const second = await service.redeem(ctx, reqFor('1000', 'attempt-2'));
    expect(second.status).toBe('FAILED');
    expect(second.failureReason).toBe('CONCURRENT_ATTEMPT_IN_PROGRESS');
    expect(mutation.applyToOrder).toHaveBeenCalledTimes(1); // the second call never even reached Poster

    // A DIFFERENT order for the same customer is completely unaffected by the first order's UNKNOWN state.
    const third = await service.redeem(ctx, reqFor('2000', 'attempt-3'));
    expect(third.status).toBe('REDEEMED');
  });

  it('a customer with 10 available rewards still has 9 after one successful redemption', async () => {
    expect(await availableRewards()).toBe(10);
    mockMutation('confirmed');
    const res = await service.redeem(ctx, reqFor('1000', 'attempt-1'));
    expect(res.status).toBe('REDEEMED');
    expect(await availableRewards()).toBe(9);
  });

  it('a customer with 10 available rewards cannot consume more than 1 in a single Poster order', async () => {
    mockMutation('confirmed');
    const first = await service.redeem(ctx, reqFor('1000', 'attempt-1'));
    expect(first.status).toBe('REDEEMED');

    for (let i = 2; i <= 10; i += 1) {
      const res = await service.redeem(ctx, reqFor('1000', `attempt-${i}`));
      expect(res.status).toBe('FAILED');
      expect(res.failureReason).toBe('REWARD_ALREADY_REDEEMED_FOR_ORDER');
    }

    expect(await prisma.rewardRedemption.count({ where: { customerId } })).toBe(1); // only ONE of the 10 banked rewards was spent
    expect(await availableRewards()).toBe(9); // the other 9 remain banked, usable on other orders
  });
});
