import { ButtonHTMLAttributes, forwardRef, ReactNode } from 'react';
import { cx } from './cx';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'md' | 'sm';
  loading?: boolean;
  icon?: ReactNode;
}

// Design System 2.0 button. Styles live in ui/components.css (`.btn*`), shared with the legacy `.button-*` class names so
// pages that still write className="button-primary" look identical. Loading keeps the width and disables the button.
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = 'secondary', size = 'md', loading, icon, className, children, disabled, type = 'button', ...rest }, ref) {
  return (
    <button {...rest} aria-busy={loading || undefined} className={cx('btn', `btn-${variant}`, size === 'sm' && 'btn-sm', className)} disabled={disabled || loading} ref={ref} type={type}>
      {loading ? <span aria-hidden="true" className="btn-spinner" /> : icon}
      {children}
    </button>
  );
});

// Square icon-only button; `label` is required so it is never an unlabeled control.
export function IconButton({ label, children, size = 'md', className, ...rest }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> & { label: string; size?: 'md' | 'sm'; children: ReactNode }) {
  return (
    <button {...rest} aria-label={label} className={cx('btn btn-icon', size === 'sm' && 'btn-sm', className)} title={label} type={rest.type ?? 'button'}>
      {children}
    </button>
  );
}
