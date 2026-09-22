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
    <div className="screen screen--centered">
      {isLoading ? (
        <>
          <div className="status-screen__mark" role="status" aria-label="Yuklanmoqda">
            CUP
          </div>
          <div className="status-screen__bar" aria-hidden="true" />
          {message && <p className="hint-text">{message}</p>}
        </>
      ) : (
        <>
          <h2 className="title">{title}</h2>
          {message && <p className="hint-text">{message}</p>}
        </>
      )}
      {actionLabel && onAction && (
        <button className="button-primary" style={{ maxWidth: 280, marginTop: 8 }} onClick={onAction} type="button">
          {actionLabel}
        </button>
      )}
    </div>
  );
}
