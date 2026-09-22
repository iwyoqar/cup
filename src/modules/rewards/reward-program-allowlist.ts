// Phase 8: the explicit allowlist a RewardProgram's type must satisfy — same "never arbitrary
// input, always an explicit allowlist" philosophy as segment-condition-allowlist.ts /
// promotion-benefit-allowlist.ts. Only BUY_X_GET_Y exists today (spec: "do not over-engineer
// the full reward engine — the immediate required mechanic is BUY 5 qualifying coffee units GET
// 1 qualifying coffee free"). The allowlist shape itself is what makes adding a future type
// (e.g. a category-based or branch-specific reward) additive rather than a rewrite.
export const REWARD_PROGRAM_TYPES = ['BUY_X_GET_Y'] as const;
export type RewardProgramType = (typeof REWARD_PROGRAM_TYPES)[number];

export function isRewardProgramType(value: string): value is RewardProgramType {
  return (REWARD_PROGRAM_TYPES as readonly string[]).includes(value);
}
