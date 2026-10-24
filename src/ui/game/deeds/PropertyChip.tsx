import { useEffect, useRef, type FocusEvent, type PointerEvent } from 'react';
import { useSelector } from '../../../state/store';
import { uiStore } from '../../../state/ui';
import { safeColor } from '../../colors';
import { useNames } from '../context';
import { toggledPreview } from './preview';

/*
 * Previewing a space from a list: under the mouse or keyboard focus it is highlighted on the board, framed by the
 * camera and its deed shown beside the list (uiStore.preview). Touch has no hover: a tap toggles it instead.
 */

const show = (space: number) => uiStore.update({ preview: space });
/** Clears the preview if it is still this space (the pointer may already be over the next one) */
const hide = (space: number) => {
  if (uiStore.get().preview === space) uiStore.update({ preview: null });
};

/**
 * Hover and keyboard-focus handlers that preview `space` (spread on a list row). A tap's focus doesn't count (it
 * isn't :focus-visible): a tap toggles the preview through PropertyChip instead.
 */
export function previewHandlers(space: number) {
  return {
    onPointerEnter: (e: PointerEvent) => {
      if (e.pointerType === 'mouse') show(space);
    },
    onPointerLeave: (e: PointerEvent) => {
      if (e.pointerType === 'mouse') hide(space);
    },
    onFocus: (e: FocusEvent<HTMLElement>) => {
      if (e.target.matches(':focus-visible')) show(space);
    },
    onBlur: () => hide(space),
  };
}

/** Takes a space's preview down when the list showing it goes away */
export function useClearPreviewOnUnmount(space: number): void {
  useEffect(() => () => hide(space), [space]);
}

/**
 * A property named in a list: its colour band and name. Pointing at it or focusing it previews it on the board;
 * a click opens its full Title Deed (TileInspector), a tap shows or hides the preview. `info` draws only an ⓘ
 * button, for a row that names the property itself and previews it on hover (the trade builder's checkboxes).
 */
export function PropertyChip({ space, info = false }: { space: number; info?: boolean }) {
  const names = useNames();
  const previewing = useSelector(uiStore, (u) => u.preview === space);
  const pointer = useRef<string>('');
  useClearPreviewOnUnmount(space);
  const sp = names.board.spaces[space];
  const colour = sp?.k === 'street' ? safeColor(names.board.display.groupColours[sp.group]) : undefined;
  const name = names.space(space);
  const handlers = previewHandlers(space);
  return (
    <button
      type="button"
      className={['prop-chip', info && 'info', previewing && 'on'].filter(Boolean).join(' ')}
      aria-label={info ? `${name} details` : undefined}
      title={info ? `${name}: tap to see it on the board, click for the full deed` : `${name}: click for the full deed`}
      {...(info ? {} : handlers)}
      onPointerDown={(e) => {
        pointer.current = e.pointerType;
      }}
      onClick={(e) => {
        const how = pointer.current;
        pointer.current = '';
        // A click (or Enter) opens the full deed
        if (how !== 'touch' && how !== 'pen') return uiStore.update({ selected: space, preview: null });
        // A tap toggles the preview, keeping the chip in view as the card opens beside its list
        uiStore.update({ preview: toggledPreview(uiStore.get().preview, space) });
        const el = e.currentTarget;
        requestAnimationFrame(() => el.scrollIntoView({ block: 'nearest' }));
      }}
    >
      {info ? (
        <span aria-hidden="true">i</span>
      ) : (
        <>
          <span className="band" style={colour ? { background: colour } : undefined} aria-hidden="true" />
          {name}
        </>
      )}
    </button>
  );
}
