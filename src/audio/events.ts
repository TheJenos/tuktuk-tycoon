import type { GameEvent, GameState, SeatId } from '../rules';
import { ANIM, hopMs } from '../shared/timing';
import type { PlayInfo } from '../view';
import type { SoundName } from './sounds';

/*
 * Which sound each engine event makes, as the director plays it (src/view/director.ts onPlay). Sounds for my seats
 * play louder than for everyone else's. Events folded without animation (Instant) make at most a couple of sounds
 * per batch, the most telling ones; fast-forward and snaps make none (the director doesn't report them). Hero League
 * has no sounds of its own: its Hero die, superpowers, swaps and reaction windows reuse these.
 */

export interface Cue {
  name: SoundName;
  gain?: number;
  /** Seconds from now */
  delay?: number;
  /** Higher wins when an Instant batch can only play a few */
  prio?: number;
}

export interface CueCtx {
  /** Seats this browser plays */
  mine: readonly SeatId[];
  /** The token API is up (the 3D board is animating moves) */
  tokens: boolean;
  /** The dice API is up */
  dice: boolean;
  /** Who owns a space in the displayed game */
  ownerOf?: (space: number) => SeatId | undefined;
}

/** Others' events, a little quieter than mine */
const OTHERS = 0.45;
/** Cash moves that another event already sounds for */
const SILENT_CASH = new Set(['buy', 'build', 'sell', 'mortgage', 'unmortgage', 'auction', 'trade', 'bankrupt', 'debug']);
/** A property bought or dealt; on Hero League a location saved (by its lander, a back-up hero or a Strike team card) */
const SAVES = new Set(['buy', 'deal', 'backup', 'free']);

/** The cues for one event in one phase (pure) */
export function cuesFor(ev: GameEvent, phase: PlayInfo['phase'], speed: number, c: CueCtx): Cue[] {
  const isMine = (s: SeatId | 'bank' | undefined) => s !== undefined && s !== 'bank' && c.mine.includes(s);
  const who = (s: SeatId | 'bank' | undefined) => (isMine(s) ? 1 : OTHERS);
  const start = phase === 'start';
  const done = phase !== 'start'; // 'done' or 'instant'
  const instant = phase === 'instant';
  switch (ev.t) {
    case 'turn':
      return done && isMine(ev.seat) ? [{ name: 'turn', prio: 1 }] : [];
    case 'dice':
    case 'heroDie':
      if (ev.t === 'dice' && ev.purpose === 'order') return [];
      if (start) return c.dice ? [{ name: 'dice-roll', gain: who(ev.seat) }] : [];
      return [{ name: 'dice-land', gain: who(ev.seat), prio: 3 }];
    case 'move': {
      // A Titan Smash swap: one leap, a tap as it lands (src/scene/tokens/hop.ts)
      if (ev.via === 'swap') return start && c.tokens ? [{ name: 'token-hop', gain: who(ev.seat), delay: (0.95 * ANIM.jump) / Math.max(0.1, speed) / 1000 }] : [];
      if (!start || !c.tokens || ev.via === 'jail' || ev.path.length === 0) return [];
      // One soft tap per hop, timed as the scene plays the walk (src/scene/tokens/hop.ts)
      const n = ev.path.length;
      const dur = (hopMs(n) * n) / Math.max(0.1, speed) / 1000;
      const gain = (speed > 1.5 ? 0.5 : 1) * (isMine(ev.seat) ? 1 : 0.7);
      return Array.from({ length: n }, (_, i) => ({ name: 'token-hop' as const, gain, delay: ((i + 0.9) * dur) / n }));
    }
    case 'cash': {
      if (!done || ev.amount === 0 || SILENT_CASH.has(ev.why)) return [];
      if (ev.why === 'jackpot') return [{ name: 'jackpot', gain: who(ev.to), prio: 6 }];
      if (isMine(ev.to)) return [{ name: 'cash-in', prio: 4 }];
      if (isMine(ev.from)) return [{ name: 'cash-out', prio: 4 }];
      return [{ name: ev.to === 'bank' ? 'cash-out' : 'cash-in', gain: OTHERS * 0.8, prio: 2 }];
    }
    case 'card':
      if (instant) return [{ name: 'card-flip', gain: who(ev.seat), prio: 3 }];
      return start ? [{ name: 'card-draw', gain: who(ev.seat) }, { name: 'card-flip', gain: who(ev.seat), delay: 0.45 / Math.max(1, speed) }] : [];
    case 'owner':
      if (!done) return [];
      // Hero League: a location lost back to its villain
      if (ev.via === 'villain') return [{ name: 'sell', gain: who(ev.from), prio: 4 }];
      if (!ev.to) return [];
      return SAVES.has(ev.via) ? [{ name: 'buy', gain: who(ev.to), prio: 5 }] : [];
    case 'level':
      if (!done) return [];
      return [{ name: ev.to > ev.from ? 'build' : 'sell', gain: who(c.ownerOf?.(ev.space)), prio: 4 }];
    case 'mortgage':
      return done ? [{ name: 'mortgage', gain: who(c.ownerOf?.(ev.space)), prio: 4 }] : [];
    case 'auctionStart':
      return done ? [{ name: 'auction-start', prio: 3 }] : [];
    case 'bid':
      return done ? [{ name: 'auction-bid', gain: who(ev.seat), prio: 2 }] : [];
    case 'auctionEnd':
      return done && ev.winner ? [{ name: 'auction-sold', gain: who(ev.winner), prio: 5 }] : [];
    case 'jail':
      return done ? [{ name: 'jail', gain: isMine(ev.seat) ? 1 : 0.6, prio: 7 }] : [];
    case 'jailExit':
      return done ? [{ name: 'jail-free', gain: who(ev.seat), prio: 5 }] : [];
    case 'tradeDone':
      return done ? [{ name: 'confirm', prio: 3 }] : [];
    case 'bankrupt':
      return done ? [{ name: 'bankrupt', gain: isMine(ev.seat) ? 1 : 0.7, prio: 8 }] : [];
    case 'power':
      return done ? [{ name: 'jackpot', gain: who(ev.seat), prio: 6 }] : [];
    case 'powerReady':
      return done && isMine(ev.seat) ? [{ name: 'jail-free', prio: 4 }] : [];
    case 'over': {
      if (!done) return [];
      // A spectator hears the winner's jingle, softly
      if (!c.mine.length) return [{ name: 'win', gain: 0.6, prio: 9 }];
      return [isMine(ev.winner) ? { name: 'win', prio: 9 } : { name: 'lose', prio: 9 }];
    }
    default:
      return [];
  }
}

/**
 * Hero League: the bell as a reaction window opens (or opens again after a re-roll) that asks one of my seats, from
 * the displayed game before and after a batch (the window is the batch's resting phase, not an event)
 */
export function reactionCue(prev: GameState | null, next: GameState | null, mine: readonly SeatId[]): Cue | null {
  const ph = next?.phase;
  if (ph?.k !== 'react' || !ph.open.some((s) => mine.includes(s))) return null;
  if (prev?.phase.k === 'react' && prev.since === next?.since) return null;
  return { name: 'auction-start', prio: 5 };
}

/** The few cues an Instant batch keeps: the highest priority first, each sound once */
export function pickInstant(cues: readonly Cue[], keep = 2): Cue[] {
  const best = new Map<SoundName, Cue>();
  for (const q of cues) {
    const had = best.get(q.name);
    if (!had || (q.prio ?? 0) > (had.prio ?? 0)) best.set(q.name, q);
  }
  return [...best.values()].sort((a, b) => (b.prio ?? 0) - (a.prio ?? 0)).slice(0, keep).map((q) => ({ ...q, delay: undefined }));
}
