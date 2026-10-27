import { createRoot } from 'react-dom/client';
import '../style.css';
import { apply, awaiting, createGame, defaultAction, heroesOf, HEROES, legalActions, type Action, type GameState, type SeatId } from '../rules';
import type { Batch, GameSession, SeatInfo, SessionView } from '../net/types';
import { shownDice } from '../scene/dice/shown';
import { Stage } from '../scene/Stage';
import { SEAT_COLORS, TOKENS, DEFAULT_TOKEN, type TokenId } from '../shared/tokens';
import { sessionStore } from '../state/session';
import { createStore } from '../state/store';
import { uiStore } from '../state/ui';
import { settings, type AnimSpeed, type Quality } from '../ui/settings';
import { director } from '../view';

/*
 * DEV TOOL (not part of the app or its build): the 3D scene on its own, with no HUD, driven by an engine game set up
 * mid-way (complete colour groups with houses and hotels, mortgages, a player in jail) through a tiny fake GameSession.
 *   npx vite, then open /src/dev/scene.html?quality=high&anim=normal[&physics=0][&reduced=1][&backdrop=1][&board=heroes]
 *   window.harness.step() plays one command for whoever the game waits on; auto(true) keeps playing.
 *   board=heroes: Hero League with all six heroes, locations saved, one in the Holding Cell; the first roll lands
 *   on Villain Strike with a card that throws the Hero die twice. harness.heroDie(face) throws the Hero die alone,
 *   harness.smash() plays the turn seat's Titan Smash.
 *   node src/dev/shots.mjs <outDir> [query] runs it headless: screenshots plus checks (idle frames, picking, dice
 *   values, the Hero die's faces, context loss).
 */

const q = new URLSearchParams(location.search);
settings.update({
  quality: (q.get('quality') as Quality) ?? 'high',
  animSpeed: (q.get('anim') as AnimSpeed) ?? 'normal',
  dicePhysics: q.get('physics') !== '0',
  reduceMotion: q.get('reduced') === '1',
});

const heroes = q.get('board') === 'heroes';
const SEATS: SeatId[] = heroes ? ['s0', 's1', 's2', 's3', 's4', 's5'] : ['s0', 's1', 's2', 's3'];
/** Hero League: all six heroes (s0 Jade Titan, then a Storm Lord to re-roll and a Star Captain to shield) */
const HERO_PICK = ['jadeTitan', 'stormLord', 'starCaptain', 'steelAce', 'velvetViper', 'sharpshot'];
const setups = SEATS.map((id, i) => ({ id, name: `P${i}`, ...(heroes ? { hero: HERO_PICK[i] } : {}) }));
let { state } = createGame(heroes ? { board: 'heroes', debug: true } : { speedDie: true, debug: true }, setups, 11);
state.order = [...SEATS];
state.turn = { seat: 's0', no: 1, doubles: 0, again: false };
const own = (seat: SeatId, spaces: number[], level: 0 | 1 | 2 | 3 | 4 | 5 = 0, mortgaged = false) => {
  for (const sp of spaces) {
    state.props[`p${sp}`] = { owner: seat, level, ...(mortgaged ? { mortgaged: true as const } : {}) };
    if (level === 5) state.bank.hotels--;
    else state.bank.houses -= level;
  }
};
if (heroes) {
  // Locations saved round the board, heroes spread out, one in the Holding Cell, one superpower used
  own('s0', [1, 2]);
  own('s1', [9, 10, 13]);
  own('s2', [16]);
  own('s3', [22, 24]);
  own('s5', [27]);
  const pos: Record<SeatId, number> = { s0: 0, s1: 7, s2: 14, s3: 19, s4: 25, s5: 7 } as Record<SeatId, number>;
  for (const s of SEATS) if (state.players[s]) state.players[s].pos = pos[s];
  state.players.s5!.jail = { tries: 0 };
  state.players.s4!.powerUsed = 1;
  // The first card drawn throws the Hero die twice
  state.decks.chance = ['ch-swarm', ...state.decks.chance.filter((c) => c !== 'ch-swarm')];
} else {
  own('s0', [1, 3], 3);
  own('s1', [37, 39], 5);
  own('s2', [16, 18, 19], 2);
  own('s2', [5], 0, true);
  own('s3', [15, 12]);
  own('s3', [21], 0, true);
  const pos: Record<SeatId, number> = { s0: 0, s1: 7, s2: 10, s3: 24 } as Record<SeatId, number>;
  for (const s of SEATS) {
    const p = state.players[s];
    if (p) {
      p.pos = pos[s];
      p.speed = true;
    }
  }
  const jailed = state.players.s2;
  if (jailed) jailed.jail = { tries: 0 };
}

const seats: Partial<Record<SeatId, SeatInfo>> = {};
SEATS.forEach((seat, i) => {
  // On Hero League a seat's token is its hero
  const token = heroes ? (state.players[seat]?.hero as TokenId) : (TOKENS[(i * 3) % 8]?.id ?? DEFAULT_TOKEN);
  seats[seat] = { seat, name: `P${i}`, token, color: SEAT_COLORS[i] ?? '#888', kind: 'bot', ctrl: '' };
});
const view = createStore<SessionView>({ doc: null, mySeats: ['s0'], connected: true, driver: true, tamper: null });
view.set({ ...view.get(), doc: { gid: 'dev', seq: state.seq, game: state, seats, ids: [], recent: [], timers: { turn: 0, decision: 0, auction: 8, debt: 0 }, strikes: {} } });
const listeners = new Set<(b: Batch) => void>();
const session: GameSession = {
  online: false,
  me: 'p_dev',
  code: null,
  view,
  onBatch(cb) {
    listeners.add(cb);
    cb({ seq: state.seq, events: [], state, snap: true });
    return () => listeners.delete(cb);
  },
  dispatch: async () => ({ ok: true, seq: state.seq }),
  serverNow: () => Date.now(),
  dispose: async () => {},
};

function commit(seat: SeatId | 'system', a: Action): boolean {
  const r = apply(state, { by: seat, a }, { check: false });
  if (!r.ok) {
    console.warn('refused', a, r.error);
    return false;
  }
  state = r.state;
  view.update({ doc: { ...(view.get().doc as NonNullable<SessionView['doc']>), seq: state.seq, game: state } });
  for (const cb of listeners) cb({ seq: state.seq, events: r.events, state });
  return true;
}

/** One command for whoever the game waits on: buy when possible, else the default */
function step(): void {
  const seat = awaiting(state)[0];
  if (!seat) return;
  const legal = legalActions(state, seat);
  const buy = legal.find((a) => a.k === 'buy');
  const a = buy ?? defaultAction(state, seat);
  if (a) commit(seat, a);
}

// The first roll lands on Chance (2 + 4 + speed 1 from GO); on Hero League on Villain Strike (2 + 3)
if (heroes) commit('s0', { k: 'debugRig', dice: [[2, 3]] });
else commit('s0', { k: 'debugRig', dice: [[2, 4, 1]] });

/** Hero League: the turn seat's Titan Smash on the first two other heroes outside the Holding Cell */
function smash(): boolean {
  const by = state.turn.seat;
  const [a, b] = state.order.filter((s) => s !== by && !state.players[s]?.jail);
  return !!a && !!b && commit(by, { k: 'smash', a, b });
}

/** Throws the Hero die alone (straight to the scene, not the engine) and resolves once it has landed */
function heroDie(face: number): Promise<void> {
  const hero = heroesOf(HEROES)[face - 1]?.id ?? '';
  return director.api('dice')?.hero?.({ t: 'heroDie', seat: 's0', face, hero, purpose: 'card' }, new AbortController().signal, 1, face * 7919) ?? Promise.resolve();
}

declare global {
  interface Window {
    harness: {
      step(): void;
      auto(on: boolean): void;
      state(): GameState;
      director: typeof director;
      ui: typeof uiStore;
      commit: typeof commit;
      dice(): (number | string)[];
      card(speed: number): void;
      smash(): boolean;
      heroDie(face: number): Promise<void>;
    };
  }
}
let timer: ReturnType<typeof setInterval> | null = null;
window.harness = {
  step,
  auto(on) {
    if (timer) clearInterval(timer);
    timer = on ? setInterval(() => director.idle.get() && step(), 300) : null;
  },
  state: () => state,
  director,
  ui: uiStore,
  commit,
  dice: shownDice,
  smash,
  heroDie,
  card(speed) {
    const text = 'Advance to Galle Fort Ramparts. If you pass Start, collect Rs. 20,000.';
    void director.api('cards')?.show({ t: 'card', seat: 's0', deck: 'chance', cardId: 'ch-galle', text, kept: false }, new AbortController().signal, speed);
  },
};

// Marks when a card starts showing, for the screenshot script
director.view.subscribe(() => {
  const w = window as unknown as { cardAt?: number };
  if (director.view.get().card && !w.cardAt) w.cardAt = performance.now();
});

if (q.get('backdrop') !== '1') sessionStore.set({ session });
const root = document.getElementById('root');
if (root) createRoot(root).render(<Stage />);
