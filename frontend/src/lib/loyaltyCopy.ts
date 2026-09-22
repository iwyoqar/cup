import { LoyaltyAccount } from '../types/api';

// Phase 3.1 Part 4 — the ONE place this sentence is ever built. The business rule (how many
// so'm per point) lives in the database via SettingsService; this function only formats
// whatever GET /loyalty just returned. Never hardcode "1000 so'm = 1 ball" anywhere else — if
// an admin changes earnUnitAmount/earnRate, the next fetch of this same account view produces
// different text automatically, with no frontend code change.
export function getLoyaltyEarningCopy(loyalty: LoyaltyAccount): string | null {
  if (loyalty.earnRate <= 0 || loyalty.earnUnitAmount <= 0) {
    // Earning is effectively off (rate or unit is zero) even if loyalty itself is enabled
    // (e.g. only welcome bonus / spending configured) — no earning claim to make in that case.
    return null;
  }
  const unit = loyalty.earnUnitAmount.toLocaleString('ru-RU');
  const points = loyalty.earnRate;
  return `Har ${unit} so'm xarid uchun ${points} ball`;
}
