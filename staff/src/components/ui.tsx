import { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from '../lib/cx';

// The Staff Panel's two shared primitives (Tailwind). Big, one-handed tap targets: 48px by default, 72px for the
// single "scan" action, 44px compact for inline actions next to text.

type ButtonVariant = 'primary' | 'secondary';
type ButtonSize = 'md' | 'xl' | 'compact';

const BUTTON_BASE =
  'font-[inherit] leading-[inherit] cursor-pointer rounded-sm font-bold tracking-[0.05em] uppercase transition-[transform,opacity] duration-120 ease-in-out active:scale-[0.98] active:opacity-92 disabled:cursor-default disabled:opacity-45';
const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: 'border-0 bg-terracotta text-black',
  secondary: 'border-[1.5px] border-black bg-transparent text-black',
};
// One string per size so height / padding / font-size are each set exactly once.
const BUTTON_SIZE: Record<ButtonSize, string> = {
  md: 'min-h-12 px-5 text-[14px]',
  xl: 'min-h-[72px] px-5 text-[16px]',
  compact: 'min-h-11 px-3.5 text-[14px]',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({ variant = 'secondary', size = 'md', className, type = 'button', ...rest }: ButtonProps) {
  return <button {...rest} className={cx(BUTTON_BASE, BUTTON_VARIANT[variant], BUTTON_SIZE[size], className)} type={type} />;
}

export type BadgeTone = 'neutral' | 'level' | 'ok' | 'new' | 'loyal' | 'active' | 'at_risk' | 'dormant' | 'churned';

const BADGE_TONE: Record<BadgeTone, string> = {
  neutral: 'bg-black/8 text-black',
  level: 'bg-black text-cream',
  ok: 'bg-[#dcebd4] text-black',
  new: 'bg-terracotta text-white',
  loyal: 'bg-terracotta text-white',
  active: 'bg-[#efe9df] text-black',
  at_risk: 'bg-[#f3c9b8] text-black',
  dormant: 'bg-[#4a4741] text-white',
  churned: 'bg-[#4a4741] text-white',
};

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={cx('inline-block rounded-full px-[11px] py-[3px] text-[13px] font-bold', BADGE_TONE[tone])}>{children}</span>;
}
