import { Controller, Get, HttpCode, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PosterService } from '../poster/poster.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly poster: PosterService,
    private readonly prisma: PrismaService,
  ) {}

  // Liveness only — the process is up and answering HTTP. Unchanged behaviour/shape from before Phase 24: anything already pointed at this exact
  // route (e.g. a platform's health check, or this project's own dev-tunnel recovery scripts) keeps working identically.
  @Get()
  health() {
    return { status: 'ok' };
  }

  @Get('poster')
  async posterHealth() {
    try {
      await this.poster.getCategories();
      return { poster: 'ok' };
    } catch (err) {
      return { poster: 'unreachable', detail: err instanceof Error ? err.message : String(err) };
    }
  }

  // Phase 24 — readiness: can this process actually reach its database right now. `SELECT 1` is valid, identical SQL on both SQLite and PostgreSQL,
  // so this needs no dialect branching (see src/common/prisma/sql-dialect.ts for the queries that DO). A real deployment platform's readiness probe
  // should point here, not at the bare liveness check above, so a process that's up but can't reach its DB is correctly taken out of rotation.
  @Get('db')
  @HttpCode(200)
  async dbHealth() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', database: 'reachable' };
    } catch (err) {
      throw new ServiceUnavailableException({ status: 'unavailable', database: 'unreachable', detail: err instanceof Error ? err.message : String(err) });
    }
  }
}
