import { cx } from './cx';

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
  className?: string;
}

// A single switch — extracted from 6 near-identical local copies during the Tailwind migration (Referrals,
// Automations, Loyalty2, Loyalty settings, Promotion form, Reward program form all had their own `function Toggle`).
// The knob is a `::before` pseudo-element on the track, driven by the input's checked/focus state via Tailwind's
// `peer` variant (the input is visually hidden but still the real, tabbable, screen-reader-visible control).
export function Toggle({ checked, onChange, disabled, label, className }: ToggleProps) {
  return (
    <label className={cx('relative inline-block h-6 w-11 shrink-0', disabled && 'cursor-not-allowed opacity-45', className)}>
      <input
        aria-label={label}
        checked={checked}
        className="peer absolute size-0 opacity-0"
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        type="checkbox"
      />
      <span
        className={cx(
          'absolute inset-0 rounded-full bg-line-strong transition-colors duration-200 ease-out',
          !disabled && 'cursor-pointer',
          "before:absolute before:top-0.5 before:left-0.5 before:size-5 before:rounded-full before:bg-white before:shadow-soft before:transition-transform before:duration-200 before:ease-out before:content-['']",
          'peer-checked:bg-terracotta peer-checked:before:translate-x-5',
          'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-terracotta',
        )}
      />
    </label>
  );
}
