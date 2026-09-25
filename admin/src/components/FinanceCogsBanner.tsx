import { useState } from 'react';
import { fetchCogsStatus, triggerCogsSync } from '../lib/adminFinance';
import { FinancePnlOverview } from '../lib/types';
import { Button, StatusBadge } from '../ui';

// Shared by Overview and P&L (both compute COGS from the same product-cost data) — one banner, not
// duplicated per page.
export function FinanceCogsBanner({ data }: { data: FinancePnlOverview }) {
  const [syncing, setSyncing] = useState(false);
  const [synced, setSynced] = useState<string | null>(null);
  if (data.cogs.complete) return null;
  const handleSync = async () => {
    setSyncing(true);
    try {
      const status = await fetchCogsStatus();
      await triggerCogsSync();
      setSynced(`${status.productsWithoutRecipe} product(s) were checked against Poster.`);
    } catch {
      setSynced('Sync failed — try again shortly.');
    } finally {
      setSyncing(false);
    }
  };
  return (
    <div className="block space-y-1 rounded-md border-l-[3px] px-4 py-3 text-sm leading-relaxed [&_p]:m-0 border-muted-cream bg-neutral-bg text-muted-cream">
      <StatusBadge tone="warn">COGS data incomplete</StatusBadge> {data.cogs.missingRecipeProducts.length} product(s) sold in this period have no recipe configured in Poster yet, so their cost is not
      counted — gross profit shown here is an upper bound. Add a recipe (Poster's "Dishes") for: {data.cogs.missingRecipeProducts.slice(0, 5).map((p) => p.name).join(', ')}
      {data.cogs.missingRecipeProducts.length > 5 ? ', …' : ''}.{' '}
      <Button disabled={syncing} onClick={handleSync} size="sm" variant="secondary">
        {syncing ? 'Checking…' : 'Re-check Poster now'}
      </Button>
      {synced && <span className="text-[13px] leading-snug text-muted"> {synced}</span>}
    </div>
  );
}
