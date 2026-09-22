import { apiRequest } from './api';

// GET /catalog/products is unauthenticated (no guard) — same convention CartService's own
// browsing relies on. Reused here rather than adding a second admin-only product-list endpoint,
// per Phase 7's "do not create a new selector implementation if an existing one can be reused."
export interface CatalogProduct {
  id: string;
  name: string;
  priceMinor: number;
  isActive: boolean;
}

export function fetchActiveProducts(): Promise<CatalogProduct[]> {
  return apiRequest<CatalogProduct[]>('/catalog/products');
}

// Phase 8: reused by the reward-program form's qualifying-category selector — same
// "GET /catalog/categories is unauthenticated, reuse it" pattern as fetchActiveProducts.
export interface CatalogCategory {
  id: string;
  name: string;
  isActive: boolean;
}

export function fetchActiveCategories(): Promise<CatalogCategory[]> {
  return apiRequest<CatalogCategory[]>('/catalog/categories');
}
