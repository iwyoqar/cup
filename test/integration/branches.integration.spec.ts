import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import nock from 'nock';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { cleanDatabase } from '../db-test-helper';
import getSpotsFixture from '../fixtures/poster/get-spots.json';

const BASE = 'https://joinposter.com';

// Full app, real SQLite test db, Poster mocked via nock/fixtures — never live. Mirrors
// docs/PHASE-0-PLAN.md's testing pattern, applied to Phase 1.2's branch sync.
describe('Branches (integration)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
    nock.restore();
  });

  beforeEach(async () => {
    nock.cleanAll();
    await cleanDatabase(prisma);
  });

  it('POST /branches/sync against the real captured spot shape, then GET /branches returns only the mapped, active branch fields', async () => {
    nock(BASE).get('/api/access.getSpots').query(true).reply(200, getSpotsFixture);

    const syncRes = await request(app.getHttpServer()).post('/branches/sync').expect(201);
    expect(syncRes.body).toEqual({ branchesSynced: 1, branchesSkipped: [] });

    const listRes = await request(app.getHttpServer()).get('/branches').expect(200);
    expect(listRes.body).toEqual([
      { id: expect.any(String), name: 'iwyoqar', address: null, isActive: true },
    ]);
    // posterSpotId/syncedAt must not leak into the API response.
    expect(listRes.body[0]).not.toHaveProperty('posterSpotId');
    expect(listRes.body[0]).not.toHaveProperty('syncedAt');
  });

  it('GET /branches excludes inactive branches', async () => {
    await prisma.branch.createMany({
      data: [
        { posterSpotId: 1, name: 'Active Branch', isActive: true },
        { posterSpotId: 2, name: 'Closed Branch', isActive: false },
      ],
    });

    const res = await request(app.getHttpServer()).get('/branches').expect(200);

    expect(res.body).toEqual([{ id: expect.any(String), name: 'Active Branch', address: null, isActive: true }]);
  });

  it('a later sync soft-deactivates a branch no longer returned by Poster', async () => {
    await prisma.branch.create({ data: { posterSpotId: 99, name: 'Old Branch', isActive: true } });

    nock(BASE).get('/api/access.getSpots').query(true).reply(200, getSpotsFixture);
    await request(app.getHttpServer()).post('/branches/sync').expect(201);

    const oldBranch = await prisma.branch.findUnique({ where: { posterSpotId: 99 } });
    expect(oldBranch?.isActive).toBe(false);

    const newBranch = await prisma.branch.findUnique({ where: { posterSpotId: 1 } });
    expect(newBranch?.isActive).toBe(true);
  });

  it('a definite Poster failure on sync does not touch existing branches', async () => {
    await prisma.branch.create({ data: { posterSpotId: 1, name: 'Existing Branch', isActive: true } });

    nock(BASE).get('/api/access.getSpots').query(true).reply(200, { error: { code: 1, message: 'no rights' } });

    await request(app.getHttpServer()).post('/branches/sync').expect(500);

    const branch = await prisma.branch.findUnique({ where: { posterSpotId: 1 } });
    expect(branch?.isActive).toBe(true);
  });
});
