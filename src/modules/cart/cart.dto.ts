import { z } from 'zod';

// zod's default "strip unknown keys" behavior (same convention as create-order.dto.ts and
// telegram-auth.dto.ts) means a client-supplied priceMinor/customerId is silently dropped
// before it ever reaches CartService — price and identity are never accepted from the client.

export const setCartBranchSchema = z.object({
  branchId: z.string().min(1),
});

export const addCartItemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().positive(),
});

export const updateCartItemSchema = z.object({
  quantity: z.number().int().positive(),
});

// Phase 8: selecting a free reward. Client sends only WHICH program/product — never a discount
// amount, never a price, never "progress" (spec: "Client must never send... and expect the
// server to trust them"). Eligibility is independently re-verified server-side by
// RewardEligibilityService, both here (for immediate feedback) and again at checkout time.
export const selectCartRewardSchema = z.object({
  rewardProgramId: z.string().min(1),
  productId: z.string().min(1),
});

export type SetCartBranchInput = z.infer<typeof setCartBranchSchema>;
export type AddCartItemInput = z.infer<typeof addCartItemSchema>;
export type UpdateCartItemInput = z.infer<typeof updateCartItemSchema>;
export type SelectCartRewardInput = z.infer<typeof selectCartRewardSchema>;
