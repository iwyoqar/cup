import { Body, Controller, Get, HttpCode, Post, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { PosterWebhookService } from './poster-webhook.service';

// PUBLIC route (Poster cannot send a bearer token): authenticity comes from the documented `verify` signature, checked with the Poster application secret.
// Deliberately NOT under /admin and with no guard — everything about trust lives in PosterWebhookService.
@Controller('webhooks')
export class PosterWebhookController {
  constructor(private readonly webhook: PosterWebhookService) {}

  // Poster's dashboard "Check" button GETs this exact URL before accepting it as a webhook target — it only ever
  // verifies reachability, never delivers a real event this way (real events always arrive as POST). The body
  // deliberately matches the ONE documented acknowledgement shape ({"status":"accept"} — en/web/webhooks.md) rather
  // than an invented value: the Check may validate the body, not just the HTTP status.
  @Get('poster')
  check() {
    return { status: 'accept' };
  }

  @Post('poster')
  @HttpCode(200)
  async receive(@Body() body: unknown, @Res({ passthrough: true }) reply: FastifyReply) {
    const result = await this.webhook.receive(body);
    reply.status(result.httpStatus);
    return result.body;
  }
}
