import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { cleanDatabase } from '../db-test-helper';
import { buildValidInitData } from '../telegram-test-vectors';

// Full app, real SQLite test db. Never calls real Telegram or real Poster — initData is
// generated deterministically with the same TELEGRAM_BOT_TOKEN test value configured in
// test/setup-env.ts.
describe('Auth (integration): POST /auth/telegram, GET /auth/me', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  const botToken = process.env.TELEGRAM_BOT_TOKEN as string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);
  });

  it('creates a customer and issues a session on first login', async () => {
    const initData = buildValidInitData({ telegramUserId: 1001, firstName: 'Ada' }, botToken);

    const res = await request(app.getHttpServer()).post('/auth/telegram').send({ initData }).expect(201);

    expect(res.body.sessionToken).toEqual(expect.any(String));
    expect(res.body.customer).toEqual({
      id: expect.any(String),
      displayName: 'Ada User',
      phone: null,
      telegramUserId: '1001',
    });
    expect(await prisma.customer.count()).toBe(1);
  });

  it('logging in again with the same Telegram user reuses the same customer and updates profile fields', async () => {
    const first = await request(app.getHttpServer())
      .post('/auth/telegram')
      .send({ initData: buildValidInitData({ telegramUserId: 1002, username: 'first' }, botToken) })
      .expect(201);

    const second = await request(app.getHttpServer())
      .post('/auth/telegram')
      .send({ initData: buildValidInitData({ telegramUserId: 1002, username: 'updated' }, botToken) })
      .expect(201);

    expect(second.body.customer.id).toBe(first.body.customer.id);
    expect(await prisma.customer.count()).toBe(1);
    const account = await prisma.telegramAccount.findUnique({ where: { telegramUserId: '1002' } });
    expect(account?.username).toBe('updated');
  });

  it('rejects a tampered signature with 401', async () => {
    const initData = buildValidInitData({ telegramUserId: 1003 }, botToken).replace(
      /hash=[a-f0-9]+/,
      `hash=${'0'.repeat(64)}`,
    );

    await request(app.getHttpServer()).post('/auth/telegram').send({ initData }).expect(401);
  });

  it('rejects missing initData with 400', async () => {
    await request(app.getHttpServer()).post('/auth/telegram').send({}).expect(400);
  });

  it('ignores a spoofed customerId/telegramUserId/posterClientId in the request body', async () => {
    const initData = buildValidInitData({ telegramUserId: 1004 }, botToken);

    const res = await request(app.getHttpServer())
      .post('/auth/telegram')
      .send({ initData, customerId: 'some-other-customer-id', telegramUserId: '999999', posterClientId: 'poster-999' })
      .expect(201);

    expect(res.body.customer.telegramUserId).toBe('1004');
    expect(res.body.customer.id).not.toBe('some-other-customer-id');
  });

  it('two concurrent first-logins for the SAME Telegram user result in exactly one customer', async () => {
    const initData = buildValidInitData({ telegramUserId: 1005 }, botToken);

    const [first, second] = await Promise.all([
      request(app.getHttpServer()).post('/auth/telegram').send({ initData }),
      request(app.getHttpServer()).post('/auth/telegram').send({ initData }),
    ]);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.customer.id).toBe(second.body.customer.id);
    expect(await prisma.customer.count()).toBe(1);
    expect(await prisma.telegramAccount.count()).toBe(1);
  });

  describe('GET /auth/me', () => {
    async function loginAndGetToken(telegramUserId: number): Promise<string> {
      const initData = buildValidInitData({ telegramUserId }, botToken);
      const res = await request(app.getHttpServer()).post('/auth/telegram').send({ initData }).expect(201);
      return res.body.sessionToken as string;
    }

    it('returns the authenticated customer profile', async () => {
      const token = await loginAndGetToken(2001);

      const res = await request(app.getHttpServer()).get('/auth/me').set('Authorization', `Bearer ${token}`).expect(200);

      expect(res.body).toEqual({
        id: expect.any(String),
        displayName: 'Test User',
        phone: null,
        telegramUserId: '2001',
      });
    });

    it('rejects a missing session token with 401', async () => {
      await request(app.getHttpServer()).get('/auth/me').expect(401);
    });

    it('rejects an invalid session token with 401', async () => {
      await request(app.getHttpServer()).get('/auth/me').set('Authorization', 'Bearer not-a-real-token').expect(401);
    });

    it('ignores a spoofed customerId query param — identity comes only from the session token', async () => {
      const tokenA = await loginAndGetToken(2002);
      const otherRes = await request(app.getHttpServer())
        .post('/auth/telegram')
        .send({ initData: buildValidInitData({ telegramUserId: 2003 }, botToken) })
        .expect(201);
      const otherCustomerId = otherRes.body.customer.id;

      const res = await request(app.getHttpServer())
        .get(`/auth/me?customerId=${otherCustomerId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      expect(res.body.telegramUserId).toBe('2002');
      expect(res.body.id).not.toBe(otherCustomerId);
    });
  });
});
