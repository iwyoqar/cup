// Stored as a plain String column (not a Prisma enum) — same portability rule as
// order-status.ts. 'pending' covers both "not yet attempted" (right after the audience is
// frozen) AND "attempted but the outcome was uncertain" (a timeout/network failure where we
// genuinely don't know if Telegram received the message) — see campaign-messaging.service.ts's
// comment on why an uncertain send is never distinguished from "not yet attempted" and never
// auto-retried, the same tradeoff this project already accepts for OrderStatusNotification.
export const CAMPAIGN_RECIPIENT_STATUSES = ['pending', 'sent', 'failed', 'skipped'] as const;

export type CampaignRecipientStatus = (typeof CAMPAIGN_RECIPIENT_STATUSES)[number];
