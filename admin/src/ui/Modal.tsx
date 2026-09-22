import { ReactNode, useEffect, useId } from 'react';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  /** When false, Escape and a click on the backdrop do NOT close it (used while a write is in flight). */
  dismissible?: boolean;
}

export function Modal({ title, onClose, children, footer, wide, dismissible = true }: ModalProps) {
  const titleId = useId();
  useEffect(() => {
    if (!dismissible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dismissible, onClose]);

  return (
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && dismissible && onClose()}>
      <div aria-labelledby={titleId} aria-modal="true" className={`modal${wide ? ' modal--wide' : ''}`} role="dialog">
        <div className="modal__head">
          <h2 className="modal__title" id={titleId}>
            {title}
          </h2>
        </div>
        <div className="modal__body">{children}</div>
        {footer && <div className="modal__foot">{footer}</div>}
      </div>
    </div>
  );
}

interface ConfirmDialogProps {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** `danger` styles the confirm button as a write / destructive action. */
  tone?: 'default' | 'danger';
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

// Confirmation is always explicit: a named action, a plain description of what will happen, and a Cancel that is as easy to press as Confirm.
export function ConfirmDialog({ title, message, confirmLabel, cancelLabel = 'Cancel', tone = 'default', busy, error, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <Modal
      dismissible={!busy}
      footer={
        <>
          <button className="button-secondary" disabled={busy} onClick={onCancel} type="button">
            {cancelLabel}
          </button>
          <button className={tone === 'danger' ? 'button-danger' : 'button-primary'} disabled={busy} onClick={onConfirm} type="button">
            {busy ? 'Working…' : confirmLabel}
          </button>
        </>
      }
      onClose={onCancel}
      title={title}
    >
      <div>{message}</div>
      {error && <p className="error-text">{error}</p>}
    </Modal>
  );
}
