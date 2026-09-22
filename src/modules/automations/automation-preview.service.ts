import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '../../common/config/config.service';
import { unknownVariables } from './automation-config';
import { AutomationEligibilityService } from './automation-eligibility.service';
import { AutomationMessageService } from './automation-message.service';
import { AutomationRunnerService } from './automation-runner.service';
import { AutomationSettingsService } from './automation-settings.service';
import { AutomationTriggerService } from './automation-trigger.service';
import { inQuietHours, localDate, localMinutes } from './automation-time';
import { AutomationsRepository } from './automations.repository';

export interface AutomationPreview {
  mode: 'preview';
  notice: string;
  trigger: string;
  campaign: { name: string; status: string; ready: boolean; unresolvedVariables: string[] };
  sendGate: { crmEnabled: boolean; envGateOpen: boolean };
  quietHoursNow: boolean;
  matched: number;
  alreadyProcessed: number;
  segmentMismatch: number;
  noTelegram: number;
  cooldownBlocked: number;
  frequencyBlocked: number;
  dailyLimitBlocked: number;
  finalRecipients: number;
  sample: { displayName: string | null; outcome: string }[];
  sampleMessage: string | null;
  truncated: boolean;
}

const PREVIEW_LIMIT = 500;

// Dry run. Reads only: it runs the SAME detection and eligibility code as the runner (with a candidate limit) but writes nothing — no execution
// rows, no reservation slots, no cursor/run-key changes, no Telegram, no customer state. The counters answer: who matches, who is reachable, who
// would be blocked by cooldown / frequency / daily cap, and who would finally receive the message.
@Injectable()
export class AutomationPreviewService {
  constructor(
    private readonly repository: AutomationsRepository,
    private readonly triggers: AutomationTriggerService,
    private readonly eligibility: AutomationEligibilityService,
    private readonly settingsService: AutomationSettingsService,
    private readonly runner: AutomationRunnerService,
    private readonly message: AutomationMessageService,
    private readonly config: ConfigService,
  ) {}

  async preview(automationId: string, now: Date = new Date()): Promise<AutomationPreview> {
    const automation = await this.repository.findById(automationId);
    if (!automation) throw new NotFoundException('Automation not found.');
    const settings = await this.settingsService.get();
    const offset = this.config.env.BUSINESS_TIMEZONE_OFFSET_MINUTES;
    const quiet = this.settingsService.quietMinutes(settings);

    // A DRAFT/PAUSED automation has no activation instant: preview as if it had been activated `maxEventAge` ago (what a fresh activation would
    // look at). An ACTIVE one resumes from its real cursor, so the preview shows exactly the next batch.
    const active = automation.status === 'ACTIVE';
    const ctx = this.runner.detectionContext({ ...settings, batchSize: PREVIEW_LIMIT }, { activatedAt: active ? automation.activatedAt : new Date(now.getTime() - settings.maxEventAgeHours * 3_600_000) }, now);
    const detection = await this.triggers.detect(automation, ctx, active ? automation.eventCursor : null);

    const existing = await this.repository.existingTriggerKeys(automation.id, detection.candidates.map((c) => c.triggerKey));
    const fresh = detection.candidates.filter((c) => !existing.has(c.triggerKey));
    const decisions = await this.eligibility.evaluate(automation, fresh, { skipSegment: automation.triggerType === 'SCHEDULED_SEGMENT' });

    const eligibleIds = decisions.filter((d) => !d.skip).map((d) => d.candidate.customerId);
    const [slots, daily] = await Promise.all([this.repository.sendSlotSnapshot(automation.id, eligibleIds), this.repository.dailySlotCounts(eligibleIds, localDate(now, offset))]);

    let cooldown = 0;
    let frequency = 0;
    let dailyBlocked = 0;
    const final: string[] = [];
    const outcomes = new Map<string, string>();
    for (const d of decisions) {
      const id = d.candidate.customerId;
      if (d.skip) {
        outcomes.set(id, d.skip);
        continue;
      }
      const slot = slots.get(id);
      if (slot?.lastAt && automation.cooldownHours > 0 && now.getTime() - slot.lastAt.getTime() < automation.cooldownHours * 3_600_000) {
        cooldown += 1;
        outcomes.set(id, 'COOLDOWN');
      } else if (automation.maxSendsPerCustomer !== null && (slot?.count ?? 0) >= automation.maxSendsPerCustomer) {
        frequency += 1;
        outcomes.set(id, 'FREQUENCY_LIMIT');
      } else if ((daily.get(id) ?? 0) >= settings.dailyLimit) {
        dailyBlocked += 1;
        outcomes.set(id, 'DAILY_LIMIT');
      } else {
        final.push(id);
        outcomes.set(id, 'WOULD_SEND');
      }
    }

    const names = await this.repository.customerNames([...outcomes.keys()].slice(0, 20));
    const unresolved = unknownVariables(automation.campaign.messageText);
    const ready = (automation.campaign.status === 'draft' || automation.campaign.status === 'completed') && automation.campaign.channel === 'telegram' && automation.campaign.messageText.trim().length > 0 && unresolved.length === 0;
    return {
      mode: 'preview',
      notice: "Preview — xabar yuborilmaydi",
      trigger: automation.triggerType,
      campaign: { name: automation.campaign.name, status: automation.campaign.status, ready, unresolvedVariables: unresolved },
      sendGate: { crmEnabled: settings.enabled, envGateOpen: this.settingsService.sendGateOpen() },
      quietHoursNow: inQuietHours(localMinutes(now, offset), quiet.start, quiet.end),
      matched: detection.candidates.length,
      alreadyProcessed: existing.size,
      segmentMismatch: decisions.filter((d) => d.skip === 'SEGMENT_MISMATCH').length,
      noTelegram: decisions.filter((d) => d.skip === 'NO_TELEGRAM_ACCOUNT').length,
      cooldownBlocked: cooldown,
      frequencyBlocked: frequency,
      dailyLimitBlocked: dailyBlocked,
      finalRecipients: final.length,
      // Display names only — no ids, phone numbers or Telegram identifiers.
      sample: [...outcomes.entries()].slice(0, 20).map(([id, outcome]) => ({ displayName: names.get(id)?.displayName ?? null, outcome })),
      sampleMessage: final.length > 0 ? await this.message.render(automation.campaign.messageText, final[0]) : null,
      truncated: detection.more,
    };
  }
}
