// Phase 6: Telegram is the ONLY channel. A plain String column (not a Prisma enum, same
// portability rule as elsewhere) with a one-member union — this exists so the schema/API shape
// doesn't need to change when a future phase adds a second channel, not because Phase 6 itself
// offers a real choice. The Admin UI fixes this to "telegram" rather than exposing a
// meaningless single-option selector.
export const CAMPAIGN_CHANNELS = ['telegram'] as const;

export type CampaignChannel = (typeof CAMPAIGN_CHANNELS)[number];
