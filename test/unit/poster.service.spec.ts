import nock from 'nock';
import { ConfigService } from '../../src/common/config/config.service';
import { PosterService } from '../../src/modules/poster/poster.service';

import getCategoriesFixture from '../fixtures/poster/get-categories.json';
import getProductsFixture from '../fixtures/poster/get-products.json';
import createOrderSuccessFixture from '../fixtures/poster/create-incoming-order-success.json';
import getOwnOrderPendingFixture from '../fixtures/poster/get-own-incoming-order-pending.json';
import errorBadTokenFixture from '../fixtures/poster/error-bad-token.json';
import getSpotsFixture from '../fixtures/poster/get-spots.json';

const BASE = 'https://joinposter.com';

describe('PosterService (against fixtures via nock, never live Poster)', () => {
  let service: PosterService;

  beforeEach(() => {
    nock.cleanAll();
    service = new PosterService(new ConfigService());
  });

  afterAll(() => {
    nock.restore();
  });

  it('getCategories() parses the response envelope', async () => {
    nock(BASE).get('/api/menu.getCategories').query(true).reply(200, getCategoriesFixture);

    const categories = await service.getCategories();

    expect(categories).toEqual(getCategoriesFixture.response);
  });

  it('getProducts() parses the response envelope, including the verified Капучино fact', async () => {
    nock(BASE).get('/api/menu.getProducts').query(true).reply(200, getProductsFixture);

    const products = await service.getProducts();

    expect(products).toContainEqual(
      expect.objectContaining({ product_id: '3', product_name: 'Капучино 250 мл' }),
    );
  });

  it('createOrder() returns a success outcome with the incoming order id', async () => {
    nock(BASE).post('/api/incomingOrders.createIncomingOrder').query(true).reply(200, createOrderSuccessFixture);

    const outcome = await service.createOrder({ spot_id: 1, products: [{ product_id: 3, count: 1 }] });

    expect(outcome).toEqual({ kind: 'success', incomingOrderId: '2' });
  });

  it('createOrder() classifies an HTTP-200 error envelope as a DEFINITE failure (verified live Poster behavior)', async () => {
    nock(BASE).post('/api/incomingOrders.createIncomingOrder').query(true).reply(200, errorBadTokenFixture);

    const outcome = await service.createOrder({ spot_id: 1, products: [{ product_id: 3, count: 1 }] });

    expect(outcome.kind).toBe('definite_failure');
  });

  it('createOrder() classifies a network failure as an AMBIGUOUS failure, never a definite one', async () => {
    nock(BASE).post('/api/incomingOrders.createIncomingOrder').query(true).replyWithError('socket hang up');

    const outcome = await service.createOrder({ spot_id: 1, products: [{ product_id: 3, count: 1 }] });

    expect(outcome.kind).toBe('ambiguous_failure');
  });

  it('createOrder() classifies a 500 with no parseable body as AMBIGUOUS, not definite', async () => {
    nock(BASE).post('/api/incomingOrders.createIncomingOrder').query(true).reply(500, 'upstream error');

    const outcome = await service.createOrder({ spot_id: 1, products: [{ product_id: 3, count: 1 }] });

    expect(outcome.kind).toBe('ambiguous_failure');
  });

  it('getOrderStatus() parses a pending order (status 0) from a single-object response (VERIFIED live shape)', async () => {
    nock(BASE).get('/api/incomingOrders.getOwnIncomingOrders').query(true).reply(200, getOwnOrderPendingFixture);

    const order = await service.getOrderStatus('2');

    expect(order).toEqual(expect.objectContaining({ incoming_order_id: 2, status: 0 }));
  });

  it('getOrderStatus() returns null for a response with no recognizable incoming_order_id (defensive — real "not found" shape is unverified)', async () => {
    nock(BASE).get('/api/incomingOrders.getOwnIncomingOrders').query(true).reply(200, { response: [] });

    const order = await service.getOrderStatus('999');

    expect(order).toBeNull();
  });

  it('never logs or exposes the Poster token in a thrown error message', async () => {
    nock(BASE).post('/api/incomingOrders.createIncomingOrder').query(true).reply(500, 'boom');

    const outcome = await service.createOrder({ spot_id: 1, products: [{ product_id: 3, count: 1 }] });

    expect(outcome.kind).toBe('ambiguous_failure');
    if (outcome.kind === 'ambiguous_failure') {
      expect(outcome.reason).not.toContain('test-token');
      expect(outcome.reason).toContain('REDACTED');
    }
  });

  it('getSpots() parses the real captured response envelope (VERIFIED live shape, 2026-09-18)', async () => {
    nock(BASE).get('/api/access.getSpots').query(true).reply(200, getSpotsFixture);

    const spots = await service.getSpots();

    expect(spots).toEqual([
      expect.objectContaining({ spot_id: '1', spot_name: 'iwyoqar', spot_adress: '' }),
    ]);
  });

  it('getSpots() propagates a definite failure the same way other methods do (HTTP-200 error envelope)', async () => {
    nock(BASE).get('/api/access.getSpots').query(true).reply(200, { error: { code: 1, message: 'no rights' } });

    await expect(service.getSpots()).rejects.toThrow();
  });

  it('getSpots() propagates a network failure as PosterAmbiguousError (never silently returns [])', async () => {
    nock(BASE).get('/api/access.getSpots').query(true).replyWithError('socket hang up');

    await expect(service.getSpots()).rejects.toThrow();
  });
});
