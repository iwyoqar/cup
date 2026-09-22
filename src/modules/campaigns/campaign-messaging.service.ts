import { Injectable, Logger } from '@nestjs/common';
import { TelegramMessagingService } from '../telegram/telegram-messaging.service';
import { CampaignRecipientsRepository } from './campaign-recipients.repository';

// Bounded, not configurable via Admin Settings — same reasoning as
// MAX_NOTIFICATION_ATTEMPTS in order-notification.service.ts: an internal reliability
// implementation detail, not a business rule a founder would reasonably want to tune per
// environment. See campaigns.service.ts's comment on Admin Configurability for the same
// reasoning applied to Phase 6's other constants.
const MAX_SEND_ATTEMPTS = 2; // initial attempt + at most one retry, ONLY for a rate-limit response.
const INTER_SEND_DELAY_MS = 60; // conservative pacing, well under Telegram's ~30 msg/sec global cap.
const RATE_LIMIT_RETRY_CAP_MS = 5000; // never block the request longer than this for one retry.

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Owns the actual send loop over a campaign's frozen recipient set. Sequential, not parallel —
// this alone bounds concurrent Telegram API calls to 1, which combined with INTER_SEND_DELAY_MS
// is this phase's entire "respect Telegram API constraints" strategy (spec: "do not add
// Redis/BullMQ/a queue — use the existing application architecture, but do not send in an
// uncontrolled loop"). One recipient's failure — send error OR an unexpected DB error while
// recording the result — is always caught and logged, never allowed to abort the remaining
// recipients (spec: "one bad customer must not abort the entire campaign").
@Injectable()
export class CampaignMessagingService {
  private readonly logger = new Logger(CampaignMessagingService.name);

  constructor(
    private readonly telegramMessagingService: TelegramMessagingService,
    private readonly repository: CampaignRecipientsRepository,
  ) {}

  async sendToRecipients(campaignId: string, targets: { customerId: string; chatId: string }[], messageText: string): Promise<void> {
    for (const target of targets) {
      try {
        await this.sendOne(campaignId, target, messageText);
      } catch (err) {
        this.logger.error(`Unexpected error sending campaign=${campaignId} to customer=${target.customerId}: ${safeMessage(err)}`);
      }
      await sleep(INTER_SEND_DELAY_MS);
    }
  }

  // Phase 13: the ONE send policy (Telegram transport + a single retry only for a rate-limit response), exposed without touching campaign
  // recipients so CRM automation can reuse it for its own delivery records. `uncertain` is NEVER retried (a possible duplicate marketing
  // message is worse than one unresolved delivery).
  async deliver(chatId: string, messageText: string): Promise<DeliveryResult> {
    for (let attempt = 1; ; attempt += 1) {
      const result = await this.telegramMessagingService.sendText(chatId, messageText);
      if (result.outcome === 'sent') return { outcome: 'sent', telegramMessageId: result.telegramMessageId };
      if (result.outcome === 'rate_limited' && attempt < MAX_SEND_ATTEMPTS) {
        await sleep(Math.min((result.retryAfterSeconds ?? 1) * 1000, RATE_LIMIT_RETRY_CAP_MS));
        continue;
      }
      if (result.outcome === 'uncertain') return { outcome: 'uncertain', errorCode: result.errorCode };
      return { outcome: 'failed', errorCode: result.errorCode };
    }
  }

  private async sendOne(campaignId: string, target: { customerId: string; chatId: string }, messageText: string): Promise<void> {
    const result = await this.deliver(target.chatId, messageText);
    if (result.outcome === 'sent') {
      await this.repository.markSent(campaignId, target.customerId, result.telegramMessageId);
      return;
    }
    if (result.outcome === 'uncertain') {
      // CRITICAL (spec's Important Reliability Principle): never auto-retried; the row is left exactly as created ('pending').
      this.logger.warn(`Uncertain delivery outcome for campaign=${campaignId} customer=${target.customerId}: ${result.errorCode}`);
      return;
    }
    // A definite, permanent failure (or a rate-limit retry that was exhausted) — mark it and move on.
    await this.repository.markFailed(campaignId, target.customerId, result.errorCode);
  }
}

export type DeliveryResult = { outcome: 'sent'; telegramMessageId: string } | { outcome: 'failed'; errorCode: string } | { outcome: 'uncertain'; errorCode: string };

function safeMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
