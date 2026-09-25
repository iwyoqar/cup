import { ButtonHTMLAttributes, forwardRef, ReactNode } from 'react';
import { cx } from './cx';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'md' | 'sm';
  loading?: boolean;
  icon?: ReactNode;
}

// Design System 2.0 button — pure Tailwind utilities (no ui/components.css `.btn*` classes). `sizing()` resolves
// height/padding/text-size as ONE string per (variant, size) combination rather than composing overlapping utilities
// from separate strings — cx() does no conflict resolution (no tailwind-merge), so two classes for the same CSS
// property (e.g. px-4 AND px-3) would have an unpredictable winner; every axis here is therefore set in exactly one
// place. Ghost's default padding (px-3) genuinely differs from the other variants' (px-4), hence the variant check.
const BASE =
  'inline-flex cursor-pointer items-center justify-center gap-2 rounded-sm border border-transparent font-semibold whitespace-nowrap select-none transition-[background-color,border-color,color,box-shadow,transform,opacity] duration-150 ease-out active:not-disabled:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45';

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-terracotta text-black shadow-soft hover:not-disabled:brightness-[0.94]',
  secondary: 'border-line-strong bg-white text-black hover:not-disabled:border-black/30 hover:not-disabled:bg-hover',
  ghost: 'bg-transparent text-muted hover:not-disabled:bg-hover hover:not-disabled:text-black',
  danger: 'bg-terracotta-deep text-white shadow-soft hover:not-disabled:brightness-[0.92]',
};

function sizing(variant: ButtonVariant, size: 'md' | 'sm'): string {
  if (size === 'sm') return 'h-8 px-3 text-[13px]';
  return variant === 'ghost' ? 'h-10 px-3 text-sm' : 'h-10 px-4 text-sm';
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = 'secondary', size = 'md', loading, icon, className, children, disabled, type = 'button', ...rest }, ref) {
  return (
    <button {...rest} aria-busy={loading || undefined} className={cx(BASE, VARIANT[variant], sizing(variant, size), className)} disabled={disabled || loading} ref={ref} type={type}>
      {loading ? <span aria-hidden="true" className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent" /> : icon}
      {children}
    </button>
  );
});

// Square icon-only button; `label` is required so it is never an unlabeled control. Same color scheme as `ghost`
// (`.btn-icon` and `.btn-ghost` were identical in the legacy CSS beyond shape), sized as a square.
export function IconButton({ label, children, size = 'md', className, ...rest }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> & { label: string; size?: 'md' | 'sm'; children: ReactNode }) {
  return (
    <button
      {...rest}
      aria-label={label}
      className={cx(BASE, 'bg-transparent px-0 text-muted hover:not-disabled:bg-hover hover:not-disabled:text-black', size === 'sm' ? 'h-8 w-8' : 'h-10 w-10', className)}
      title={label}
      type={rest.type ?? 'button'}
    >
      {children}
    </button>
  );
}
