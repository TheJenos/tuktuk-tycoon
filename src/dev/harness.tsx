import { createRoot } from 'react-dom/client';
import '../style.css';
import { apply, awaiting, createGame, defaultAction, legalActions, type Action, type GameState, type SeatId } from '../rules';
import type { Batch, GameSession, SeatInfo, SessionView } from '../net/types';
import { shownDice } from '../scene/dice/shown';
import { Stage } from '../scene/Stage';
import { SEAT_COLORS, TOKENS, DEFAULT_TOKEN } from '../shared/tokens';
import { sessionStore } from '../state/session';
import { createStore } from '../state/store';
import { uiStore } from '../state/ui';
import { settings, type AnimSpeed, type Quality } from '../ui/settings';
import { director } from '../view';

/*
 * DEV TOOL (not part of the app or its build): the 3D scene on its own, with no HUD, driven by an engine game set up
 * mid-way (complete colour groups with houses and hotels, mortgages, a player in jail) through a tiny fake GameSession.
 *   npx vite, then open /src/dev/scene.html?quality=high&anim=normal[&physics=0][&reduced=1][&backdrop=1]
 *   window.harness.step() plays one command for whoever the game waits on; auto(true) keeps playing.
 *   node src/dev/shots.mjs <outDir> runs it headless: screenshots plus checks (idle frames, picking, dice values,
 *   context loss).
 */

const q = new URLSearchParams(location.search);
settings.update({
  quality: (q.get('quality') as Quality) ?? 'high',
  animSpeed: (q.get('anim') as AnimSpeed) ?? 'normal',
  dicePhysics: q.get('physics') !== '0',
  reduceMotion: q.get('reduced') === '1',
});

const SEATS: SeatId[] = ['s0', 's1', 's2', 's3'];
let { state } = createGame({ speedDie: true, debug: true }, SEATS.map((id, i) => ({ id, name: `P${i}` })), 11);
state.order = [...SEATS];
state.turn = { seat: 's0', no: 1, doubles: 0, again: false };
const own = (seat: SeatId, spaces: number[], level: 0 | 1 | 2 | 3 | 4 | 5 = 0, mortgaged = false) => {
  for (const sp of spaces) {
    state.props[`p${sp}`] = { owner: seat, level, ...(mortgaged ? { mortgaged: true as const } : {}) };
    if (level === 5) state.bank.hotels--;
    else state.bank.houses -= level;
  }
};
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

const seats: Partial<Record<SeatId, SeatInfo>> = {};
SEATS.forEach((seat, i) => {
  seats[seat] = { seat, name: `P${i}`, token: TOKENS[(i * 3) % 8]?.id ?? DEFAULT_TOKEN, color: SEAT_COLORS[i] ?? '#888', kind: 'bot', ctrl: '' };
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

// The first roll lands on Chance (2 + 4 + speed 1 from GO)
commit('s0', { k: 'debugRig', dice: [[2, 4, 1]] });

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
