import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { ConfigService } from '../../common/config/config.service';
import { AutomationExecutionService } from './automation-execution.service';
import { AutomationSettingsService, CrmSettings } from './automation-settings.service';
import { AutomationTriggerService, DetectionContext } from './automation-trigger.service';
import { unknownVariables } from './automation-config';
import { AutomationWithRefs, AutomationsRepository } from './automations.repository';

export type TickStatus = 'RAN' | 'CRM_DISABLED' | 'SEND_GATE_CLOSED' | 'THROTTLED' | 'BUSY';

export interface TickSummary {
  status: TickStatus;
  automations: number;
  matched: number;
  created: number;
  skipped: number;
  duplicates: number;
  sent: number;
  failed: number;
  deferred: boolean;
  durationMs: number;
}

// The automation runner: Automation -> trigger detection -> eligibility -> execution rows -> (existing) campaign messaging.
//  - A pure NO-OP unless BOTH gates are open: the Admin switch crm.automation.enabled AND the operator env CRM_AUTOMATION_SEND_ENABLED. With a gate
//    closed it neither detects, queues nor sends (preview remains available in Admin), so enabling later can never release a backlog.
//  - Bounded: every automation reads at most `batchSize` candidates per tick and resumes from its persisted cursor; no customer-base scan.
//  - Safe to run twice at once: an in-process guard, plus unique trigger keys, compare-and-set cursors/run keys, atomic row claims and unique
//    reservation slots in the database (for multiple processes).
@Injectable()
export class AutomationRunnerService implements OnModuleInit {
  private readonly logger = new Logger(AutomationRunnerService.name);
  private running = false;
  private lastTickAt = 0;

  constructor(
    private readonly repository: AutomationsRepository,
    private readonly triggers: AutomationTriggerService,
    private readonly execution: AutomationExecutionService,
    private readonly settingsService: AutomationSettingsService,
    private readonly config: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    const interval = setInterval(() => {
      this.tick().catch((err) => this.logger.error(`Automation tick failed: ${err instanceof Error ? err.message : String(err)}`));
    }, this.config.env.AUTOMATION_RUN_INTERVAL_MS);
    interval.unref?.();
    this.schedulerRegistry.addInterval('crm-automation-runner', interval);
  }

  async tick(now: Date = new Date(), options: { force?: boolean } = {}): Promise<TickSummary> {
    const started = Date.now();
    const summary: TickSummary = { status: 'RAN', automations: 0, matched: 0, created: 0, skipped: 0, duplicates: 0, sent: 0, failed: 0, deferred: false, durationMs: 0 };
    if (this.running) return { ...summary, status: 'BUSY' };
    const settings = await this.settingsService.get();
    if (!settings.enabled) return { ...summary, status: 'CRM_DISABLED' };
    if (!this.settingsService.sendGateOpen()) return { ...summary, status: 'SEND_GATE_CLOSED' };
    if (!options.force && now.getTime() - this.lastTickAt < settings.runIntervalSeconds * 1000) return { ...summary, status: 'THROTTLED' };
    this.running = true;
    this.lastTickAt = now.getTime();
    try {
      const active = await this.repository.findActive();
      summary.automations = active.length;
      for (const automation of active) {
        try {
          const r = await this.runAutomation(automation, settings, now);
          summary.matched += r.matched;
          summary.created += r.created;
          summary.skipped += r.skipped;
          summary.duplicates += r.duplicates;
        } catch (err) {
          this.logger.error(`Automation ${automation.id} (${automation.triggerType}) run failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      const processed = await this.execution.processDue(now, settings);
      summary.sent = processed.sent;
      summary.failed = processed.failed;
      summary.skipped += processed.skipped;
      summary.deferred = processed.deferred;
    } finally {
      this.running = false;
      summary.durationMs = Date.now() - started;
      // Counts only — never customer ids, chat ids, phone numbers or message text.
      this.logger.log(
        `CRM tick: automations=${summary.automations} matched=${summary.matched} queued=${summary.created} skipped=${summary.skipped} duplicates=${summary.duplicates} sent=${summary.sent} failed=${summary.failed} deferred=${summary.deferred} ms=${summary.durationMs}`,
      );
    }
    return summary;
  }

  detectionContext(settings: CrmSettings, automation: Pick<AutomationWithRefs, 'activatedAt'>, now: Date): DetectionContext {
    const enabledAtMs = settings.enabledAt ? Date.parse(settings.enabledAt) : 0;
    return {
      now,
      offsetMinutes: this.config.env.BUSINESS_TIMEZONE_OFFSET_MINUTES,
      // Nothing before activation, before CRM was switched on, or older than the max event age may fire.
      watermarkMs: Math.max(automation.activatedAt ? automation.activatedAt.getTime() : now.getTime(), enabledAtMs, now.getTime() - settings.maxEventAgeHours * 3_600_000),
      batchSize: settings.batchSize,
      cartExpiryMs: this.config.env.CART_EXPIRY_MS,
    };
  }

  private async runAutomation(automation: AutomationWithRefs, settings: CrmSettings, now: Date): Promise<{ matched: number; created: number; skipped: number; duplicates: number }> {
    const started = Date.now();
    const none = { matched: 0, created: 0, skipped: 0, duplicates: 0 };
    const campaign = automation.campaign;
    if ((campaign.status !== 'draft' && campaign.status !== 'completed') || campaign.channel !== 'telegram' || campaign.messageText.trim().length === 0 || unknownVariables(campaign.messageText).length > 0) {
      this.logger.warn(`Automation ${automation.id} skipped: campaign not ready`);
      return none;
    }
    const detection = await this.triggers.detect(automation, this.detectionContext(settings, automation, now));
    if (detection.invalid) {
      this.logger.warn(`Automation ${automation.id} (${automation.triggerType}) has an invalid trigger: ${detection.notes.join(',')}`);
      return none;
    }
    // Once-per-occurrence work (scheduled segment) is CLAIMED first so two runners can never both materialise it.
    if (automation.triggerType === 'SCHEDULED_SEGMENT' && detection.doneRunKey && !(await this.repository.claimRunKey(automation.id, detection.doneRunKey))) return none;

    const enqueued = await this.execution.enqueue(automation, detection.candidates, { skipSegment: automation.triggerType === 'SCHEDULED_SEGMENT' });

    if (detection.nextCursor) await this.repository.advanceCursor(automation.id, automation.eventCursor, detection.nextCursor);
    if (automation.triggerType === 'BIRTHDAY' && detection.doneRunKey) await this.repository.claimRunKey(automation.id, detection.doneRunKey);
    await this.repository.touchRun(automation.id);
    this.logger.log(
      `automation=${automation.id} trigger=${automation.triggerType} batch=${detection.candidates.length} queued=${enqueued.created} skipped=${enqueued.skipped} duplicates=${enqueued.duplicates} more=${detection.more} ms=${Date.now() - started}`,
    );
    return { matched: detection.candidates.length, ...enqueued };
  }
}
