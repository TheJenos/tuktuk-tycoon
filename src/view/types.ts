import type { GameEvent, GameState, SeatId } from '../rules';
import type { Batch } from '../net/types';
import type { Store } from '../state/store';

/*
 * Contract between the director (src/view, plays events as animations) and its readers (R3F scene, DOM HUD).
 * The session's doc.game is the LOGICAL state (what is legal now). viewStore.game is the DISPLAYED state: it lags
 * behind while events animate, is patched event by event, and is snapped to the batch's state at the end of each
 * batch, so it can never drift.
 */

export interface LogEntry {
  seq: number;
  ev: GameEvent;
}

export interface ViewState {
  /** seq of the last fully played batch (-1 before the first) */
  seq: number;
  /** Displayed state; null before the first batch */
  game: GameState | null;
  /** Events played so far, newest last (at most 200) */
  log: LogEntry[];
  /**
   * The card being shown right now, if any. Set when a `card` event starts playing (before the 3D card flies) and
   * kept until the next card, the next `turn` event or a snap, so a DOM card can stay up after the 3D one is gone.
   */
  card: { seat: SeatId; deck: 'chance' | 'chest'; text: string } | null;
  /** The last throw shown, for the dice readout (set once the dice have landed) */
  dice: Extract<GameEvent, { t: 'dice' }> | null;
}

export interface Director {
  /** True when nothing is queued or playing. Decision prompts wait for it. */
  readonly idle: Store<boolean>;
  readonly view: Store<ViewState>;
  /** Feed batches in seq order (a gap or a snap batch jumps straight to its state) */
  enqueue(b: Batch): void;
  /** Finish everything queued at once (tab hidden, 'instant' animations, tests) */
  fastForward(): void;
  /** Drop everything and show this state */
  snap(state: GameState, seq: number): void;
  /** Scene parts register imperative animation APIs; a handler whose API is missing resolves at once */
  register<K extends keyof SceneApis>(name: K, api: SceneApis[K]): () => void;
}

/** Board events that change a piece on the board (owner chip, house/hotel, mortgage stamp) */
export type BoardEvent = Extract<GameEvent, { t: 'owner' | 'level' | 'mortgage' }>;

/**
 * Imperative APIs the R3F scene registers with the director. Every method resolves when its animation is done
 * (immediately when aborted). `speed` multiplies playback (1 = normal; the director raises it for 'fast' and a
 * backlog).
 */
export interface SceneApis {
  /** 'walk' hops forward tile by tile, 'back' walks backwards, 'jump' is one arc (to jail only) */
  tokens: { move(seat: SeatId, path: number[], mode: 'walk' | 'back' | 'jump', signal: AbortSignal, speed: number): Promise<void> };
  /** Lands on the event's values. `seed` (the same on every client) picks the throw. */
  dice: { roll(ev: Extract<GameEvent, { t: 'dice' }>, signal: AbortSignal, speed: number, seed?: number): Promise<void> };
  /**
   * focus(null) frames the whole board, focus(space) a tile; follow(path) frames a move's path. Automatic framing
   * is skipped while the player has moved the camera by hand.
   */
  camera: {
    focus(space: number | null, signal: AbortSignal): Promise<void>;
    follow?(path: number[], signal: AbortSignal): Promise<void>;
  };
  cards: { show(ev: Extract<GameEvent, { t: 'card' }>, signal: AbortSignal, speed: number): Promise<void> };
  fx: { money(seat: SeatId, delta: number): void };
  /** Plays a board change after it shows in view.game: an owner chip pops, a house drops in, a stamp lands */
  board: { animate(ev: BoardEvent, signal: AbortSignal, speed: number): Promise<void> };
}
