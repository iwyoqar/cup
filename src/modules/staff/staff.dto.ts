import { z } from 'zod';

export const staffLoginSchema = z.object({
  identifier: z.string().min(1).max(200),
  password: z.string().min(1).max(200),
});

// Phase 16: scope + pagination query for the Staff profile / activity endpoints. .strict(): an unknown parameter is a 400. scope defaults to the staff
// member's own branch (see StaffProfileService.resolveScope); branchId may only be the staff member's own branch unless the actor is an admin / unassigned.
export const profileQuerySchema = z
  .object({
    scope: z.enum(['branch', 'all']).optional(),
    branchId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
  })
  .strict();

export const activityQuerySchema = profileQuerySchema.extend({
  cursor: z.string().min(1).max(300).optional(),
  limit: z.string().regex(/^\d{1,3}$/).optional(),
});

export const posterLinkSchema = z.object({
  choice: z.string().min(8).max(64),
});

// Admin-managed staff accounts. There is no public signup: only the admin endpoints create staff.
export const createStaffSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(40)
    .regex(/^[a-z0-9._-]+$/, 'Use letters, digits, dot, dash or underscore.'),
  displayName: z.string().trim().min(1).max(80),
  password: z.string().min(8).max(100),
  branchId: z.string().min(1).nullable().optional(),
});

export const updateStaffSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  password: z.string().min(8).max(100).optional(),
  branchId: z.string().min(1).nullable().optional(),
  isActive: z.boolean().optional(),
});
