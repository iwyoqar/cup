import { fetchCategories, fetchProducts } from '../api/catalog';
import { Category, Product } from '../../types/api';

// Phase 9: stale-while-revalidate cache for the PUBLIC menu (categories + products) only.
//
// UX-only by design. It exists so the menu paints instantly (from memory on re-entering the
// catalog view, from localStorage on the next app launch) while a background request refreshes
// it. It is never an input to anything that matters for money:
//  - The cart is server-authoritative: every cart response carries its own server-side product
//    name/price/line totals, and checkout re-prices from the database. A stale price shown on a
//    catalog card can therefore never change what is charged.
//  - Nothing customer-specific (cart, profile, rewards, orders, token) is ever stored here — the
//    catalog endpoints are public, so this contains only what any anonymous visitor could fetch.

export interface CatalogSnapshot {
  categories: Category[];
  products: Product[];
  fetchedAt: number;
}

// Within this window a re-entry into the catalog view issues no request at all; past it the cached
// menu is still shown immediately and refreshed in the background. The backend itself only re-syncs
// Poster's catalog every CATALOG_SYNC_INTERVAL_MS (5 min), so 60 s never hides a real change for long.
const FRESH_FOR_MS = 60_000;
const STORAGE_KEY = 'cup.catalog.v1';

let snapshot: CatalogSnapshot | null = readFromStorage();
let inFlight: Promise<CatalogSnapshot> | null = null;
const listeners = new Set<() => void>();

function readFromStorage(): CatalogSnapshot | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CatalogSnapshot>;
    if (!Array.isArray(parsed.categories) || !Array.isArray(parsed.products) || typeof parsed.fetchedAt !== 'number') {
      return null;
    }
    return { categories: parsed.categories, products: parsed.products, fetchedAt: parsed.fetchedAt };
  } catch {
    // Storage unavailable/blocked or corrupted — behave exactly as if there were no cache.
    return null;
  }
}

function writeToStorage(value: CatalogSnapshot): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Quota/blocked storage only costs the next launch its warm start.
  }
}

export function getCatalogSnapshot(): CatalogSnapshot | null {
  return snapshot;
}

export function subscribeToCatalog(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// De-duplicated: the boot-time prefetch and the view's own mount effect share one request pair.
export function refreshCatalog(): Promise<CatalogSnapshot> {
  if (inFlight) return inFlight;
  inFlight = Promise.all([fetchCategories(), fetchProducts()])
    .then(([categories, products]) => {
      // Same filtering CatalogView always applied — done once here so every consumer agrees.
      const next: CatalogSnapshot = {
        categories: categories.filter((c) => c.isActive),
        products: products.filter((p) => p.isActive),
        fetchedAt: Date.now(),
      };
      snapshot = next;
      writeToStorage(next);
      listeners.forEach((listener) => listener());
      return next;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

// Refreshes only when there is nothing cached or the cached copy is older than FRESH_FOR_MS.
export function refreshCatalogIfStale(): Promise<CatalogSnapshot> | null {
  if (snapshot && Date.now() - snapshot.fetchedAt < FRESH_FOR_MS) return null;
  return refreshCatalog();
}
