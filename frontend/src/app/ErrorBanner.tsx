interface ErrorBannerProps {
  message: string | null;
  onDismiss: () => void;
}

// Lightweight inline banner (no toast library) shown at the top of a screen when a mutation
// fails — spec section 36: friendly Uzbek text only, never a raw backend string (callers pass
// the already-translated message from lib/api/errors.ts). Phase 10: cream surface with a
// terracotta edge — important without shouting in an alarm colour.
export function ErrorBanner({ message, onDismiss }: ErrorBannerProps) {
  if (!message) {
    return null;
  }
  return (
    <div className="flex items-center justify-between gap-2 rounded-sm border-l-[3px] border-terracotta bg-cream py-2.5 pr-1.5 pl-3.5 text-small leading-[1.4] text-black" role="alert">
      <span>{message}</span>
      <button className="h-9 w-11 shrink-0 cursor-pointer text-[20px] leading-none" onClick={onDismiss} type="button" aria-label="Yopish">
        ×
      </button>
    </div>
  );
}
