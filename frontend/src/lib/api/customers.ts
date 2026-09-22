import { apiRequest } from './client';
import { CustomerIdentity, CustomerProfile } from '../../types/api';

export function fetchMyProfile(): Promise<CustomerProfile> {
  return apiRequest<CustomerProfile>('/customers/me');
}

// Phase 11: the customer's own PUBLIC identity code (shown as QR/barcode). Stable for the customer's
// lifetime unless an admin explicitly regenerates it, so it is fetched once per app session and kept in
// memory only (never localStorage) — see IdentitySection.
let identityPromise: Promise<CustomerIdentity> | null = null;

export function fetchMyIdentity(): Promise<CustomerIdentity> {
  if (!identityPromise) {
    identityPromise = apiRequest<CustomerIdentity>('/customers/me/identity').catch((err) => {
      identityPromise = null; // a failed attempt must not be cached
      throw err;
    });
  }
  return identityPromise;
}
