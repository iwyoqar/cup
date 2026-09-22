import { CartView, CartItemView } from '../../types/api';
import { addCartItem, fetchCart, removeCartItem, updateCartItemQuantity } from '../../lib/api/cart';
import { toUserMessage } from '../../lib/api/errors';

// Phase 9: optimistic cart. A tap updates the UI in the same frame; the network catches up in the
// background.
//
// Model
//  - `server`  : the last cart the BACKEND returned. Always authoritative.
//  - `intent`  : per product, the quantity the customer most recently asked for, for products whose
//                latest change the backend has not confirmed yet.
//  - displayed : server cart with the intents laid over it (see derive()).
//
// Sync
//  - All cart requests run one at a time through a single promise chain, so the backend sees them in
//    tap order and every request can be built from the freshest confirmed server cart (item ids
//    only exist once the server created the item).
//  - Intents are absolute target quantities, not "+1" deltas, and only the newest per product is kept.
//    Ten rapid "+" taps therefore cost one in-flight request plus at most one follow-up rather than
//    ten, and the end state is exactly the last thing the customer asked for.
//  - Each response replaces `server`. An intent is dropped only when the response that satisfied it
//    is confirmed AND no newer tap arrived meanwhile.
//  - On failure the affected intent is dropped (UI rolls back to the last confirmed server state), a
//    visible error is set, and the cart is re-fetched to resync — a network error can be ambiguous
//    about whether the backend applied the change.
//
// Optimistic state is presentation only. Prices/totals/reward eligibility always come from server
// responses; the locally derived total exists only for the moment before the response lands, and the
// checkout button is held back until nothing is pending (see isSyncing) so checkout can never run
// against a cart the backend hasn't caught up with.

export interface CartProductRef {
  id: string;
  name: string;
  priceMinor: number;
}

interface Intent {
  product: CartProductRef;
  quantity: number;
}

export interface CartSyncSnapshot {
  cart: CartView | null;
  isSyncing: boolean;
  error: string | null;
}

export class CartSync {
  private server: CartView | null = null;
  private readonly intents = new Map<string, Intent>();
  private chain: Promise<unknown> = Promise.resolve();
  private inFlight = 0;
  private drainQueued = false;
  private error: string | null = null;
  private readonly listeners = new Set<() => void>();
  private snapshot: CartSyncSnapshot = { cart: null, isSyncing: false, error: null };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  // Stable reference between changes (required by useSyncExternalStore).
  getSnapshot = (): CartSyncSnapshot => this.snapshot;

  /** Authoritative replace — used by boot, branch selection, reward changes, post-checkout refetch. */
  setServerCart = (cart: CartView | null): void => {
    this.server = cart;
    this.publish();
  };

  dismissError = (): void => {
    this.error = null;
    this.publish();
  };

  /**
   * Optimistically sets the quantity of one product (0 removes it). Returns immediately; the
   * request happens in the background. `quantity` is what the customer wants the cart to hold —
   * callers derive it from the displayed cart, so rapid taps compound correctly.
   */
  setQuantity = (product: CartProductRef, quantity: number): void => {
    if (!this.server) return;
    this.intents.set(product.id, { product, quantity: Math.max(0, quantity) });
    this.error = null;
    this.publish();
    // One queued drain is enough: it sends whatever the newest intents are when it actually runs.
    if (this.drainQueued) return;
    this.drainQueued = true;
    void this.enqueue(() => {
      this.drainQueued = false;
      return this.drain();
    });
  };

  /**
   * Runs a non-product cart mutation (clear, reward select/remove, …) strictly after every earlier
   * tap has reached the backend, and applies its response as the new authoritative cart.
   */
  exclusive = (request: () => Promise<CartView>): Promise<CartView> => {
    return this.enqueue(async () => {
      const cart = await request();
      this.server = cart;
      this.publish();
      return cart;
    });
  };

  /** Forgets not-yet-sent taps — used right before an operation that empties the cart. */
  discardPending = (): void => {
    this.intents.clear();
    this.publish();
  };

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    this.inFlight += 1;
    this.publish();
    const run = this.chain.then(task, task);
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run.finally(() => {
      this.inFlight -= 1;
      this.publish();
    });
  }

  // Sends the newest intent of every product until none are left. Runs inside the chain, so it is
  // never concurrent with itself or with exclusive().
  private async drain(): Promise<void> {
    while (this.intents.size > 0) {
      const [productId, intent] = this.intents.entries().next().value as [string, Intent];
      const target = intent.quantity;
      const serverItem = this.server?.items.find((item) => item.product.id === productId);

      try {
        let response: CartView | null = null;
        if (target === 0) {
          if (serverItem) response = await removeCartItem(serverItem.id);
        } else if (serverItem) {
          if (serverItem.quantity !== target) response = await updateCartItemQuantity(serverItem.id, target);
        } else {
          // No confirmed item yet: create it. POST adds to an existing row, which is right here
          // because our confirmed cart says there is none.
          response = await addCartItem(productId, target);
        }
        if (response) this.server = response;
        // Keep the intent if the customer tapped again while this request was in flight — the next
        // loop iteration sends the newer target.
        if (this.intents.get(productId)?.quantity === target) this.intents.delete(productId);
      } catch (err) {
        this.intents.delete(productId);
        this.error = toUserMessage(err);
        try {
          this.server = await fetchCart();
        } catch {
          // Keep the last confirmed cart; the error banner already tells the customer.
        }
      }
      this.publish();
    }
  }

  private publish(): void {
    this.snapshot = { cart: this.derive(), isSyncing: this.inFlight > 0, error: this.error };
    this.listeners.forEach((listener) => listener());
  }

  // Lays the unconfirmed intents over the confirmed cart. The total moves by exactly the change in
  // line totals, so whatever the backend's own total rules are stay intact.
  private derive(): CartView | null {
    const server = this.server;
    if (!server) return null;
    if (this.intents.size === 0) return server;

    let totalDelta = 0;
    const seen = new Set<string>();
    const items: CartItemView[] = [];

    for (const item of server.items) {
      const intent = this.intents.get(item.product.id);
      seen.add(item.product.id);
      if (!intent) {
        items.push(item);
        continue;
      }
      const lineTotalMinor = item.product.priceMinor * intent.quantity;
      totalDelta += lineTotalMinor - item.lineTotalMinor;
      if (intent.quantity > 0) items.push({ ...item, quantity: intent.quantity, lineTotalMinor });
    }

    for (const [productId, intent] of this.intents) {
      if (seen.has(productId) || intent.quantity === 0) continue;
      const lineTotalMinor = intent.product.priceMinor * intent.quantity;
      totalDelta += lineTotalMinor;
      items.push({
        id: `pending:${productId}`,
        product: { id: productId, name: intent.product.name, priceMinor: intent.product.priceMinor },
        quantity: intent.quantity,
        lineTotalMinor,
      });
    }

    return { ...server, items, totalMinor: server.totalMinor + totalDelta };
  }
}
