import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import nock from 'nock';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { OrdersService } from '../../src/modules/orders/orders.service';
import { cleanDatabase } from '../db-test-helper';

import getCategoriesFixture from '../fixtures/poster/get-categories.json';
import getProductsFixture from '../fixtures/poster/get-products.json';
import createOrderSuccessFixture from '../fixtures/poster/create-incoming-order-success.json';
import getOwnOrderAcceptedFixture from '../fixtures/poster/get-own-incoming-order-accepted.json';

const BASE = 'https://joinposter.com';

// Full app, real SQLite test db, Poster entirely mocked via nock/fixtures — see
// docs/PHASE-0-PLAN.md section 11. No live Poster call is ever made in this suite.
describe('Orders flow (integration)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let ordersService: OrdersService;
  let customerId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    prisma = app.get(PrismaService);
    ordersService = app.get(OrdersService);
  });

  afterAll(async () => {
    await app.close();
    nock.restore();
  });

  beforeEach(async () => {
    nock.cleanAll();
    await cleanDatabase(prisma);

    const customer = await prisma.customer.create({
      data: { displayName: 'Integration Test Customer', phone: '+15550000000' },
    });
    customerId = customer.id;

    nock(BASE).get('/api/menu.getCategories').query(true).reply(200, getCategoriesFixture);
    nock(BASE).get('/api/menu.getProducts').query(true).reply(200, getProductsFixture);
    await request(app.getHttpServer()).post('/catalog/sync').expect(201);
  });

  it('POST /orders -> GET /orders/:id -> simulated poll tick reaches "accepted", mirroring the verified 0->1 Poster transition', async () => {
    const [product] = await prisma.product.findMany();

    nock(BASE).post('/api/incomingOrders.createIncomingOrder').query(true).reply(200, createOrderSuccessFixture);

    const createRes = await request(app.getHttpServer())
      .post('/orders')
      .set('Idempotency-Key', 'integration-key-1')
      .send({ customerId, items: [{ productId: product.id, quantity: 1 }] })
      .expect(201);

    expect(createRes.body).toEqual({
      orderId: expect.any(String),
      status: 'sent_to_poster',
      posterIncomingOrderId: '2',
    });

    const orderId = createRes.body.orderId as string;

    const afterCreate = await request(app.getHttpServer()).get(`/orders/${orderId}`).expect(200);
    expect(afterCreate.body.status).toBe('sent_to_poster');

    nock(BASE).get('/api/incomingOrders.getOwnIncomingOrders').query(true).reply(200, getOwnOrderAcceptedFixture);
    await ordersService.refreshStatus(orderId);

    const afterPoll = await request(app.getHttpServer()).get(`/orders/${orderId}`).expect(200);
    expect(afterPoll.body.status).toBe('accepted');
  });

  it('retrying the same Idempotency-Key never creates a second Poster order', async () => {
    const [product] = await prisma.product.findMany();

    // Registered once, on purpose: if OrdersService called Poster a second time, nock would
    // have no matching interceptor left and the request would fail — so the second response
    // matching the first byte-for-byte is itself proof Poster was only ever called once.
    nock(BASE).post('/api/incomingOrders.createIncomingOrder').query(true).reply(200, createOrderSuccessFixture);

    const body = { customerId, items: [{ productId: product.id, quantity: 1 }] };

    const first = await request(app.getHttpServer())
      .post('/orders')
      .set('Idempotency-Key', 'integration-key-2')
      .send(body)
      .expect(201);

    const second = await request(app.getHttpServer())
      .post('/orders')
      .set('Idempotency-Key', 'integration-key-2')
      .send(body)
      .expect(201);

    expect(second.body).toEqual(first.body);
  });

  it('an ambiguous Poster outcome (network failure) marks the order "uncertain" and blocks auto-retry with a 409', async () => {
    const [product] = await prisma.product.findMany();
    nock(BASE).post('/api/incomingOrders.createIncomingOrder').query(true).replyWithError('socket hang up');

    const body = { customerId, items: [{ productId: product.id, quantity: 1 }] };

    const firstAttempt = await request(app.getHttpServer())
      .post('/orders')
      .set('Idempotency-Key', 'integration-key-3')
      .send(body)
      .expect(409);
    expect(firstAttempt.body.message).toContain('uncertain');

    const secondAttempt = await request(app.getHttpServer())
      .post('/orders')
      .set('Idempotency-Key', 'integration-key-3')
      .send(body)
      .expect(409);
    expect(secondAttempt.body.message).toContain('Manual reconciliation');
  });

  it('rejects reuse of an Idempotency-Key with a different payload (422)', async () => {
    const [product] = await prisma.product.findMany();
    nock(BASE).post('/api/incomingOrders.createIncomingOrder').query(true).reply(200, createOrderSuccessFixture);

    await request(app.getHttpServer())
      .post('/orders')
      .set('Idempotency-Key', 'integration-key-4')
      .send({ customerId, items: [{ productId: product.id, quantity: 1 }] })
      .expect(201);

    await request(app.getHttpServer())
      .post('/orders')
      .set('Idempotency-Key', 'integration-key-4')
      .send({ customerId, items: [{ productId: product.id, quantity: 2 }] })
      .expect(422);
  });

  it('rejects a request with no Idempotency-Key header (400)', async () => {
    const [product] = await prisma.product.findMany();

    await request(app.getHttpServer())
      .post('/orders')
      .send({ customerId, items: [{ productId: product.id, quantity: 1 }] })
      .expect(400);
  });
});
