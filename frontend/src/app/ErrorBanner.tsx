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
    <div className="banner" role="alert">
      <span>{message}</span>
      <button className="banner__close" onClick={onDismiss} type="button" aria-label="Yopish">
        ×
      </button>
    </div>
  );
}
