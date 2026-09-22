import { Body, Controller, HttpCode, Post, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { PosterWebhookService } from './poster-webhook.service';

// PUBLIC route (Poster cannot send a bearer token): authenticity comes from the documented `verify` signature, checked with the Poster application secret.
// Deliberately NOT under /admin and with no guard — everything about trust lives in PosterWebhookService.
@Controller('webhooks')
export class PosterWebhookController {
  constructor(private readonly webhook: PosterWebhookService) {}

  @Post('poster')
  @HttpCode(200)
  async receive(@Body() body: unknown, @Res({ passthrough: true }) reply: FastifyReply) {
    const result = await this.webhook.receive(body);
    reply.status(result.httpStatus);
    return result.body;
  }
}
