import { useState, useSyncExternalStore } from 'react';
import { CartSync, CartSyncSnapshot } from './cartSync';

// One CartSync for the lifetime of the app shell — it must outlive the individual views so a cart
// change still in flight when the customer navigates catalog -> cart is not lost or duplicated.
export function useCartSync(): { sync: CartSync; state: CartSyncSnapshot } {
  const [sync] = useState(() => new CartSync());
  const state = useSyncExternalStore(sync.subscribe, sync.getSnapshot);
  return { sync, state };
}
