import { useEffect, useRef, useState, type RefObject } from 'react';

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** What Tab can reach inside `root`, in order (hidden ones left out). */
function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
}

/**
 * Keyboard focus for a modal panel: moves into it when it opens, keeps Tab and Shift+Tab inside it,
 * and goes back to whatever opened it when it closes. Without this, Tab walks off into the lobby
 * (or the game) hidden behind the backdrop. `restore: false` skips the last part, for the game menu:
 * closing it hands the keys back to the game, and a focused button there would catch Space or Enter.
 * `covered`: another dialog is over this one (this one is inert). A dialog that opened covered could not take
 * focus then, so it takes it once uncovered.
 */
export function useDialogFocus(ref: RefObject<HTMLElement | null>, restore = true, covered = false): void {
  // Read while rendering: by the time effects run, an autoFocus inside the panel has already moved focus.
  const [opener] = useState(() => document.activeElement as HTMLElement | null);
  const wasCovered = useRef(covered);

  useEffect(() => {
    const root = ref.current;
    // After the covering dialog's own clean-up has handed focus back to its opener, somewhere behind this one
    if (wasCovered.current && !covered && root && !root.contains(document.activeElement)) focusables(root)[0]?.focus();
    wasCovered.current = covered;
  }, [covered, ref]);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    if (!root.contains(document.activeElement)) focusables(root)[0]?.focus();

    const onKey = (e: KeyboardEvent) => {
      // A panel opened on top of this one (inside it in the page) has handled the key already; one
      // opened beside it makes this one inert while it's up (the game menu under Settings).
      if (e.key !== 'Tab' || e.defaultPrevented || root.closest('[inert]')) return;
      const items = focusables(root);
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const inside = root.contains(document.activeElement);
      if (e.shiftKey && (!inside || document.activeElement === first)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (!inside || document.activeElement === last)) {
        e.preventDefault();
        first.focus();
      }
    };
    root.addEventListener('keydown', onKey);
    return () => {
      root.removeEventListener('keydown', onKey);
      // The opener may be gone (the game menu swaps itself for the panel it opens).
      if (restore && opener?.isConnected && opener !== document.body) opener.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/**
 * Esc for one layer of the menus (a wizard stepping back, a dialog closing, the game menu returning to its
 * first view). The top-most layer wins: the listener is on `window` in the capture phase, so it hears Esc
 * before the game's own keys do, and it stands aside while a modal dialog other than the one around `root`
 * is open (Settings over the lobby). Handling the key marks it with preventDefault, so another layer
 * listening on `window` the same way leaves it alone. Pass `undefined` to switch it off.
 */
export function useEscape(onEscape: (() => void) | undefined, root?: RefObject<HTMLElement | null>): void {
  // The latest handler, so callers can pass an inline function without re-adding the listener every render.
  const handler = useRef(onEscape);
  useEffect(() => {
    handler.current = onEscape;
  });
  const enabled = onEscape !== undefined;

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const here = root?.current ?? null;
      const covered = [...document.querySelectorAll('[aria-modal="true"]')].some((d) => !here || !d.contains(here));
      if (covered) return;
      e.preventDefault();
      e.stopPropagation();
      handler.current?.();
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [enabled, root]);
}
