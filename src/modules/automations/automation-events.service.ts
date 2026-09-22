import { Injectable } from '@nestjs/common';
import { CustomerEvent } from './automation.types';
import { AutomationsRepository, EventCursor } from './automations.repository';

export interface StreamEvent extends CustomerEvent {
  cursor: EventCursor; // position of this event in the stream (resume point for the consumer)
}

// The lightweight internal customer-event abstraction (Phase 13). There is NO bus, queue or persisted event log: the canonical tables ARE the log,
// and this service derives typed, ordered events from them on demand, bounded and resumable from a per-consumer cursor. Events are only ever
// derived from state-changing business rows (orders, imported POS purchases, carts, birthdays) — never from a GET request.
//
//   PURCHASE_COMPLETED  — a qualifying CUP order (source key = Order.id) or an IMPORTED POS purchase (source key = the Poster transaction id).
//                         Event time = Order.createdAt / PosterImportedTransaction.importedAt (when CUP learned of the sale, so a late import
//                         is a new event). The canonical id — never amount / time / customer — is the event identity, so one purchase yields
//                         exactly one event; CUP-originated receipts are never IMPORTED, so they cannot yield a second one.
//   REWARD_UNLOCKED / LOYALTY_MILESTONE_REACHED — derived by the trigger evaluators from PURCHASE_COMPLETED batches (a value crossing a threshold).
//   BIRTHDAY_REACHED / CART_ABANDONED — derived by the evaluators from Customer.birthDate and Cart/CartItem.
@Injectable()
export class AutomationEventsService {
  constructor(private readonly repository: AutomationsRepository) {}

  async purchaseCompleted(cursor: EventCursor | null, sinceMs: number, untilMs: number, limit: number): Promise<StreamEvent[]> {
    const rows = await this.repository.purchaseEventsAfter(cursor, sinceMs, untilMs, limit);
    return rows.map((r) => ({
      type: 'PURCHASE_COMPLETED',
      customerId: r.customerId,
      sourceKey: r.src === 'C' ? `CUP:${r.sourceKey}` : `POS:${r.sourceKey}`,
      at: new Date(r.t),
      cursor: { t: r.t, src: r.src, id: r.id },
    }));
  }
}
