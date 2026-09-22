import { z } from 'zod';

// Deliberately the only two accepted fields — zod's default "strip unknown keys" behavior
// means an extra field (e.g. a spoofed role) is silently dropped before it ever reaches
// AdminAuthService.
export const adminLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export type AdminLoginInput = z.infer<typeof adminLoginSchema>;
