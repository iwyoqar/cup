import { buttonPrimary } from './buttonStyles';
import { cx } from '../lib/cx';

interface StatusScreenProps {
  title: string;
  message?: string;
  isLoading?: boolean;
  actionLabel?: string;
  onAction?: () => void;
}

// Shared BOOTING / AUTHENTICATING / ERROR presentation (spec section 11 and 35/36) — a single
// component so every "nothing to interact with yet" state looks and behaves consistently.
// Phase 10: the loading state is the CUP wordmark with one quiet terracotta line instead of a
// spinner; errors are plain serif copy on white.
export function StatusScreen({ title, message, isLoading, actionLabel, onAction }: StatusScreenProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 pt-3 pb-8 text-center">
      {isLoading ? (
        <>
          <div className="pl-[0.32em] font-display text-[28px] tracking-[0.32em]" role="status" aria-label="Yuklanmoqda">
            CUP
          </div>
          <div className="h-0.5 w-14 overflow-hidden rounded-[2px] bg-skeleton after:block after:h-full after:w-[40%] after:animate-status-slide after:bg-terracotta after:content-['']" aria-hidden="true" />
          {message && <p className="text-small leading-[1.45] text-muted">{message}</p>}
        </>
      ) : (
        <>
          <h2 className="font-display text-title leading-[1.12] font-medium tracking-[-0.01em]">{title}</h2>
          {message && <p className="text-small leading-[1.45] text-muted">{message}</p>}
        </>
      )}
      {actionLabel && onAction && (
        <button className={cx(buttonPrimary, 'mt-2 w-full max-w-[280px]')} onClick={onAction} type="button">
          {actionLabel}
        </button>
      )}
    </div>
  );
}
