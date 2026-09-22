import { z } from 'zod';

// Telegram's own hard limit for Bot API sendMessage (4096 UTF-16 code units) — a platform
// constraint, not a business rule a founder would reasonably want to change, so this is a code
// constant rather than an Admin-configurable Setting (see campaigns.service.ts's comment on
// Admin Configurability for the same reasoning applied to the other Phase 6 constants).
export const MAX_MESSAGE_LENGTH = 4096;

// .trim().min(1) enforces "required, non-empty after trimming" in one step (spec: message
// validation must include both). Trimming outer whitespace is not the "silent truncation" the
// spec forbids — that's about cutting off legitimate content mid-message; this only removes
// incidental leading/trailing whitespace, matching every other free-text field in this project
// (segment name/description use the same .trim()).
export const createCampaignSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional(),
  segmentId: z.string().min(1, 'segmentId is required.'),
  messageText: z
    .string()
    .trim()
    .min(1, 'Message text is required.')
    .max(MAX_MESSAGE_LENGTH, `Message must be ${MAX_MESSAGE_LENGTH} characters or fewer.`),
});

export const updateCampaignSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  segmentId: z.string().min(1).optional(),
  messageText: z
    .string()
    .trim()
    .min(1, 'Message text is required.')
    .max(MAX_MESSAGE_LENGTH, `Message must be ${MAX_MESSAGE_LENGTH} characters or fewer.`)
    .optional(),
});

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;
export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>;
