import { PrismaService } from '../../src/common/prisma/prisma.service';
import { CatalogRepository } from '../../src/modules/catalog/catalog.repository';
import { CustomersRepository } from '../../src/modules/customers/customers.repository';
import { IdempotencyRepository } from '../../src/modules/orders/idempotency.repository';
import { OrdersRepository } from '../../src/modules/orders/orders.repository';
import { cleanDatabase } from '../db-test-helper';

// Runs against a real, migrated SQLite file (prisma/test.db — see test/prepare-test-db.js),
// not a mock, so unique-constraint and FK behavior are genuinely exercised.
describe('OrdersRepository + IdempotencyRepository (real SQLite test db)', () => {
  let prisma: PrismaService;
  let ordersRepo: OrdersRepository;
  let idempotencyRepo: IdempotencyRepository;
  let catalogRepo: CatalogRepository;
  let customersRepo: CustomersRepository;

  let customerId: string;
  let productId: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    ordersRepo = new OrdersRepository(prisma);
    idempotencyRepo = new IdempotencyRepository(prisma);
    catalogRepo = new CatalogRepository(prisma);
    customersRepo = new CustomersRepository(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);
    const customer = await customersRepo.create({ displayName: 'Test Customer' });
    customerId = customer.id;
    const category = await catalogRepo.upsertCategory({ posterCategoryId: '1', name: 'Coffee', sortOrder: 0 });
    const product = await catalogRepo.upsertProduct({
      posterProductId: '3',
      categoryId: category.id,
      name: 'Cappuccino 250 ml',
      priceMinor: 300,
    });
    productId = product.id;
  });

  function oneItem() {
    return [{ productId, posterProductId: '3', quantity: 1, unitPriceMinor: 300, totalPriceMinor: 300 }];
  }

  it('creates a pending order with its items in a single call', async () => {
    const order = await ordersRepo.createPendingWithItems(prisma, {
      customerId,
      posterSpotId: 1,
      idempotencyKey: 'key-1',
      totalMinor: 300,
      items: oneItem(),
    });

    expect(order.status).toBe('pending');
    expect(order.posterIncomingOrderId).toBeNull();
    expect(order.items).toHaveLength(1);
    expect(order.items[0].posterProductId).toBe('3');
  });

  it('enforces uniqueness on Order.idempotencyKey', async () => {
    await ordersRepo.createPendingWithItems(prisma, {
      customerId,
      posterSpotId: 1,
      idempotencyKey: 'dup-key',
      totalMinor: 300,
      items: oneItem(),
    });

    await expect(
      ordersRepo.createPendingWithItems(prisma, {
        customerId,
        posterSpotId: 1,
        idempotencyKey: 'dup-key',
        totalMinor: 300,
        items: oneItem(),
      }),
    ).rejects.toThrow();
  });

  it('updateAfterPosterSuccess sets posterIncomingOrderId and status=sent_to_poster', async () => {
    const order = await ordersRepo.createPendingWithItems(prisma, {
      customerId,
      posterSpotId: 1,
      idempotencyKey: 'key-2',
      totalMinor: 300,
      items: oneItem(),
    });

    const updated = await ordersRepo.updateAfterPosterSuccess(prisma, order.id, '2');

    expect(updated.posterIncomingOrderId).toBe('2');
    expect(updated.status).toBe('sent_to_poster');
  });

  it('findPollable returns only non-terminal orders with a known posterIncomingOrderId', async () => {
    const pending = await ordersRepo.createPendingWithItems(prisma, {
      customerId,
      posterSpotId: 1,
      idempotencyKey: 'key-pending',
      totalMinor: 300,
      items: oneItem(),
    });
    const sent = await ordersRepo.createPendingWithItems(prisma, {
      customerId,
      posterSpotId: 1,
      idempotencyKey: 'key-sent',
      totalMinor: 300,
      items: oneItem(),
    });
    await ordersRepo.updateAfterPosterSuccess(prisma, sent.id, '2');

    const pollable = await ordersRepo.findPollable(['sent_to_poster', 'accepted', 'preparing', 'ready']);
    const pollableIds = pollable.map((o) => o.id);

    expect(pollableIds).toContain(sent.id);
    expect(pollableIds).not.toContain(pending.id);
  });

  describe('IdempotencyRepository', () => {
    it('stores requestHash so callers can detect a reused key with a different payload', async () => {
      const order = await ordersRepo.createPendingWithItems(prisma, {
        customerId,
        posterSpotId: 1,
        idempotencyKey: 'idem-key-1',
        totalMinor: 300,
        items: oneItem(),
      });
      await idempotencyRepo.create(prisma, {
        key: 'idem-key-1',
        scope: 'order.create',
        requestHash: 'hash-a',
        orderId: order.id,
      });

      const found = await idempotencyRepo.findByKey('idem-key-1');

      expect(found?.requestHash).toBe('hash-a');
      expect(found?.status).toBe('in_progress');
    });

    it('transitions in_progress -> completed with a stored response snapshot', async () => {
      const order = await ordersRepo.createPendingWithItems(prisma, {
        customerId,
        posterSpotId: 1,
        idempotencyKey: 'idem-key-2',
        totalMinor: 300,
        items: oneItem(),
      });
      await idempotencyRepo.create(prisma, {
        key: 'idem-key-2',
        scope: 'order.create',
        requestHash: 'hash-b',
        orderId: order.id,
      });

      await idempotencyRepo.markCompleted(prisma, 'idem-key-2', JSON.stringify({ orderId: order.id }));

      const found = await idempotencyRepo.findByKey('idem-key-2');
      expect(found?.status).toBe('completed');
      expect(JSON.parse(found!.responseSnapshot as string)).toEqual({ orderId: order.id });
    });

    it('enforces uniqueness on the idempotency key itself', async () => {
      const order = await ordersRepo.createPendingWithItems(prisma, {
        customerId,
        posterSpotId: 1,
        idempotencyKey: 'idem-key-3',
        totalMinor: 300,
        items: oneItem(),
      });
      await idempotencyRepo.create(prisma, {
        key: 'idem-key-3',
        scope: 'order.create',
        requestHash: 'hash-c',
        orderId: order.id,
      });

      await expect(
        idempotencyRepo.create(prisma, {
          key: 'idem-key-3',
          scope: 'order.create',
          requestHash: 'hash-c',
          orderId: order.id,
        }),
      ).rejects.toThrow();
    });
  });
});
