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
    <div className={`empty empty--${variant}`}>
      <p className="empty__title">{title}</p>
      {message && <p className="hint-text">{message}</p>}
      {actionLabel && onAction && (
        <button className={variant === 'block' ? 'button-primary' : 'button-secondary'} onClick={onAction} type="button">
          {actionLabel}
        </button>
      )}
    </div>
  );
}
