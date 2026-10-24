import { createStore } from './store';

/*
 * Local, per-client UI state shared by the R3F scene and the DOM HUD. Never synced over the network.
 */

export interface BoardPicker {
  /** 'space': choose any legal space (Speed Die triples). 'bus': preview the Bus options. */
  kind: 'space' | 'bus';
  /** Spaces that may be picked (highlighted on the board) */
  legal: number[];
  /** A preview destination (keyboard cursor / hovered Bus option): drawn as a ghost token, focused by the camera */
  ghost: number | null;
  /** Called when a legal space is clicked on the board */
  onPick?: (space: number) => void;
}

export interface UiState {
  /** Board space under the pointer */
  hover: number | null;
  /** Space whose Title Deed / inspector is open */
  selected: number | null;
  picker: BoardPicker | null;
  /** The player moved the camera by hand: automatic framing waits until Recenter */
  cameraManual: boolean;
  /** Open side panel or dialog */
  panel: null | 'manage' | 'trade' | 'log' | 'menu';
  /** WebGL state: 'lost' / 'none' switch the HUD to the 2D MiniBoard */
  gl: 'ok' | 'lost' | 'none';
  /** Set by the HUD: rects (CSS px) the board should stay clear of when the camera frames it */
  insets: { left: number; right: number; top: number; bottom: number };
}

export const uiStore = createStore<UiState>({
  hover: null,
  selected: null,
  picker: null,
  cameraManual: false,
  panel: null,
  gl: 'ok',
  insets: { left: 0, right: 0, top: 0, bottom: 0 },
});
