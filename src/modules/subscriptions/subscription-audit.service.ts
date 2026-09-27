import { Injectable, Logger } from '@nestjs/common';
import { StaffRepository } from '../staff/staff.repository';

// Coffee Subscription audit — reuses the existing staff_scan_events trail (the same table the POS widget and Staff Panel already write;
// shown on Admin → Audit). No new audit table. Stored: actor, action, a machine-readable result, the customer and branch ids — never a
// phone, a CUP code, a Poster payload or any payment detail.
export const SUBSCRIPTION_AUDIT = {
  CREATED: 'SUBSCRIPTION_CREATED',
  ACTIVATED: 'SUBSCRIPTION_ACTIVATED',
  EXPIRED: 'SUBSCRIPTION_EXPIRED',
  CANCELLED: 'SUBSCRIPTION_CANCELLED',
  RENEW_REQUESTED: 'SUBSCRIPTION_RENEW_REQUESTED',
  PURCHASE_CANCELLED: 'SUBSCRIPTION_PURCHASE_CANCELLED',
  PLAN_CHANGED: 'SUBSCRIPTION_PLAN_CHANGED',
  PRODUCTS_CHANGED: 'SUBSCRIPTION_PRODUCTS_CHANGED',
  REDEMPTION_REQUESTED: 'SUBSCRIPTION_REDEMPTION_REQUESTED',
  REDEMPTION_CONFIRMED: 'SUBSCRIPTION_REDEMPTION_CONFIRMED',
  REDEMPTION_FAILED: 'SUBSCRIPTION_REDEMPTION_FAILED',
  REDEMPTION_UNKNOWN: 'SUBSCRIPTION_REDEMPTION_UNKNOWN',
  REDEMPTION_RESOLVED: 'SUBSCRIPTION_REDEMPTION_RESOLVED',
} as const;

export type SubscriptionAuditAction = (typeof SUBSCRIPTION_AUDIT)[keyof typeof SUBSCRIPTION_AUDIT];
export type SubscriptionActor = { type: 'ADMIN' | 'CUSTOMER' | 'POS_WIDGET' | 'SYSTEM'; id: string };

@Injectable()
export class SubscriptionAuditService {
  private readonly logger = new Logger(SubscriptionAuditService.name);

  constructor(private readonly staff: StaffRepository) {}

  // An audit failure never breaks the action it describes.
  async record(actor: SubscriptionActor, action: SubscriptionAuditAction, result: string, customerId: string | null, branchId: string | null = null): Promise<void> {
    try {
      await this.staff.recordEvent({ actorType: actor.type, actorId: actor.id, action, result: result.slice(0, 120), customerId, branchId });
    } catch (err) {
      this.logger.error(`Subscription audit failed (${action}): ${err instanceof Error ? err.message.split('\n')[0] : 'error'}`);
    }
  }
}
