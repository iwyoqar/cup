import { ReactNode } from 'react';

export type BadgeTone = 'ok' | 'warn' | 'err' | 'neutral' | 'info';

// Status colours are deliberately restrained (muted moss / cream / deep terracotta / warm grey): a badge tells you the state, it does not shout.
export function StatusBadge({ tone = 'neutral', dot, children }: { tone?: BadgeTone; dot?: boolean; children: ReactNode }) {
  return <span className={`badge${tone !== 'neutral' ? ` badge--${tone}` : ''}${dot ? ' badge--dot' : ''}`}>{children}</span>;
}

export type HealthState = 'healthy' | 'warning' | 'error' | 'unknown';

const HEALTH_TONE: Record<HealthState, BadgeTone> = { healthy: 'ok', warning: 'warn', error: 'err', unknown: 'neutral' };
export const HEALTH_LABEL: Record<HealthState, string> = { healthy: 'Healthy', warning: 'Warning', error: 'Error', unknown: 'Unknown' };

export function HealthBadge({ state }: { state: HealthState }) {
  return (
    <StatusBadge dot tone={HEALTH_TONE[state]}>
      {HEALTH_LABEL[state]}
    </StatusBadge>
  );
}
