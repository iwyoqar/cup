import { deriveHealth, overallState, usePulse } from '../lib/health';
import { formatAgo } from '../lib/format';
import { findNav } from '../lib/nav';
import { Button, EmptyState, HEALTH_LABEL, HealthBadge, KeyValue, LoadingState, PageHeader, SectionCard, StatusBadge, cx } from '../ui';
import { HealthList } from '../ui/HealthList';

const yesNo = (v: boolean) => (v ? <StatusBadge tone="ok">Yes</StatusBadge> : <StatusBadge tone="warn">No</StatusBadge>);

// Is every part of CUP up and configured? Built only from the public /health and the admin sync status: what the API cannot report stays "Unknown" with the reason
// beside it. Healthy is quiet; a warning or error row is tinted so it is the first thing the eye lands on.
export function SystemHealthPage() {
  const pulse = usePulse();
  const items = deriveHealth(pulse);
  const overall = overallState(items);
  const { item } = findNav('system-health');
  const cfg = pulse.sync?.config;

  return (
    <>
      <PageHeader
        actions={
          <>
            {!pulse.loading && <HealthBadge state={overall} />}
            <Button disabled={pulse.loading} onClick={pulse.reload} variant="secondary">
              Check again
            </Button>
          </>
        }
        description={item.description}
        title={item.label}
      />

      {pulse.loading ? (
        <LoadingState variant="page" />
      ) : (
        <>
          <div className={cx('block space-y-1 rounded-md border-l-[3px] px-4 py-3 text-sm leading-relaxed [&_p]:m-0', overall === 'healthy' ? 'border-ok bg-ok-bg text-ok' : overall === 'unknown' ? 'border-muted-cream bg-neutral-bg text-muted-cream' : overall === 'warning' ? 'border-terracotta bg-cream-soft text-warn' : 'border-err bg-err-bg text-err')}>
            <strong>{overall === 'healthy' ? 'All monitored systems are healthy.' : overall === 'unknown' ? 'CUP could not confirm its status.' : overall === 'warning' ? 'Something needs a look.' : 'Something is broken.'}</strong>
            {pulse.checkedAt && <span className="text-[13px] leading-snug text-muted"> Checked {formatAgo(pulse.checkedAt.toISOString())}.</span>}
          </div>

          <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <SectionCard description={`${HEALTH_LABEL.healthy}, ${HEALTH_LABEL.warning}, ${HEALTH_LABEL.error} or ${HEALTH_LABEL.unknown} — with the reason.`} title="Components">
              <HealthList items={items} />
            </SectionCard>

            <SectionCard description="Read from the running backend." title="Configuration">
              {cfg ? (
                <KeyValue
                  rows={[
                    { key: 'sync', label: 'Automatic import (POSTER_SYNC_ENABLED)', value: cfg.syncEnabled ? <StatusBadge tone="ok">ON</StatusBadge> : <StatusBadge tone="warn">OFF</StatusBadge> },
                    { key: 'secret', label: 'Poster application secret', value: yesNo(cfg.applicationSecretConfigured) },
                    { key: 'pin', label: 'Poster account pinned', value: yesNo(cfg.accountPinned) },
                    { key: 'path', label: 'Webhook path', value: <code>{cfg.webhookPath}</code> },
                    { key: 'tick', label: 'Queue processor tick', value: `${cfg.tickSeconds} s` },
                    { key: 'rec', label: 'Recovery check', value: `every ${cfg.reconcileMinutes} min` },
                    { key: 'settle', label: 'Settling delay', value: `${Math.round(cfg.settleSeconds / 60)} min` },
                    { key: 'att', label: 'Retry attempts per event', value: String(cfg.maxAttempts) },
                  ]}
                />
              ) : (
                <EmptyState text={pulse.syncError ?? 'The configuration could not be read.'} title="Configuration unavailable" variant="inline" />
              )}
            </SectionCard>
          </div>
        </>
      )}
    </>
  );
}
