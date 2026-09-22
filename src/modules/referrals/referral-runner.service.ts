import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { ConfigService } from '../../common/config/config.service';
import { QualificationSummary, ReferralQualificationService } from './referral-qualification.service';

export const REFERRAL_BATCH_SIZE = 100;

// In-process scheduling only (same mechanism as the Loyalty 2.0 sync and the CRM runner): decides WHEN to run qualification. It does nothing at all
// while Referrals is switched off in Admin, never overlaps itself, and a failure only logs. It calls no external service.
@Injectable()
export class ReferralRunnerService implements OnModuleInit {
  private readonly logger = new Logger(ReferralRunnerService.name);
  private running = false;

  constructor(
    private readonly qualification: ReferralQualificationService,
    private readonly config: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    const interval = setInterval(() => void this.tick(), this.config.env.REFERRAL_RUN_INTERVAL_MS);
    interval.unref?.();
    this.schedulerRegistry.addInterval('referral-runner', interval);
  }

  async tick(now: Date = new Date()): Promise<QualificationSummary | 'BUSY'> {
    if (this.running) return 'BUSY';
    this.running = true;
    try {
      const summary = await this.qualification.qualifyBatch(now, REFERRAL_BATCH_SIZE);
      if (summary.status === 'RAN' && summary.examined + summary.reconciled > 0) {
        this.logger.log(`Referral tick examined=${summary.examined} qualified=${summary.qualified} closed=${summary.closed} rewardsGranted=${summary.rewardsGranted} reconciled=${summary.reconciled}`);
      }
      return summary;
    } catch (err) {
      this.logger.error(`Referral tick failed: ${err instanceof Error ? err.message : String(err)}`);
      return { status: 'RAN', examined: 0, qualified: 0, closed: 0, kept: 0, rewardsGranted: 0, reconciled: 0 };
    } finally {
      this.running = false;
    }
  }
}
