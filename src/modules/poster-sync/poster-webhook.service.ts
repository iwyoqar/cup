import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../../common/config/config.service';
import { PosterSyncProcessorService } from './poster-sync-processor.service';
import { PosterSyncRepository } from './poster-sync.repository';
import { parsePosterWebhook, verifyPosterWebhookSignature, webhookDedupeKey } from './poster-webhook-signature';

export interface WebhookReply {
  httpStatus: number;
  body: { status: 'accept' | 'rejected' | 'unavailable' };
}

// The only object that carries a POS sale. Every other Poster entity (incoming_order, product, client, ...) is verified when it can be, acknowledged so Poster
// does not retry it 15 times, and NOT stored: CUP has no use for it and a noisy entity must never grow the table.
export const HANDLED_OBJECT = 'transaction';

// Phase 20 — the webhook RECEIVER. It does exactly four things, in order, and nothing else: verify the documented signature, persist the event durably,
// wake the processor, and acknowledge. It never calls Poster, never touches the import tables and never blocks on business logic, so a slow Poster, a slow
// import or a burst of retries can never slow the POS down. The acknowledgement is sent only AFTER the row is committed: if the database is down the request
// fails (HTTP 500) and Poster's own retry delivers it again — that is what makes the queue lossless.
@Injectable()
export class PosterWebhookService {
  private readonly logger = new Logger(PosterWebhookService.name);
  private ignored = 0;
  private rejected = 0;

  constructor(
    private readonly config: ConfigService,
    private readonly repository: PosterSyncRepository,
    private readonly processor: PosterSyncProcessorService,
  ) {}

  counters() {
    return { ignoredOtherObjects: this.ignored, rejectedSinceStart: this.rejected };
  }

  async receive(body: unknown): Promise<WebhookReply> {
    const secret = this.config.env.POSTER_APPLICATION_SECRET;
    // Without the application secret nothing can be verified. Answer "unavailable" (never "accept") so nothing is silently dropped and Poster keeps retrying.
    if (!secret) return { httpStatus: 503, body: { status: 'unavailable' } };

    // Poster does not document the Content-Type it sends. Fastify already parses application/json into an object; text/plain arrives as a raw STRING —
    // both are the same JSON document, so a string is parsed here (anything that is not JSON is malformed).
    let document: unknown = body;
    try {
      document = normalizeBody(body);
    } catch {
      this.rejected += 1;
      return { httpStatus: 400, body: { status: 'rejected' } };
    }
    const parsed = parsePosterWebhook(document);
    if (!parsed.ok) {
      if (parsed.reason === 'UNSUPPORTED_DATA') {
        // A structured `data` value has no documented serialisation, so its signature cannot be checked. It belongs to an entity CUP does not consume;
        // acknowledge (so Poster stops retrying) and store nothing.
        this.ignored += 1;
        return { httpStatus: 200, body: { status: 'accept' } };
      }
      this.rejected += 1;
      return { httpStatus: 400, body: { status: 'rejected' } };
    }

    const { payload, verify } = parsed;
    if (!verifyPosterWebhookSignature(payload, verify, secret)) {
      this.rejected += 1;
      this.logger.warn('Poster webhook rejected: signature mismatch.');
      return { httpStatus: 401, body: { status: 'rejected' } };
    }
    const pinned = this.config.env.POSTER_ACCOUNT;
    if (pinned && payload.account !== pinned) {
      this.rejected += 1;
      this.logger.warn('Poster webhook rejected: unexpected Poster account.');
      return { httpStatus: 401, body: { status: 'rejected' } };
    }

    if (payload.object !== HANDLED_OBJECT) {
      this.ignored += 1;
      return { httpStatus: 200, body: { status: 'accept' } };
    }

    const seconds = Number(payload.time);
    const { created } = await this.repository.recordDelivery({
      dedupeKey: webhookDedupeKey(payload),
      object: payload.object,
      objectId: payload.objectId,
      action: payload.action,
      eventAt: new Date(seconds * 1000),
      account: payload.account,
    });
    if (created) this.logger.log(`Poster webhook stored: ${payload.object} ${payload.action} #${payload.objectId}`);
    this.processor.kick(); // non-blocking: schedules a tick shortly, never awaited
    return { httpStatus: 200, body: { status: 'accept' } };
  }
}

// The same JSON document can reach the server in three shapes, depending on the Content-Type Poster labels it with (undocumented):
//   application/json                    -> already an object
//   text/plain / anything else          -> a raw string holding the JSON
//   application/x-www-form-urlencoded   -> either real key=value pairs (an object of strings — fine as is), or a raw JSON body carrying that label, which
//                                          Fastify's form parser turns into a single-key object whose KEY is the JSON text and whose value is empty.
export function normalizeBody(body: unknown): unknown {
  if (typeof body === 'string') return JSON.parse(body);
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const keys = Object.keys(body as Record<string, unknown>);
    if (keys.length === 1 && keys[0].trimStart().startsWith('{') && ((body as Record<string, unknown>)[keys[0]] === '' || (body as Record<string, unknown>)[keys[0]] === undefined)) return JSON.parse(keys[0]);
  }
  return body;
}
