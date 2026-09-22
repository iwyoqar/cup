import { RewardProgramType } from './reward-program-allowlist';

// Structural shape of a RewardProgram row with its qualifying category joined — same pattern as
// PromotionRecord in the promotions module.
export interface RewardProgramRecord {
  id: string;
  name: string;
  type: string;
  qualifyingCategoryId: string;
  qualifyingCategory: { id: string; name: string; isActive: boolean };
  buyQuantity: number;
  rewardQuantity: number;
  isActive: boolean;
  startsAt: Date;
  endsAt: Date | null;
}

// The dynamically-derived state of one customer's progress toward a specific program — never
// stored, always computed fresh from qualifying purchase history (CUP order items + imported
// Poster POS items, Phase 11.3) + existing redemptions (spec: "prefer deriving progress from
// qualifying paid order items").
export interface RewardProgress {
  qualifyingCount: number; // count within the CURRENT (unredeemed) cycle, i.e. modulo buyQuantity
  availableRewards: number; // floor(totalQualifying / buyQuantity) - redeemedCount, never negative
}

export type RewardEligibilityReason =
  | 'INACTIVE'
  | 'NOT_STARTED'
  | 'EXPIRED'
  | 'NO_REWARD_AVAILABLE'
  | 'PRODUCT_NOT_QUALIFYING'
  | 'PRODUCT_INACTIVE';

export interface RewardEligibilityResult {
  eligible: boolean;
  reason: RewardEligibilityReason | null;
}

// Response shapes — never the raw Prisma model.

export interface RewardProgramListItem {
  id: string;
  name: string;
  description: string | null;
  type: RewardProgramType;
  qualifyingCategory: { id: string; name: string };
  buyQuantity: number;
  rewardQuantity: number;
  isActive: boolean;
  startsAt: string;
  endsAt: string | null;
  updatedAt: string;
}

export interface RewardProgramListPage {
  items: RewardProgramListItem[];
  nextCursor: string | null;
}

export interface RewardProgramView {
  id: string;
  name: string;
  description: string | null;
  type: RewardProgramType;
  qualifyingCategory: { id: string; name: string };
  buyQuantity: number;
  rewardQuantity: number;
  isActive: boolean;
  startsAt: string;
  endsAt: string | null;
  redemptionCount: number;
  createdAt: string;
  updatedAt: string;
}

// GET /loyalty/rewards — customer-facing, deliberately minimal (spec's example response shape).
// programId and qualifyingCategoryId are the two ids exposed beyond the spec's literal example
// — both are FUNCTIONALLY required, not merely convenient: programId is what the Mini App must
// send back to POST /cart/reward to actually select this reward (there is no way to act on this
// response without it), and qualifyingCategoryId lets it filter the EXISTING GET
// /catalog/products response client-side to build the "choose your free coffee" picker, per the
// spec's explicit "do not duplicate the catalog manually, use the existing catalog API"
// instruction. Neither is a sensitive value — on par with the product/category/segment/
// promotion ids this project's other customer-facing responses already expose whenever the
// client needs them for a subsequent call.
export interface CustomerRewardProgramView {
  programId: string;
  program: { name: string };
  threshold: number;
  qualifyingCount: number;
  availableRewards: number;
  isActive: boolean;
  // Phase 8.1: false while the REWARD_CHECKOUT_ENABLED production gate is off — progress and
  // available credits are still shown truthfully, but the Mini App must not offer to redeem.
  redeemable: boolean;
  qualifyingCategoryId: string;
}
