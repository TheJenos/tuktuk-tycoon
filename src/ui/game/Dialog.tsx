import { useId, useRef, type ReactNode } from 'react';
import { useDialogFocus, useEscape } from '../useDialogFocus';

interface Props {
  title: ReactNode;
  /** Esc, the × button and a click on the dimmed board close it; leave out for dialogs that must be answered */
  onClose?: () => void;
  children: ReactNode;
  /** Extra class for the box (its width and look) */
  className?: string;
  id?: string;
  /** Under the title */
  aside?: ReactNode;
  footer?: ReactNode;
  /** Another dialog is open over this one: it takes the keyboard */
  covered?: boolean;
  /** Keep focus where it was when closing (the game takes the keys back) */
  restoreFocus?: boolean;
}

/**
 * The game screen's modal: a glass box over the dimmed board (a bottom sheet on phones), role=dialog with
 * aria-modal, focus moved in, trapped and given back, and one layer of Esc.
 */
export function Dialog({ title, onClose, children, className, id, aside, footer, covered = false, restoreFocus = true }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useDialogFocus(box, restoreFocus, covered);
  useEscape(covered ? undefined : onClose, box);
  return (
    <div className="game-modal" onClick={(e) => e.target === e.currentTarget && onClose?.()} inert={covered}>
      <div
        ref={box}
        id={id}
        className={['panel', 'game-dialog', className].filter(Boolean).join(' ')}
        role="dialog"
        aria-modal={covered ? undefined : true}
        aria-labelledby={titleId}
      >
        <header className="dialog-head">
          <h2 id={titleId}>{title}</h2>
          {aside}
          {onClose && (
            <button type="button" className="icon-button dialog-close" aria-label="Close" title="Close (Esc)" onClick={onClose}>
              ×
            </button>
          )}
        </header>
        <div className="dialog-body">{children}</div>
        {footer && <footer className="dialog-foot">{footer}</footer>}
      </div>
    </div>
  );
}
