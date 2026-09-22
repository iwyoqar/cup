import { Injectable } from '@nestjs/common';
import { EventCursor, ReferralsRepository } from './referrals.repository';
import { ReferralEvent } from './referral.types';

export interface ReferralStreamEvent extends ReferralEvent {
  cursor: EventCursor;
}

// Phase 14 — referral events for Phase 13 CRM Automation to use LATER. Same model as AutomationEventsService: no bus, no queue, no persisted event log —
// the referral lifecycle timestamps ARE the log and this derives typed, ordered events from them on demand, bounded and resumable from a
// per-consumer cursor. Events come only from state-changing rows (never from a GET), each occurrence has a deterministic key
// (`referral:{referralId}:{TYPE}`), and this service sends NOTHING: a future automation trigger decides what to do with an event.
@Injectable()
export class ReferralEventsService {
  constructor(private readonly repository: ReferralsRepository) {}

  async after(cursor: EventCursor | null, sinceMs: number, limit: number): Promise<ReferralStreamEvent[]> {
    const rows = await this.repository.eventsAfter(cursor, sinceMs, Math.max(1, Math.min(limit, 500)));
    return rows.map((r) => ({ ...r.event, cursor: r.cursor }));
  }
}
