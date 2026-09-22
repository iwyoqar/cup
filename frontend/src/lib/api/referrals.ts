import { apiRequest } from './client';
import { ReferralOverview } from '../../types/api';

// Phase 14 — the customer's own referral view. Read-only: the Mini App can never set a referrer, a status or a reward.
export function fetchMyReferrals(): Promise<ReferralOverview> {
  return apiRequest<ReferralOverview>('/referrals');
}
