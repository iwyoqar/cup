import { ConfigService } from '../../src/common/config/config.service';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { CatalogRepository } from '../../src/modules/catalog/catalog.repository';
import { CustomersRepository } from '../../src/modules/customers/customers.repository';
import { IdempotencyRepository } from '../../src/modules/orders/idempotency.repository';
import { OrdersRepository } from '../../src/modules/orders/orders.repository';
import { OrdersService } from '../../src/modules/orders/orders.service';
import { PosterService } from '../../src/modules/poster/poster.service';

const SENT_ORDER = {
  id: 'order-1',
  status: 'sent_to_poster',
  posterIncomingOrderId: '2',
};

function buildService(getOrderStatus: jest.Mock) {
  const ordersRepository = {
    findById: jest.fn().mockResolvedValue(SENT_ORDER),
    updateStatus: jest.fn().mockResolvedValue(undefined),
  } as unknown as OrdersRepository;

  const poster = { getOrderStatus, createOrder: jest.fn() } as unknown as PosterService;
  const prisma = { runTransaction: jest.fn() } as unknown as PrismaService;

  const service = new OrdersService(
    ordersRepository,
    {} as IdempotencyRepository,
    {} as CatalogRepository,
    {} as CustomersRepository,
    poster,
    prisma,
    new ConfigService(),
  );

  return { service, ordersRepository };
}

describe('OrdersService.refreshStatus — Poster status mapping', () => {
  it('maps Poster status "1" to CUP status "accepted" and persists it (verified mapping)', async () => {
    const { service, ordersRepository } = buildService(
      jest.fn().mockResolvedValue({ incoming_order_id: '2', status: '1' }),
    );

    await service.refreshStatus('order-1');

    expect(ordersRepository.updateStatus).toHaveBeenCalledWith(expect.anything(), 'order-1', 'accepted');
  });

  it('does not write anything when the mapped status is unchanged', async () => {
    const { service, ordersRepository } = buildService(
      jest.fn().mockResolvedValue({ incoming_order_id: '2', status: '0' }),
    );
    (ordersRepository.findById as jest.Mock).mockResolvedValue({ ...SENT_ORDER, status: 'pending' });

    await service.refreshStatus('order-1');

    expect(ordersRepository.updateStatus).not.toHaveBeenCalled();
  });

  it('an UNMAPPED Poster status code is logged and left unchanged — never guessed at (per Phase 0 rule)', async () => {
    const { service, ordersRepository } = buildService(
      jest.fn().mockResolvedValue({ incoming_order_id: '2', status: '7' }),
    );

    await expect(service.refreshStatus('order-1')).resolves.toBeUndefined();
    expect(ordersRepository.updateStatus).not.toHaveBeenCalled();
  });

  it('does nothing when Poster returns no matching order', async () => {
    const { service, ordersRepository } = buildService(jest.fn().mockResolvedValue(null));

    await service.refreshStatus('order-1');

    expect(ordersRepository.updateStatus).not.toHaveBeenCalled();
  });
});
