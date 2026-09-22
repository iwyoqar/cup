// Stored as a plain String column (not a Prisma enum) — same portability rule as
// order-status.ts (the sqlite connector doesn't support Prisma enums). Deliberately small: only
// the states Phase 6 actually needs. "failed" is reserved for a genuine campaign-execution
// failure (an exception during audience resolution/freeze before recipients could be
// established), never merely "some recipients failed" — see campaigns.service.ts. No
// "cancelled" state: nothing in Phase 6 can interrupt an in-progress send, so there is nothing
// to cancel.
export const CAMPAIGN_STATUSES = ['draft', 'sending', 'completed', 'failed'] as const;

export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export function isCampaignStatus(value: string): value is CampaignStatus {
  return (CAMPAIGN_STATUSES as readonly string[]).includes(value);
}
