import { cardById } from './board';
import { applyFx } from './cards';
import { type Ctx, emit, err, isActive, player, prop, setPhase } from './ctx';
import { emitDice, throwDice } from './dice';
import { type Handler, isInt, seatAction, systemAction } from './handler';
import {
  backupSeats,
  bites,
  costOf,
  faceOf,
  grant,
  heroesOf,
  powerSource,
  seatOfFace,
  smashMoves,
  swappable,
  thunderSeats,
  usePower,
} from './heroes';
import { transfer } from './money';
import { int, d6 } from './rng';
import type {
  AimPhase,
  BoardDef,
  BoostPhase,
  CardFx,
  GameState,
  HitFx,
  Phase,
  ReactAbout,
  ReactPhase,
  RuleError,
  SeatId,
  Step,
} from './types';

/*
 * Hero League's reaction windows. A `react` phase always opens on top of `busy` and holds back one step (`then`):
 * - thunder: after every throw (the move dice, a card's Hero die, a back-up's Hero die) when some active seat could
 *   re-roll it (Thunder Call, or Steel Ace copying it), the thrower included. `reroll` throws again, forgets every
 *   earlier pass (`open` is recomputed) and re-enters the phase (a fresh timer); `pass` just leaves `open`.
 * - shield: before a Villain Strike effect aimed at a hero (the drawer's own card, a Hero-die hit) or a Titan Smash
 *   moving one, when that hero can say no (Star Shield, or Steel Ace copying it) and the effect would do something.
 *   `shield` drops `then`; a pass lets it happen.
 * drain() keeps a window open only to the seats that can still answer it (liveOpen: a seat leaving may take that away)
 * and closes it once none is left: back to busy with `then` first in the queue. Every answer carries the window's id
 * (`at` = state.since when it was entered), so a late click never answers the next window.
 */

const BUSY = { k: 'busy' } as const;

/** A Thunder window over a throw by `seat`, or `then` straight away when nobody could re-roll it */
export function openThunder(c: Ctx, seat: SeatId, about: ReactAbout, then: Step): void {
  const open = thunderSeats(c.b, c.s);
  if (open.length === 0) {
    c.s.pending.unshift(then);
    return;
  }
  setPhase(c, { k: 'react', kind: 'thunder', seat, open, about, then, resume: { ...BUSY } });
}

/** The next rigged Hero-die face (debug), used up; undefined when none is queued */
function takeRiggedFace(c: Ctx): number | undefined {
  const q = c.s.rigHero;
  const face = q?.shift();
  if (q && q.length === 0) delete c.s.rigHero;
  return face;
}

/** The next Hero-die face: a rigged one (debug) or the state's RNG */
const nextFace = (c: Ctx): number => takeRiggedFace(c) ?? d6(c.s);

/**
 * A back-up throw: one throw, uniform over the eligible seats' heroes (the same odds as throwing until someone who
 * can pay comes up). A rigged face is used only when its hero is eligible (the rigged face is used up either way).
 */
function backupFace(c: Ctx, eligible: SeatId[]): number {
  const rigged = takeRiggedFace(c);
  const faces = eligible.map((seat) => faceOf(c.b, c.s, seat));
  if (rigged !== undefined && faces.includes(rigged)) return rigged;
  return faces[int(c.s, faces.length)] ?? 1;
}

function emitHeroDie(c: Ctx, seat: SeatId, face: number, purpose: 'card' | 'backup', card?: string): void {
  const hero = heroesOf(c.b)[face - 1]?.id ?? '';
  emit(c, { t: 'heroDie', seat, face, hero, purpose, ...(card === undefined ? {} : { card }) });
}

/** The hit a Hero-die card deals (its `heroDie` effect's `hit`) */
function hitOf(c: Ctx, card: string): HitFx | undefined {
  const fx = cardById(c.b, card)?.fx;
  return fx?.k === 'heroDie' ? fx.hit : undefined;
}

/** A card's next Hero-die throw (each with its Thunder window); every throw comes before any hit */
export function throwHero(c: Ctx, st: Extract<Step, { k: 'throwHero' }>): void {
  if (!isActive(c.s, st.seat) || st.left <= 0) return;
  const face = nextFace(c);
  emitHeroDie(c, st.seat, face, 'card', st.card);
  const then: Step = { k: 'heroFace', seat: st.seat, card: st.card, face, left: st.left - 1, hits: st.hits };
  openThunder(c, st.seat, { k: 'hero', face, purpose: 'card', card: st.card }, then);
}

/**
 * A card's throw stands: the hero rolled joins the hits (a hero nobody plays, or one already hit, does nothing).
 * After the last throw the hits resolve in throw order, each fully (its shield window, the effect, a walk's whole
 * landing) before the next.
 */
export function heroFace(c: Ctx, st: Extract<Step, { k: 'heroFace' }>): void {
  const target = seatOfFace(c.b, c.s, st.face);
  const hits = target && !st.hits.includes(target) ? [...st.hits, target] : st.hits;
  if (st.left > 0) {
    c.s.pending.unshift({ k: 'throwHero', seat: st.seat, card: st.card, left: st.left, hits });
    return;
  }
  const fx = hitOf(c, st.card);
  if (!fx) return;
  c.s.pending.unshift(...hits.map((seat): Step => ({ k: 'hit', seat, fx, card: st.card, by: st.seat })));
}

/**
 * A Villain Strike effect aimed at a hero: a Star Shield window first when the hero can say no and the effect would
 * do something, then the effect. Moving or capturing a hero already in the Holding Cell does nothing at all.
 */
export function hit(c: Ctx, st: Extract<Step, { k: 'hit' }>): void {
  const p = c.s.players[st.seat];
  if (!p || p.out) return;
  if (p.jail && (st.fx.k === 'back' || st.fx.k === 'jail')) return;
  if (!st.asked && bites(c.s, st.seat, st.fx) && powerSource(c.b, c.s, st.seat, 'shield')) {
    const about: ReactAbout = { k: 'hit', fx: st.fx, card: st.card, ...(st.by ? { by: st.by } : {}) };
    const then: Step = { ...st, asked: true };
    setPhase(c, { k: 'react', kind: 'shield', seat: st.seat, open: [st.seat], about, then, resume: { ...BUSY } });
    return;
  }
  applyFx(c, st.seat, st.fx, st.card);
}

/**
 * Landing on a location nobody holds (the villain still does): the lander saves it at once when it has the cost (no
 * choice; `free`: a Strike team card, for nothing), otherwise a back-up hero may.
 */
export function saveLanded(c: Ctx, seat: SeatId, space: number, free: boolean): void {
  if (free) {
    grant(c, seat, space, 'free');
    return;
  }
  const price = costOf(c.b, space);
  if (player(c.s, seat).cash >= price) {
    transfer(c, seat, 'bank', price, 'buy', space);
    grant(c, seat, space, 'buy');
    return;
  }
  backup(c, seat, space);
}

/** A back-up hero pays and saves it */
function backupSave(c: Ctx, seat: SeatId, space: number): void {
  transfer(c, seat, 'bank', costOf(c.b, space), 'buy', space);
  grant(c, seat, space, 'backup');
}

/**
 * The lander was short: the other active seats with the cost are eligible. None: the villain keeps it (`noSave`).
 * One: it saves at once (no throw). More: one Hero-die throw among them, with its Thunder window, then backupPick.
 */
function backup(c: Ctx, lander: SeatId, space: number): void {
  if (prop(c.s, space)) return;
  const eligible = backupSeats(c.b, c.s, lander, space);
  const only = eligible.length === 1 ? eligible[0] : undefined;
  if (eligible.length === 0) emit(c, { t: 'noSave', seat: lander, space });
  else if (only) backupSave(c, only, space);
  else {
    const face = backupFace(c, eligible);
    emitHeroDie(c, lander, face, 'backup');
    openThunder(c, lander, { k: 'hero', face, purpose: 'backup', space }, { k: 'backupPick', seat: lander, space, face });
  }
}

/** The back-up throw stands: that hero saves it if it still can; otherwise pick again among those who can (or none) */
export function backupPick(c: Ctx, st: Extract<Step, { k: 'backupPick' }>): void {
  if (prop(c.s, st.space)) return;
  const target = seatOfFace(c.b, c.s, st.face);
  if (target && backupSeats(c.b, c.s, st.seat, st.space).includes(target)) backupSave(c, target, st.space);
  else backup(c, st.seat, st.space);
}

/**
 * A Titan Smash: a shield window for `a`, then for `b` (each only when it is not the smasher, can say no and would
 * move: two heroes on one space trade nothing), then the two trade places (a jump: no salary, no landing; on one
 * space both jumps are in place). If either said no, nothing moves (the step is dropped with the window). Both must
 * still be in play and outside the Holding Cell.
 */
export function swap(c: Ctx, st: Extract<Step, { k: 'swap' }>): void {
  for (let asked = st.asked; asked < 2; asked++) {
    const target = asked === 0 ? st.a : st.b;
    if (target === st.by || !smashMoves(c.s, st.a, st.b) || !powerSource(c.b, c.s, target, 'shield')) continue;
    const then: Step = { ...st, asked: asked + 1 };
    setPhase(c, { k: 'react', kind: 'shield', seat: target, open: [target], about: { k: 'smash', by: st.by }, then, resume: { ...BUSY } });
    return;
  }
  if (!swappable(c.s, st.a, st.b)) return;
  const pa = player(c.s, st.a);
  const pb = player(c.s, st.b);
  const [from, to] = [pa.pos, pb.pos];
  pa.pos = to;
  emit(c, { t: 'move', seat: st.a, from, to, path: [to], via: 'swap' });
  pb.pos = from;
  emit(c, { t: 'move', seat: st.b, from: to, to: from, path: [from], via: 'swap' });
}

/** A back-up throw that fewer than 2 heroes could win now: a re-roll cannot change who saves the location */
const pointlessBackup = (b: BoardDef, s: GameState, ph: ReactPhase): boolean =>
  ph.about.k === 'hero' && ph.about.purpose === 'backup' && backupSeats(b, s, ph.seat, ph.about.space ?? -1).length < 2;

/**
 * The seats of a reaction window that can still answer it with a superpower, in `open` order. A window opens only
 * when someone can, but a seat leaving may take that away (the hero Steel Ace copies, a back-up throw's second
 * eligible hero, the other hero of a Titan Smash): a Thunder window keeps the seats that could still re-roll (none once
 * a re-roll could not change a back-up throw), a shield window its hero while it can still say no and the effect
 * would still do something. drain() keeps exactly these open.
 */
export function liveOpen(b: BoardDef, s: GameState, ph: ReactPhase): SeatId[] {
  if (ph.kind === 'thunder') {
    if (pointlessBackup(b, s, ph)) return [];
    return ph.open.filter((seat) => powerSource(b, s, seat, 'thunder') !== undefined);
  }
  const wouldBite = (seat: SeatId): boolean => {
    const about = ph.about;
    if (about.k === 'hit') return bites(s, seat, about.fx);
    if (about.k === 'smash') return ph.then.k === 'swap' && smashMoves(s, ph.then.a, ph.then.b);
    return true;
  };
  return ph.open.filter((seat) => powerSource(b, s, seat, 'shield') !== undefined && wouldBite(seat));
}

/** Hero League's windows: the phases answered with `at` */
export const isWindow = (p: Phase): p is ReactPhase | AimPhase | BoostPhase =>
  p.k === 'react' || p.k === 'aim' || p.k === 'boost';

/** The answer belongs to the window open now (`at` = its state.since) and the seat may answer it */
export function windowProblem(s: GameState, seat: SeatId, at: unknown): RuleError | null {
  const ph = s.phase;
  if (!isWindow(ph)) return err('phase', 'There is nothing to answer');
  if (!isInt(at) || at !== s.since) return err('stale', 'That moment has passed');
  const open = ph.k === 'react' ? ph.open : [ph.seat];
  if (!open.includes(seat)) return err('notOpen', 'You have nothing to answer here');
  return null;
}

/** Lets the throw stand or the effect happen (as far as this seat goes). No setPhase: the countdown runs on. */
export function passReact(c: Ctx, seat: SeatId): void {
  const ph = c.s.phase;
  if (ph.k === 'react') ph.open = ph.open.filter((x) => x !== seat);
}

export const reroll: Handler<'reroll'> = seatAction(
  (s, b, seat, a) => {
    if (s.phase.k !== 'react' || s.phase.kind !== 'thunder') return err('phase', 'There is no throw to re-roll');
    const e = windowProblem(s, seat, a.at);
    if (e) return e;
    if (!powerSource(b, s, seat, 'thunder')) return err('power', 'Thunder Call is not ready');
    return pointlessBackup(b, s, s.phase) ? err('pointless', 'A re-roll cannot change this throw') : null;
  },
  (c, seat) => {
    const ph = c.s.phase;
    if (ph.k !== 'react') return;
    usePower(c, seat, 'thunder', ph.seat);
    const about = ph.about;
    if (about.k === 'move') {
      const r = throwDice(c, false);
      c.s.turn.roll = r;
      emitDice(c, ph.seat, 'move', r);
    } else if (about.k === 'hero' && (ph.then.k === 'heroFace' || ph.then.k === 'backupPick')) {
      const face =
        about.purpose === 'backup' ? backupFace(c, backupSeats(c.b, c.s, ph.seat, about.space ?? -1)) : nextFace(c);
      emitHeroDie(c, ph.seat, face, about.purpose, about.card);
      about.face = face;
      ph.then.face = face;
    }
    // A new throw: every seat that can re-roll it may, those that passed before included; a fresh countdown.
    ph.open = thunderSeats(c.b, c.s);
    setPhase(c, ph);
  },
);

export const shield: Handler<'shield'> = seatAction(
  (s, b, seat, a) => {
    if (s.phase.k !== 'react' || s.phase.kind !== 'shield') return err('phase', 'There is nothing to say no to');
    return windowProblem(s, seat, a.at) ?? (powerSource(b, s, seat, 'shield') ? null : err('power', 'Star Shield is not ready'));
  },
  (c, seat) => {
    const ph = c.s.phase;
    if (ph.k !== 'react') return;
    usePower(c, seat, 'shield');
    // The effect (`then`) never happens
    setPhase(c, ph.resume);
  },
);

/** A reaction window's deadline passed: everyone still open lets it be */
export const closeReact: Handler<'closeReact'> = systemAction(
  (s) => (s.phase.k === 'react' ? null : err('phase', 'There is no reaction window')),
  (c) => {
    const ph = c.s.phase;
    if (ph.k !== 'react') return;
    const seats = ph.open.filter((seat) => isActive(c.s, seat));
    if (seats.length) emit(c, { t: 'reactTimeout', seats });
    ph.open = [];
  },
);

/** Villain Strike effects aimed at their drawer, which Star Shield can say no to */
export function aimedAtDrawer(fx: CardFx): boolean {
  switch (fx.k) {
    case 'cash':
    case 'each':
      return fx.amount < 0;
    case 'back':
    case 'jail':
    case 'lose':
    case 'advance':
      return true;
    default:
      return false;
  }
}
