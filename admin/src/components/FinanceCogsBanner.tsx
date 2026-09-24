import { useState } from 'react';
import { fetchCogsStatus, triggerCogsSync } from '../lib/adminFinance';
import { FinancePnlOverview } from '../lib/types';
import { StatusBadge } from '../ui';

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
    <div className="callout">
      <StatusBadge tone="warn">COGS data incomplete</StatusBadge> {data.cogs.missingRecipeProducts.length} product(s) sold in this period have no recipe configured in Poster yet, so their cost is not
      counted — gross profit shown here is an upper bound. Add a recipe (Poster's "Dishes") for: {data.cogs.missingRecipeProducts.slice(0, 5).map((p) => p.name).join(', ')}
      {data.cogs.missingRecipeProducts.length > 5 ? ', …' : ''}.{' '}
      <button className="button-secondary button--sm" disabled={syncing} onClick={handleSync} type="button">
        {syncing ? 'Checking…' : 'Re-check Poster now'}
      </button>
      {synced && <span className="hint-text"> {synced}</span>}
    </div>
  );
}
