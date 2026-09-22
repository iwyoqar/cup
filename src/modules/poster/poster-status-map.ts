import { OrderStatus } from '../../common/enums/order-status';
import { UnmappedPosterStatusError } from './poster.errors';

// Only these two Poster status codes have been verified against the real Poster account:
// 0 before accepting, 1 after (either explicit acceptance in the Poster UI, or immediately for
// some order/service-mode configurations — both observed live, see poster.types.ts). Do not
// add entries here without independently verifying them — an unmapped code must throw, not
// guess. Keyed by string; the real API returns these as numbers, normalized via String() below.
const VERIFIED_POSTER_STATUS_MAP: Readonly<Record<string, OrderStatus>> = {
  '0': 'pending',
  '1': 'accepted',
};

export function mapPosterStatus(posterStatus: string | number): OrderStatus {
  const key = String(posterStatus);
  const mapped = VERIFIED_POSTER_STATUS_MAP[key];
  if (!mapped) {
    throw new UnmappedPosterStatusError(key);
  }
  return mapped;
}
