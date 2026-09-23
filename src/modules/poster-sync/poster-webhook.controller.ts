import { Body, Controller, Get, HttpCode, Post, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { PosterWebhookService } from './poster-webhook.service';

// PUBLIC route (Poster cannot send a bearer token): authenticity comes from the documented `verify` signature, checked with the Poster application secret.
// Deliberately NOT under /admin and with no guard — everything about trust lives in PosterWebhookService.
@Controller('webhooks')
export class PosterWebhookController {
  constructor(private readonly webhook: PosterWebhookService) {}

  // Poster's dashboard "Check" button GETs this exact URL before accepting it as a webhook target — it only ever
  // verifies reachability, never delivers a real event this way (real events always arrive as POST).
  // EXPERIMENTAL (2026-09-23): {"status":"accept"} — the one documented acknowledgement shape (en/web/webhooks.md)
  // — did NOT make Poster's dashboard Check pass, despite the GET itself verified fast/correct (200, clean TLS
  // chain). Trying {"status":"200"} as an undocumented probe at the operator's explicit request; revert to
  // "accept" (or drop this route entirely) if this doesn't help either — it has no documentation support.
  @Get('poster')
  check() {
    return { status: '200' };
  }

  @Post('poster')
  @HttpCode(200)
  async receive(@Body() body: unknown, @Res({ passthrough: true }) reply: FastifyReply) {
    const result = await this.webhook.receive(body);
    reply.status(result.httpStatus);
    return result.body;
  }
}
