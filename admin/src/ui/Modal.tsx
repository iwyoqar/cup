import { ReactNode, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Button, IconButton } from './Button';
import { cx } from './cx';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

// Shared dialog behaviour: focus moves into the panel, Tab is trapped inside it, Escape closes (when dismissible), and
// focus returns to the element that opened it. Body scroll is locked while it is open.
function useDialogFocus(panel: React.RefObject<HTMLDivElement>, dismissible: boolean, onClose: () => void) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const dismissibleRef = useRef(dismissible);
  dismissibleRef.current = dismissible;
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const root = panel.current;
    (root?.querySelector<HTMLElement>('[data-autofocus]') ?? root)?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissibleRef.current) {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !root) return;
      const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === root)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      opener?.focus?.();
    };
    // Runs once per open dialog: the latest onClose/dismissible are read through refs.
  }, [panel]);
}

function CloseButton({ onClose, disabled }: { onClose: () => void; disabled?: boolean }) {
  return (
    <IconButton className="-mr-2 shrink-0" disabled={disabled} label="Close" onClick={onClose} size="sm">
      <svg aria-hidden="true" className="size-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth={1.8} viewBox="0 0 24 24">
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </IconButton>
  );
}

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  /** When false, Escape and a click on the backdrop do NOT close it (used while a write is in flight). */
  dismissible?: boolean;
}

// Dialog: fade + subtle scale (220 ms), centred, scrolls internally.
export function Modal({ title, onClose, children, footer, wide, dismissible = true }: ModalProps) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  useDialogFocus(panel, dismissible, onClose);
  return createPortal(
    <div className="fixed inset-0 z-50 flex animate-fade-in items-end justify-center bg-black/45 p-0 sm:items-center sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && dismissible && onClose()}>
      <div aria-labelledby={titleId} aria-modal="true" className={cx('flex max-h-[92dvh] w-full animate-dialog-in flex-col overflow-hidden rounded-t-xl bg-white shadow-pop outline-none sm:rounded-lg', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')} ref={panel} role="dialog" tabIndex={-1}>
        <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
          <h2 className="m-0 font-display text-xl leading-tight font-medium" id={titleId}>
            {title}
          </h2>
          <CloseButton disabled={!dismissible} onClose={onClose} />
        </div>
        <div className="min-h-0 overflow-y-auto px-6 py-5 text-sm">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line bg-canvas/60 px-6 py-3.5">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// Drawer: a read-only side panel (fade + slide from the right, 250 ms). Same focus rules as the dialog.
export function Drawer({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  useDialogFocus(panel, true, onClose);
  return createPortal(
    <div className="fixed inset-0 z-50 flex animate-fade-in justify-end bg-black/35" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div aria-labelledby={titleId} aria-modal="true" className="flex h-full w-full max-w-xl animate-drawer-in flex-col bg-white shadow-pop outline-none" ref={panel} role="dialog" tabIndex={-1}>
        <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
          <h2 className="m-0 font-display text-xl leading-tight font-medium" id={titleId}>
            {title}
          </h2>
          <CloseButton onClose={onClose} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 text-sm">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-6 py-3.5">{footer}</div>}
      </div>
    </div>,
    document.body,
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
          <Button data-autofocus disabled={busy} onClick={onCancel} variant="secondary">
            {cancelLabel}
          </Button>
          <Button loading={busy} onClick={onConfirm} variant={tone === 'danger' ? 'danger' : 'primary'}>
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </>
      }
      onClose={onCancel}
      title={title}
    >
      <div className="leading-relaxed text-muted-cream">{message}</div>
      {error && <p className="mt-3 text-[13px] font-semibold text-err">{error}</p>}
    </Modal>
  );
}
