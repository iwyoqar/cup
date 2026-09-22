import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '../../src/common/config/config.service';
import { hashPayload } from '../../src/common/util/stable-hash';
import { CatalogRepository } from '../../src/modules/catalog/catalog.repository';
import { CustomersRepository } from '../../src/modules/customers/customers.repository';
import { PosterCreateOrderOutcome, PosterService } from '../../src/modules/poster/poster.service';
import { CreateOrderInput } from '../../src/modules/orders/create-order.dto';
import { IdempotencyRepository } from '../../src/modules/orders/idempotency.repository';
import {
  IdempotencyKeyInProgressError,
  IdempotencyKeyUncertainError,
  IdempotencyPayloadMismatchError,
  OrderCreationFailedError,
} from '../../src/modules/orders/orders.errors';
import { OrdersRepository } from '../../src/modules/orders/orders.repository';
import { OrdersService } from '../../src/modules/orders/orders.service';
import { PrismaService } from '../../src/common/prisma/prisma.service';

const INPUT: CreateOrderInput = {
  customerId: 'customer-1',
  items: [{ productId: 'product-1', quantity: 2 }],
};

const REQUEST_HASH = hashPayload({ customerId: INPUT.customerId, items: INPUT.items });

const FAKE_PRODUCT = {
  id: 'product-1',
  posterProductId: '3',
  isActive: true,
  priceMinor: 300,
};

const FAKE_ORDER = {
  id: 'order-1',
  customerId: 'customer-1',
  posterSpotId: 1,
  idempotencyKey: 'key-1',
  status: 'pending',
  totalMinor: 600,
  items: [],
};

function buildService(overrides?: {
  posterCreateOrder?: jest.Mock;
  existingIdempotencyRecord?: unknown;
}) {
  const prisma = {
    runTransaction: jest.fn((fn: (tx: unknown) => unknown) => fn({})),
  } as unknown as PrismaService;

  const ordersRepository = {
    createPendingWithItems: jest.fn().mockResolvedValue(FAKE_ORDER),
    updateAfterPosterSuccess: jest.fn().mockResolvedValue(undefined),
    updateStatus: jest.fn().mockResolvedValue(undefined),
    resetToPendingForRetryWithFreshPricing: jest.fn().mockResolvedValue(undefined),
    findById: jest.fn().mockResolvedValue(FAKE_ORDER),
    findPollable: jest.fn().mockResolvedValue([]),
  } as unknown as OrdersRepository;

  const idempotencyRepository = {
    findByKey: jest.fn().mockResolvedValue(overrides?.existingIdempotencyRecord ?? null),
    create: jest.fn().mockResolvedValue(undefined),
    markInProgress: jest.fn().mockResolvedValue(undefined),
    markCompleted: jest.fn().mockResolvedValue(undefined),
    markFailed: jest.fn().mockResolvedValue(undefined),
    markUncertain: jest.fn().mockResolvedValue(undefined),
  } as unknown as IdempotencyRepository;

  const catalogRepository = {
    findProductById: jest.fn().mockResolvedValue(FAKE_PRODUCT),
  } as unknown as CatalogRepository;

  const customersRepository = {
    findById: jest.fn().mockResolvedValue({ id: 'customer-1', phone: '+998912090511', posterClientId: null }),
  } as unknown as CustomersRepository;

  const poster = {
    createOrder:
      overrides?.posterCreateOrder ??
      jest.fn<Promise<PosterCreateOrderOutcome>, unknown[]>().mockResolvedValue({
        kind: 'success',
        incomingOrderId: '2',
      }),
    getOrderStatus: jest.fn(),
  } as unknown as PosterService;

  const service = new OrdersService(
    ordersRepository,
    idempotencyRepository,
    catalogRepository,
    customersRepository,
    poster,
    prisma,
    new ConfigService(),
  );

  return { service, ordersRepository, idempotencyRepository, catalogRepository, customersRepository, poster };
}

describe('OrdersService.createOrder — idempotency state machine', () => {
  it('fresh request + Poster success: persists order, marks idempotency completed, returns the result', async () => {
    const { service, ordersRepository, idempotencyRepository, poster } = buildService();

    const result = await service.createOrder('key-1', INPUT);

    expect(result).toEqual({ orderId: 'order-1', status: 'sent_to_poster', posterIncomingOrderId: '2' });
    expect(poster.createOrder).toHaveBeenCalledWith({
      spot_id: 1,
      phone: '+998912090511',
      products: [{ product_id: 3, count: 2 }],
    });
    expect(ordersRepository.updateAfterPosterSuccess).toHaveBeenCalledWith(expect.anything(), 'order-1', '2');
    expect(idempotencyRepository.markCompleted).toHaveBeenCalled();
  });

  it('fresh request + Poster definite failure: order and key marked failed, throws OrderCreationFailedError (502)', async () => {
    const { service, ordersRepository, idempotencyRepository } = buildService({
      posterCreateOrder: jest.fn().mockResolvedValue({ kind: 'definite_failure', reason: 'invalid product' }),
    });

    await expect(service.createOrder('key-1', INPUT)).rejects.toBeInstanceOf(OrderCreationFailedError);

    expect(ordersRepository.updateStatus).toHaveBeenCalledWith(expect.anything(), 'order-1', 'failed');
    expect(idempotencyRepository.markFailed).toHaveBeenCalled();
  });

  it('fresh request + Poster ambiguous failure: order and key marked uncertain, throws IdempotencyKeyUncertainError, NEVER auto-retries', async () => {
    const { service, ordersRepository, idempotencyRepository, poster } = buildService({
      posterCreateOrder: jest.fn().mockResolvedValue({ kind: 'ambiguous_failure', reason: 'timeout' }),
    });

    await expect(service.createOrder('key-1', INPUT)).rejects.toBeInstanceOf(IdempotencyKeyUncertainError);

    expect(ordersRepository.updateStatus).toHaveBeenCalledWith(expect.anything(), 'order-1', 'uncertain');
    expect(idempotencyRepository.markUncertain).toHaveBeenCalled();
    expect(poster.createOrder).toHaveBeenCalledTimes(1);
  });

  it('replay of a completed key: returns the stored snapshot WITHOUT calling Poster again', async () => {
    const { service, poster } = buildService({
      existingIdempotencyRecord: {
        key: 'key-1',
        requestHash: REQUEST_HASH,
        status: 'completed',
        responseSnapshot: JSON.stringify({ orderId: 'order-1', status: 'sent_to_poster', posterIncomingOrderId: '2' }),
        orderId: 'order-1',
      },
    });

    const result = await service.createOrder('key-1', INPUT);

    expect(result).toEqual({ orderId: 'order-1', status: 'sent_to_poster', posterIncomingOrderId: '2' });
    expect(poster.createOrder).not.toHaveBeenCalled();
  });

  it('replay while a request is in_progress (fresh, not stale): rejects with 409, never calls Poster', async () => {
    const { service, poster } = buildService({
      existingIdempotencyRecord: {
        key: 'key-1',
        requestHash: REQUEST_HASH,
        status: 'in_progress',
        orderId: 'order-1',
        updatedAt: new Date(),
      },
    });

    await expect(service.createOrder('key-1', INPUT)).rejects.toBeInstanceOf(IdempotencyKeyInProgressError);
    expect(poster.createOrder).not.toHaveBeenCalled();
  });

  it('replay while a request is in_progress but STALE (older than the configured threshold): downgrades to uncertain, never calls Poster', async () => {
    const { service, ordersRepository, idempotencyRepository, poster } = buildService({
      existingIdempotencyRecord: {
        key: 'key-1',
        requestHash: REQUEST_HASH,
        status: 'in_progress',
        orderId: 'order-1',
        updatedAt: new Date(0), // unambiguously older than any configured staleness threshold
      },
    });

    await expect(service.createOrder('key-1', INPUT)).rejects.toBeInstanceOf(IdempotencyKeyUncertainError);

    expect(poster.createOrder).not.toHaveBeenCalled();
    expect(ordersRepository.updateStatus).toHaveBeenCalledWith(expect.anything(), 'order-1', 'uncertain');
    expect(idempotencyRepository.markUncertain).toHaveBeenCalledWith(expect.anything(), 'key-1');
  });

  it('replay of an uncertain key: rejects with 409 and does NOT auto-retry against Poster', async () => {
    const { service, poster } = buildService({
      existingIdempotencyRecord: { key: 'key-1', requestHash: REQUEST_HASH, status: 'uncertain', orderId: 'order-1' },
    });

    await expect(service.createOrder('key-1', INPUT)).rejects.toBeInstanceOf(IdempotencyKeyUncertainError);
    expect(poster.createOrder).not.toHaveBeenCalled();
  });

  it('same key reused with a DIFFERENT payload: rejects with 422, never calls Poster', async () => {
    const { service, poster } = buildService({
      existingIdempotencyRecord: { key: 'key-1', requestHash: 'a-different-hash', status: 'completed', orderId: 'order-1' },
    });

    await expect(service.createOrder('key-1', INPUT)).rejects.toBeInstanceOf(IdempotencyPayloadMismatchError);
    expect(poster.createOrder).not.toHaveBeenCalled();
  });

  it('recognizes the same logical order regardless of item array order (items are normalized before hashing)', async () => {
    const items = [
      { productId: 'product-1', quantity: 1 },
      { productId: 'product-2', quantity: 3 },
    ];
    const reorderedItems = [...items].reverse();
    const sortedForHash = [...items].sort((a, b) => a.productId.localeCompare(b.productId));
    const requestHash = hashPayload({ customerId: 'customer-1', items: sortedForHash });

    const { service, catalogRepository, poster } = buildService({
      existingIdempotencyRecord: {
        key: 'key-order-test',
        requestHash,
        status: 'completed',
        responseSnapshot: JSON.stringify({ orderId: 'order-1', status: 'sent_to_poster', posterIncomingOrderId: '2' }),
        orderId: 'order-1',
      },
    });
    (catalogRepository.findProductById as jest.Mock).mockImplementation((id: string) =>
      Promise.resolve(
        id === 'product-1' ? FAKE_PRODUCT : { ...FAKE_PRODUCT, id: 'product-2', posterProductId: '4', priceMinor: 200 },
      ),
    );

    const result = await service.createOrder('key-order-test', { customerId: 'customer-1', items: reorderedItems });

    expect(result).toEqual({ orderId: 'order-1', status: 'sent_to_poster', posterIncomingOrderId: '2' });
    expect(poster.createOrder).not.toHaveBeenCalled();
  });

  it('replay of a failed key with the SAME payload: resets the order (with re-resolved pricing) and retries against Poster', async () => {
    const { service, ordersRepository, idempotencyRepository, poster } = buildService({
      existingIdempotencyRecord: { key: 'key-1', requestHash: REQUEST_HASH, status: 'failed', orderId: 'order-1' },
    });

    const result = await service.createOrder('key-1', INPUT);

    expect(ordersRepository.resetToPendingForRetryWithFreshPricing).toHaveBeenCalledWith(
      expect.anything(),
      'order-1',
      { totalMinor: 600, items: [expect.objectContaining({ unitPriceMinor: 300, totalPriceMinor: 600 })] },
    );
    expect(idempotencyRepository.markInProgress).toHaveBeenCalledWith(expect.anything(), 'key-1');
    expect(poster.createOrder).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('sent_to_poster');
  });

  it('replay of a failed key when catalog prices changed since the original attempt: persists the NEW price and sends it to Poster (no stale pricing)', async () => {
    const { service, ordersRepository, catalogRepository, poster } = buildService({
      existingIdempotencyRecord: { key: 'key-1', requestHash: REQUEST_HASH, status: 'failed', orderId: 'order-1' },
    });
    // Simulate a catalog sync that changed the Cappuccino's price between the original failed
    // attempt (which would have used 300) and this retry.
    (catalogRepository.findProductById as jest.Mock).mockResolvedValue({ ...FAKE_PRODUCT, priceMinor: 350 });

    await service.createOrder('key-1', INPUT);

    // Persisted order/item pricing reflects the NEW price...
    expect(ordersRepository.resetToPendingForRetryWithFreshPricing).toHaveBeenCalledWith(
      expect.anything(),
      'order-1',
      { totalMinor: 700, items: [expect.objectContaining({ unitPriceMinor: 350, totalPriceMinor: 700 })] },
    );
    // ...and Poster receives the same items that were just persisted (DB and Poster payload
    // stay consistent) — quantity is what Poster's payload carries per poster.types.ts.
    expect(poster.createOrder).toHaveBeenCalledWith({
      spot_id: 1,
      phone: '+998912090511',
      products: [{ product_id: 3, count: 2 }],
    });
  });

  it('rejects an unknown/inactive product before ever calling Poster', async () => {
    const { service, catalogRepository, poster } = buildService();
    (catalogRepository.findProductById as jest.Mock).mockResolvedValueOnce(null);

    await expect(service.createOrder('key-1', INPUT)).rejects.toBeInstanceOf(BadRequestException);
    expect(poster.createOrder).not.toHaveBeenCalled();
  });

  it('rejects an unknown customerId before ever calling Poster', async () => {
    const { service, customersRepository, poster } = buildService();
    (customersRepository.findById as jest.Mock).mockResolvedValueOnce(null);

    await expect(service.createOrder('key-1', INPUT)).rejects.toBeInstanceOf(BadRequestException);
    expect(poster.createOrder).not.toHaveBeenCalled();
  });

  it('rejects a customer with neither a phone nor a linked Poster client, before ever calling Poster', async () => {
    const { service, customersRepository, poster } = buildService();
    (customersRepository.findById as jest.Mock).mockResolvedValueOnce({
      id: 'customer-1',
      phone: null,
      posterClientId: null,
    });

    await expect(service.createOrder('key-1', INPUT)).rejects.toBeInstanceOf(BadRequestException);
    expect(poster.createOrder).not.toHaveBeenCalled();
  });

  it('prefers a linked Poster client_id over phone when the customer already has one', async () => {
    const { service, customersRepository, poster } = buildService();
    (customersRepository.findById as jest.Mock).mockResolvedValueOnce({
      id: 'customer-1',
      phone: '+998912090511',
      posterClientId: '42',
    });

    await service.createOrder('key-1', INPUT);

    expect(poster.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({ client_id: 42 }),
    );
    const callArg = (poster.createOrder as jest.Mock).mock.calls[0][0];
    expect(callArg).not.toHaveProperty('phone');
  });
});
