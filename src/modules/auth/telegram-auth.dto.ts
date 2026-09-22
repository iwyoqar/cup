import { z } from 'zod';

// Deliberately the ONLY accepted field. customerId/telegramUserId/posterClientId are never
// accepted here — Telegram identity comes exclusively from verified initData (see
// telegram-init-data.ts), and zod's default "strip unknown keys" behavior means any extra
// field a client sends (e.g. a spoofed customerId) is silently dropped before it ever reaches
// AuthService.
export const telegramAuthSchema = z.object({
  initData: z.string().min(1),
});

export type TelegramAuthInput = z.infer<typeof telegramAuthSchema>;
