import { useCallback, useEffect, useState } from 'react';
import { SpotMappingCard } from '../components/SpotMappingCard';
import { fetchSpotMapping, SpotMappingReport } from '../lib/adminPosterImport';
import { errorMessage } from '../lib/errors';
import { formatDateTime } from '../lib/format';
import { findNav } from '../lib/nav';
import { PageHeader, StatCard, StatGrid, StatusBadge } from '../ui';

// Branches and how they connect to Poster. CUP runs one business today, but the branch model stays: this page shows each Poster spot, the CUP branch it maps
// to, and whether the configuration is ready to import receipts. It reads only; the mapping is created by the Poster spot sync.
export function BranchConfigPage() {
  const [mapping, setMapping] = useState<SpotMappingReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { item } = findNav('branch-config');

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchSpotMapping()
      .then(setMapping)
      .catch((err) => setError(errorMessage(err, 'Could not read the Poster spots.')))
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  const c = mapping?.counts;
  return (
    <>
      <PageHeader
        actions={mapping && <StatusBadge dot tone={mapping.importReady ? 'ok' : 'warn'}>{mapping.importReady ? 'Configuration ready' : 'Configuration needs attention'}</StatusBadge>}
        description={item.description}
        title={item.label}
      />
      {c && (
        <StatGrid>
          <StatCard hint="reported by Poster" label="Poster spots" value={String(c.posterSpots)} />
          <StatCard label="Mapped" strong value={String(c.mapped)} />
          <StatCard hint="Poster spots with no CUP branch" label="Unmapped spots" value={String(c.unmappedPosterSpots)} />
          <StatCard hint={`${c.duplicateMappings} duplicate · ${c.inactiveBranches} inactive`} label="CUP branches without a spot" value={String(c.unmappedBranches)} />
        </StatGrid>
      )}
      <SpotMappingCard
        description={mapping ? `Checked ${formatDateTime(mapping.checkedAt)}` : undefined}
        error={error}
        loading={loading}
        mapping={mapping}
        onReload={load}
        title="Poster spots"
      />
    </>
  );
}
