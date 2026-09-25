import { cx } from '../lib/cx';
import { buttonPrimary, buttonSecondary } from './buttonStyles';

interface EmptyStateProps {
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  /** "block" = cream brand panel (whole-screen emptiness); "inline" = calm one-liner inside a section. */
  variant?: 'block' | 'inline';
}

// Empty states are a brand moment, not an error: no alarm colours, no icons, one clear next step.
export function EmptyState({ title, message, actionLabel, onAction, variant = 'block' }: EmptyStateProps) {
  return (
    <div className={variant === 'block' ? 'flex flex-col items-start gap-3 rounded-lg bg-cream px-6 py-8' : 'flex flex-col items-start gap-2'}>
      <p className={variant === 'block' ? 'font-display text-title leading-[1.1] font-medium' : 'font-sans text-body leading-[1.1] font-semibold'}>{title}</p>
      {message && <p className={cx('text-small leading-[1.45]', variant === 'block' ? 'text-muted-cream' : 'text-muted')}>{message}</p>}
      {actionLabel && onAction && (
        <button className={variant === 'block' ? cx(buttonPrimary, 'mt-2 w-auto') : buttonSecondary} onClick={onAction} type="button">
          {actionLabel}
        </button>
      )}
    </div>
  );
}
