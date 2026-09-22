import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { ConfigService } from './common/config/config.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    logger: ['log', 'warn', 'error'],
  });
  // Phase 24 — without this, SIGTERM (what Render, and any container platform, sends on every deploy/restart/scale-down) kills the process
  // immediately: in-flight requests are cut off mid-response and PrismaService.onModuleDestroy() (which calls $disconnect()) never runs, leaving
  // the connection to close uncleanly instead of gracefully. This makes Nest listen for SIGTERM/SIGINT, run every module's onModuleDestroy, and
  // only then let the process exit. Harmless locally (Ctrl+C already behaves the same either way).
  app.enableShutdownHooks();
  const config = app.get(ConfigService);
  // Phase 1.7: the Mini App frontend is served from its own origin (MINI_APP_URL), never from
  // this backend — it must be able to call the API cross-origin. Safe to reflect any origin
  // here since auth is a bearer JWT in the Authorization header, not a cookie: there is no
  // ambient credential for a cross-site request to ride along on.
  //
  // Phase 9: maxAge lets the browser cache the preflight result. Without it every Authorization/
  // JSON request from the Mini App was preceded by its own OPTIONS round trip — a full extra network
  // RTT per API call (Chromium caps this at 2h, Firefox at 24h; either is enough to cover a session).
  app.enableCors({ maxAge: 86400 });
  // Phase 20: Poster's webhook documentation does not state the Content-Type it sends (its own PHP sample reads the raw body and json_decodes it). Accept ANY
  // content type on the webhook route and parse it as JSON; every other route keeps Fastify's default behaviour (unknown types stay 415).
  // Phase 22: the same uncertainty applies to POST /pos-widget/rewards/redeem — Poster.makeRequest proxies this POST too, and its real Content-Type has
  // never been observed (docs/PHASE-22-AUDIT.md §7). A normal `application/json` POST is unaffected either way (Fastify's own default JSON parser handles
  // it before this wildcard ever runs); this only matters if Poster mislabels the body, exactly the class of problem Phase 20 already hit.
  const JSON_TOLERANT_PATHS = ['/webhooks/poster', '/pos-widget/rewards/redeem', '/pos-widget/promotions/redeem'];
  app.getHttpAdapter().getInstance().addContentTypeParser('*', { parseAs: 'string' }, (request: { url: string }, body: string, done: (err: Error | null, value?: unknown) => void) => {
    if (!JSON_TOLERANT_PATHS.includes(request.url.split('?')[0])) {
      const err = Object.assign(new Error('Unsupported Media Type'), { statusCode: 415 });
      done(err);
      return;
    }
    try {
      done(null, body.length === 0 ? {} : JSON.parse(body));
    } catch {
      const err = Object.assign(new Error('Invalid JSON'), { statusCode: 400 });
      done(err);
    }
  });
  // Temporary Phase 1.7 tunnel-debugging aid: there is otherwise zero visibility into whether
  // an inbound request ever reaches this process at all (no HTTP access logging existed before
  // this line). Logs only method/path/status — never headers, body, query string, or the
  // Authorization/JWT/initData a request might carry.
  const requestLogger = new Logger('HTTP');
  app.getHttpAdapter().getInstance().addHook('onResponse', (request, reply, done) => {
    requestLogger.log(`${request.method} ${request.url.split('?')[0]} -> ${reply.statusCode}`);
    done();
  });
  await app.listen(config.env.PORT, '0.0.0.0');
  Logger.log(`CUP backend listening on port ${config.env.PORT}`, 'Bootstrap');
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal error during bootstrap:', err);
  process.exit(1);
});
