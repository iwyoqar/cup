import { ConfigService } from '../../src/common/config/config.service';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { CatalogRepository } from '../../src/modules/catalog/catalog.repository';
import { CustomersRepository } from '../../src/modules/customers/customers.repository';
import { IdempotencyRepository } from '../../src/modules/orders/idempotency.repository';
import { IdempotencyKeyInProgressError } from '../../src/modules/orders/orders.errors';
import { OrdersRepository } from '../../src/modules/orders/orders.repository';
import { OrdersService } from '../../src/modules/orders/orders.service';
import { PosterService } from '../../src/modules/poster/poster.service';
import { cleanDatabase } from '../db-test-helper';

// Uses the REAL SQLite test database (not mocked) so the actual unique-constraint behavior —
// the final protection against the read-then-write idempotency race described in the Phase 0
// code review — is genuinely exercised, not simulated. Only PosterService is mocked, since the
// point of this test is the DB race, not the HTTP call.
describe('OrdersService concurrency: the database unique constraint is the final race guard', () => {
  let prisma: PrismaService;
  let ordersRepository: OrdersRepository;
  let idempotencyRepository: IdempotencyRepository;
  let catalogRepository: CatalogRepository;
  let customersRepository: CustomersRepository;
  let customerId: string;
  let productId: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    ordersRepository = new OrdersRepository(prisma);
    idempotencyRepository = new IdempotencyRepository(prisma);
    catalogRepository = new CatalogRepository(prisma);
    customersRepository = new CustomersRepository(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);
    const customer = await customersRepository.create({
      displayName: 'Concurrency Test Customer',
      phone: '+15550000000',
    });
    customerId = customer.id;
    const category = await catalogRepository.upsertCategory({ posterCategoryId: '1', name: 'Coffee', sortOrder: 0 });
    const product = await catalogRepository.upsertProduct({
      posterProductId: '3',
      categoryId: category.id,
      name: 'Cappuccino 250 ml',
      priceMinor: 300,
    });
    productId = product.id;
  });

  it('two concurrent requests with the same Idempotency-Key: exactly one reserves it, the other gets a conflict, Poster is called exactly once', async () => {
    const posterCreateOrder = jest.fn().mockResolvedValue({ kind: 'success', incomingOrderId: '2' });
    const poster = { createOrder: posterCreateOrder, getOrderStatus: jest.fn() } as unknown as PosterService;

    const service = new OrdersService(
      ordersRepository,
      idempotencyRepository,
      catalogRepository,
      customersRepository,
      poster,
      prisma,
      new ConfigService(),
    );

    const input = { customerId, items: [{ productId, quantity: 1 }] };
    const idempotencyKey = 'concurrent-key-1';

    // Fired together, not awaited individually first: both calls race past the initial
    // findByKey() read (which finds nothing) before either has committed its insert, exactly
    // reproducing the TOCTOU window the application-level check alone cannot close.
    const [first, second] = await Promise.allSettled([
      service.createOrder(idempotencyKey, input),
      service.createOrder(idempotencyKey, input),
    ]);

    const settled = [first, second];
    const fulfilled = settled.filter((r) => r.status === 'fulfilled');
    const rejected = settled.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(IdempotencyKeyInProgressError);

    // The database is the source of truth on who won — not application bookkeeping.
    const orders = await prisma.order.findMany({ where: { idempotencyKey } });
    expect(orders).toHaveLength(1);
    const idempotencyRecords = await prisma.idempotencyKey.findMany({ where: { key: idempotencyKey } });
    expect(idempotencyRecords).toHaveLength(1);

    expect(posterCreateOrder).toHaveBeenCalledTimes(1);
  });
});
