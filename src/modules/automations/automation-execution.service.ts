import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { isUniqueConstraintViolation } from '../../common/util/prisma-errors';
import { CampaignMessagingService } from '../campaigns/campaign-messaging.service';
import { parseStoredConfig, unknownVariables } from './automation-config';
import { AutomationEligibilityService } from './automation-eligibility.service';
import { AutomationMessageService } from './automation-message.service';
import { AutomationSettingsService, CrmSettings } from './automation-settings.service';
import { inQuietHours, localDate, localMinutes } from './automation-time';
import { SkipReason, TriggerCandidate, TriggerType } from './automation.types';
import { AutomationWithRefs, AutomationsRepository } from './automations.repository';
import { ConfigService } from '../../common/config/config.service';

export interface EnqueueResult {
  created: number; // PENDING rows
  skipped: number; // decided SKIPPED (no Telegram / segment mismatch)
  duplicates: number; // trigger key already had an execution — nothing new
}

export interface ProcessResult {
  sent: number;
  failed: number;
  skipped: number;
  deferred: boolean; // quiet hours: due rows were left PENDING
}

const STALE_CLAIM_MS = 10 * 60_000;
const RESERVE_ATTEMPTS = 6;

const isTransient = (err: unknown): boolean => {
  const code = err && typeof err === 'object' ? (err as { code?: string }).code : undefined;
  const text = err instanceof Error ? err.message : '';
  return code === 'P2034' || code === 'P2028' || /locked|busy|timed out|Transaction/i.test(text);
};

const isConflict = (err: unknown): boolean => isUniqueConstraintViolation(err) || (!!err && typeof err === 'object' && (err as { code?: string }).code === 'P2034');

// Decision + delivery. Execution rows are BOTH the decision record and the send queue:
//   enqueue()   - candidate -> (segment / Telegram eligibility) -> a PENDING or SKIPPED row, unique per (automation, triggerKey);
//   processDue() - PENDING rows that are due -> atomic claim -> re-checks -> atomic reservation of cooldown / frequency / daily slots -> send.
// Cooldown, frequency cap and the global daily cap are enforced by UNIQUE reservation rows written in one transaction (see reserve()), so they hold
// under concurrency — not just in application code. Nothing is sent unless BOTH the Admin switch and the operator env gate are open.
@Injectable()
export class AutomationExecutionService {
  private readonly logger = new Logger(AutomationExecutionService.name);

  constructor(
    private readonly repository: AutomationsRepository,
    private readonly eligibility: AutomationEligibilityService,
    private readonly settingsService: AutomationSettingsService,
    private readonly message: AutomationMessageService,
    private readonly campaignMessaging: CampaignMessagingService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async enqueue(automation: AutomationWithRefs, candidates: TriggerCandidate[], options: { skipSegment?: boolean } = {}): Promise<EnqueueResult> {
    const result: EnqueueResult = { created: 0, skipped: 0, duplicates: 0 };
    const CHUNK = 100;
    for (let i = 0; i < candidates.length; i += CHUNK) {
      const decisions = await this.eligibility.evaluate(automation, candidates.slice(i, i + CHUNK), options);
      for (const d of decisions) {
        try {
          await this.repository.createExecution({
            automationId: automation.id,
            customerId: d.candidate.customerId,
            campaignId: automation.campaignId,
            triggerKey: d.candidate.triggerKey,
            status: d.skip ? 'SKIPPED' : 'PENDING',
            reason: d.skip,
            notBeforeAt: d.skip ? null : d.candidate.notBeforeAt,
            decidedAt: d.skip ? new Date() : null,
          });
          if (d.skip) result.skipped += 1;
          else result.created += 1;
        } catch (err) {
          if (!isUniqueConstraintViolation(err)) throw err;
          result.duplicates += 1; // a trigger key can only ever produce ONE execution
        }
      }
    }
    return result;
  }

  async processDue(now: Date, settings: CrmSettings): Promise<ProcessResult> {
    const result: ProcessResult = { sent: 0, failed: 0, skipped: 0, deferred: false };
    const offset = this.config.env.BUSINESS_TIMEZONE_OFFSET_MINUTES;
    const quiet = this.settingsService.quietMinutes(settings);
    // Claims are stamped with the real clock, so their staleness is measured on it too (independent of the decision time `now`).
    await this.repository.sweepStaleClaims(new Date(Date.now() - STALE_CLAIM_MS));
    if (inQuietHours(localMinutes(now, offset), quiet.start, quiet.end)) {
      // Quiet hours: nothing is discarded — due rows simply stay PENDING and are picked up once the window ends.
      result.deferred = true;
      return result;
    }
    const due = await this.repository.findDuePending(now, settings.batchSize);
    for (const row of due) {
      try {
        const outcome = await this.processOne(row, settings, now);
        if (outcome === 'sent') result.sent += 1;
        else if (outcome === 'failed') result.failed += 1;
        else if (outcome === 'skipped') result.skipped += 1;
      } catch (err) {
        // Transient database contention BEFORE a reservation exists: nothing was attempted, so release the claim and retry next tick instead of failing
        // the row. Anything else (or anything after a reservation) is recorded FAILED and is never retried, so a message can never be sent twice.
        if (isTransient(err) && !(await this.repository.hasReservation(row.id))) {
          await this.repository.releaseClaim(row.id).catch(() => undefined);
          this.logger.warn('Automation execution deferred after transient database contention.');
        } else {
          this.logger.error(`Automation execution failed unexpectedly: ${err instanceof Error ? err.message : String(err)}`);
          await this.repository.markFailed(row.id, 'unexpected_error').catch(() => undefined);
          result.failed += 1;
        }
      }
    }
    return result;
  }

  private async processOne(row: { id: string; automationId: string; customerId: string; triggerKey: string; createdAt: Date }, settings: CrmSettings, now: Date): Promise<'sent' | 'failed' | 'skipped' | 'raced'> {
    if (!(await this.repository.claim(row.id))) return 'raced'; // another runner owns it
    const skip = async (reason: SkipReason) => {
      await this.repository.markSkipped(row.id, reason);
      return 'skipped' as const;
    };

    const automation = await this.repository.findById(row.automationId);
    if (!automation || automation.status !== 'ACTIVE') return skip('AUTOMATION_DISABLED');
    if (now.getTime() - row.createdAt.getTime() > settings.maxEventAgeHours * 3_600_000) return skip('EXPIRED');
    const type = automation.triggerType as TriggerType;
    if (!parseStoredConfig(type, automation.triggerConfig)) return skip('INVALID_TRIGGER');
    const campaign = automation.campaign;
    if ((campaign.status !== 'draft' && campaign.status !== 'completed') || campaign.channel !== 'telegram' || campaign.messageText.trim().length === 0 || unknownVariables(campaign.messageText).length > 0) return skip('CAMPAIGN_NOT_READY');

    // Conditions that can change between decision and send.
    if (type === 'ABANDONED_CART') {
      const state = await this.repository.cartStateOf(row.customerId);
      const expected = row.triggerKey.split(':').slice(2).join(':'); // "{cartId}:{activity}.{items}"
      if (!state || `${state.cartId}:${state.activityMs}.${state.itemCount}` !== expected) return skip('CONDITION_NO_LONGER_MET');
    }
    if (type === 'INACTIVE_CUSTOMER') {
      const last = await this.repository.lastPurchaseAt(row.customerId);
      const day = row.triggerKey.split(':')[2];
      if (last === null || localDate(new Date(last), this.config.env.BUSINESS_TIMEZONE_OFFSET_MINUTES) !== day) return skip('CONDITION_NO_LONGER_MET');
    }

    const chatId = (await this.repository.telegramChatIds([row.customerId])).get(row.customerId);
    if (!chatId) return skip('NO_TELEGRAM_ACCOUNT');

    const blocked = await this.reserve(automation, row.id, row.customerId, settings, now);
    if (blocked) return skip(blocked);

    return this.deliverNow(row.id, chatId, campaign.messageText, row.customerId);
  }

  // The ONLY place a message can leave the system. Gate is re-checked here, right before the transport call, so no code path can bypass it.
  private async deliverNow(executionId: string, chatId: string, template: string, customerId: string): Promise<'sent' | 'failed'> {
    const settings = await this.settingsService.get();
    if (!settings.enabled || !this.settingsService.sendGateOpen()) {
      await this.repository.markFailed(executionId, 'send_gate_closed');
      return 'failed';
    }
    const text = await this.message.render(template, customerId);
    const result = await this.campaignMessaging.deliver(chatId, text);
    if (result.outcome === 'sent') {
      await this.repository.markSent(executionId, result.telegramMessageId);
      return 'sent';
    }
    // Definite failure, or an uncertain transport outcome (never auto-retried — a duplicate marketing message is worse than one unresolved one).
    await this.repository.markFailed(executionId, result.errorCode);
    return 'failed';
  }

  // Atomic reservation. Inside ONE transaction: read the customer's last send slot for this automation, then insert ordinal+1 (UNIQUE per
  // automation+customer) and the first free daily slot (UNIQUE per customer+day). Two concurrent sends both try to insert the same ordinal / slot:
  // one wins, the loser's transaction fails on the unique constraint, retries, and now SEES the winner's slot — so it is blocked by cooldown /
  // frequency / daily cap instead of double-sending. Attempted sends count; skips, previews and validation failures never create a slot.
  private async reserve(automation: AutomationWithRefs, executionId: string, customerId: string, settings: CrmSettings, now: Date): Promise<SkipReason | null> {
    const dayKey = localDate(now, this.config.env.BUSINESS_TIMEZONE_OFFSET_MINUTES);
    for (let attempt = 0; attempt < RESERVE_ATTEMPTS; attempt += 1) {
      try {
        return await this.prisma.runTransaction(async (tx) => {
          const last = await this.repository.lastSendSlot(tx, automation.id, customerId);
          if (last && automation.cooldownHours > 0 && now.getTime() - last.createdAt.getTime() < automation.cooldownHours * 3_600_000) return 'COOLDOWN' as const;
          const count = last ? last.ordinal : 0;
          if (automation.maxSendsPerCustomer !== null && count >= automation.maxSendsPerCustomer) return 'FREQUENCY_LIMIT' as const;
          const used = await this.repository.usedDailySlots(tx, customerId, dayKey);
          let slot = 0;
          for (let s = 1; s <= settings.dailyLimit; s += 1) {
            if (!used.has(s)) {
              slot = s;
              break;
            }
          }
          if (slot === 0) return 'DAILY_LIMIT' as const;
          // Slots carry the DECISION time (`now`), so cooldown is measured on the same clock the decision uses.
          await this.repository.createSendSlot(tx, { automationId: automation.id, customerId, ordinal: count + 1, executionId, createdAt: now });
          await this.repository.createDailySlot(tx, { customerId, dayKey, slot, executionId, createdAt: now });
          return null;
        });
      } catch (err) {
        if (!isConflict(err)) throw err; // lost the race for a slot: loop, re-read, decide again
      }
    }
    // Could not settle the race after several attempts: never risk a duplicate send.
    return 'COOLDOWN';
  }
}
