import { Injectable } from '@nestjs/common';
import { SegmentsService } from '../segments/segments.service';
import { SkipReason, TriggerCandidate } from './automation.types';
import { AutomationWithRefs, AutomationsRepository } from './automations.repository';

export interface EligibilityDecision {
  candidate: TriggerCandidate;
  skip: SkipReason | null; // null = eligible (becomes a PENDING execution)
}

// Eligibility for ONE bounded batch of candidates: the automation's optional Segment (existing SegmentsService — conditions are never copied, dynamic
// evaluation stays authoritative) and Telegram reachability (a TelegramAccount must exist; no fake recipient is ever created). Cooldown, frequency cap
// and the global daily cap are NOT decided here: they are reserved atomically at send time (see AutomationExecutionService) because they depend on
// what other executions have already happened.
@Injectable()
export class AutomationEligibilityService {
  constructor(
    private readonly segments: SegmentsService,
    private readonly repository: AutomationsRepository,
  ) {}

  async evaluate(automation: AutomationWithRefs, candidates: TriggerCandidate[], options: { skipSegment?: boolean } = {}): Promise<EligibilityDecision[]> {
    if (candidates.length === 0) return [];
    const ids = [...new Set(candidates.map((c) => c.customerId))];
    const [inSegment, chatIds] = await Promise.all([
      automation.segmentId && !options.skipSegment ? this.segments.filterCustomersInSegment(automation.segmentId, ids) : Promise.resolve<Set<string> | null>(null),
      this.repository.telegramChatIds(ids),
    ]);
    return candidates.map((candidate) => {
      if (automation.segmentId && !options.skipSegment && !(inSegment && inSegment.has(candidate.customerId))) return { candidate, skip: 'SEGMENT_MISMATCH' as const };
      if (!chatIds.has(candidate.customerId)) return { candidate, skip: 'NO_TELEGRAM_ACCOUNT' as const };
      return { candidate, skip: null };
    });
  }
}
