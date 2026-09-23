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
  // matches the ONE documented acknowledgement shape ({"status":"accept"} — en/web/webhooks.md).
  //
  // KNOWN ISSUE (2026-09-23, unresolved, not a CUP bug): Poster's dashboard "Check" button still shows a red X
  // against this endpoint even though it was independently verified healthy — GET/HEAD both return a clean,
  // fast 200 with this exact body, and the TLS chain is valid (openssl s_client: Verify return code 0). An
  // undocumented {"status":"200"} probe was also tried live and did not help either. The problem is on Poster's
  // side (its own Check feature, or something about how its check reaches this host) — do not "fix" this again
  // by guessing more response shapes without new evidence. POSTER_SYNC_ENABLED's reconciliation loop (see
  // poster-reconcile.service.ts) is the fully-working fallback in the meantime: every closed receipt is picked
  // up within POSTER_RECONCILE_INTERVAL_MS regardless of whether any webhook ever arrives, so nothing is lost —
  // only near-real-time delivery is missing. Revisit only if Poster support identifies a real cause, or if
  // POSTER_APPLICATION_SECRET/the account's webhook entity selection turn out to be misconfigured on Poster's
  // side (unverified — the dashboard would not let "Receive webhooks by" register a selection during this
  // investigation either, a separate symptom that was never resolved).
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
