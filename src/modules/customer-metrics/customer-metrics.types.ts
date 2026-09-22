// Shared between Customer 360 (admin-customers) and segment evaluation (segments) — the ONE
// canonical shape for order-derived customer metrics. Never redefined independently elsewhere.
export interface CustomerOrderMetrics {
  orderCount: number;
  totalSpentMinor: number;
  averageOrderMinor: number;
  firstOrderAt: Date | null;
  lastOrderAt: Date | null;
}

export interface CustomerFavoriteBranch {
  id: string;
  name: string;
}
