import { ReactNode } from 'react';
import { cx } from './cx';

export type BadgeTone = 'ok' | 'warn' | 'err' | 'neutral' | 'info';

const TONE: Record<BadgeTone, string> = {
  ok: 'bg-ok-bg text-ok',
  warn: 'bg-warn-bg text-warn',
  err: 'bg-err-bg text-err',
  neutral: 'bg-neutral-bg text-neutral',
  info: 'bg-black text-cream',
};
const DOT: Record<BadgeTone, string> = { ok: 'bg-ok', warn: 'bg-warn', err: 'bg-err', neutral: 'bg-neutral/60', info: 'bg-cream' };

// Status colours are deliberately restrained: a badge tells you the state, it does not shout.
export function StatusBadge({ tone = 'neutral', dot, children }: { tone?: BadgeTone; dot?: boolean; children: ReactNode }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap', TONE[tone])}>
      {dot && <span aria-hidden="true" className={cx('size-1.5 rounded-full', DOT[tone])} />}
      {children}
    </span>
  );
}

export type HealthState = 'healthy' | 'warning' | 'error' | 'unknown';

const HEALTH_TONE: Record<HealthState, BadgeTone> = { healthy: 'ok', warning: 'warn', error: 'err', unknown: 'neutral' };
export const HEALTH_LABEL: Record<HealthState, string> = { healthy: 'Healthy', warning: 'Warning', error: 'Error', unknown: 'Unknown' };
export const HEALTH_DOT: Record<HealthState, string> = { healthy: 'bg-[#8fc4a3]', warning: 'bg-cream', error: 'bg-terracotta', unknown: 'bg-muted' };

export function HealthBadge({ state }: { state: HealthState }) {
  return (
    <StatusBadge dot tone={HEALTH_TONE[state]}>
      {HEALTH_LABEL[state]}
    </StatusBadge>
  );
}
