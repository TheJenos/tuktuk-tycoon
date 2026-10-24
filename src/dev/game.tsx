import { createRoot } from 'react-dom/client';
import '../style.css';
import { audioState, initAudio } from '../audio';
import { createLocalSession, createDoc, encodeDoc, type LocalSeat } from '../net';
import { localSeats, SOLO_SAVE_KEY } from '../net/local';
import { apply, RULES_VERSION, timer, type Action, type GameState, type SeatId } from '../rules';
import { Stage } from '../scene/Stage';
import { phaseSecs } from '../shared/timing';
import { SEAT_COLORS, TOKENS, DEFAULT_TOKEN } from '../shared/tokens';
import { sessionStore } from '../state/session';
import { GameView } from '../ui/game';
import { settings, type AnimSpeed, type Quality } from '../ui/settings';

/*
 * DEV TOOL (not part of the app or its build): the whole game screen (3D stage + GameView) over a local session,
 * for checking the HUD without the lobby.
 *   npx vite, then open /src/dev/game.html?seats=hhbb&speed=1[&board=colombo|hill|south][&quality=low][&anim=fast][&seed=7][&gl=0][&pace=20]
 *   [&scenario=start|buy|tax|bus|triple|auction|jail|debt|xfer|claim|trades|build|over][&presence=1][&reduced=1]
 *   seats: one letter per seat, h = human (all played from this tab: hot-seat), b = bot. The rules have debug on,
 *   so window.game.test.rig() works. A scenario starts the game mid-way at that decision for s0 (saved as the solo
 *   game, then resumed). `trades` leaves offers open between other seats and to s0: add &pace=500 so the bots
 *   take their time answering them.
 */

const q = new URLSearchParams(location.search);
settings.update({
  quality: (q.get('quality') as Quality) ?? 'high',
  animSpeed: (q.get('anim') as AnimSpeed) ?? 'normal',
  reduceMotion: q.get('reduced') === '1',
});
// The Stage checks for the interface itself
if (q.get('gl') === '0') delete (window as Partial<Window & typeof globalThis>).WebGL2RenderingContext;

const letters = (q.get('seats') ?? 'hbbb').split('');
const seats: LocalSeat[] = letters.map((l, i) => ({
  name: l === 'h' ? `Human${i + 1}` : `Bot${i + 1}`,
  token: TOKENS[i % TOKENS.length]?.id ?? DEFAULT_TOKEN,
  color: SEAT_COLORS[i] ?? '#888',
  kind: l === 'h' ? 'human' : 'bot',
}));
const rules = { speedDie: q.get('speed') === '1', debug: true, ...(q.get('board') ? { board: q.get('board') as string } : {}) };
const seed = Number(q.get('seed') ?? 7);

type Run = (seat: SeatId, a: Action) => void;
const own = (s: GameState, seat: SeatId, spaces: number[], level = 0, mortgaged = false) => {
  for (const sp of spaces) {
    s.props[`p${sp}`] = { owner: seat, level: level as 0, ...(mortgaged ? { mortgaged: true as const } : {}) };
    if (level === 5) s.bank.hotels--;
    else s.bank.houses -= level;
  }
};
const roll = (run: Run, dice: (number | 'bus' | 'uncle')[]) => {
  run('s0', { k: 'debugRig', dice: [dice as [number, number]] });
  run('s0', { k: 'roll' });
};
const SCENARIOS: Record<string, (s: GameState, run: Run) => void> = {
  // s0 to roll first
  start: () => {},
  buy: (_s, run) => roll(run, [1, 2]),
  tax: (_s, run) => roll(run, [1, 3]),
  bus: (_s, run) => roll(run, [2, 3, 'bus']),
  triple: (_s, run) => roll(run, [2, 2, 2]),
  auction: (_s, run) => {
    roll(run, [1, 2]);
    run('s0', { k: 'decline' });
  },
  jail: (s) => {
    const p = s.players.s0!;
    p.pos = 10;
    p.jail = { tries: 0 };
  },
  debt: (s, run) => {
    own(s, 's1', [37, 39], 5);
    s.players.s0!.pos = 35;
    s.players.s0!.cash = 300;
    own(s, 's0', [1, 3]);
    roll(run, [1, 3]);
  },
  xfer: (s, run) => {
    own(s, 's1', [5, 15], 0, true);
    run('s1', { k: 'propose', to: 's0', give: { cash: 0, props: [5, 15], cards: [] }, get: { cash: 10, props: [], cards: [] } });
  },
  // A housing shortage: s0 builds while s1 could too
  claim: (s, run) => {
    own(s, 's0', [1, 3]);
    own(s, 's1', [6, 8, 9]);
    own(s, 's2', [16, 18, 19], 4);
    own(s, 's3', [21, 23, 24], 4);
    s.bank.houses = 4;
    run('s0', { k: 'build', group: 'brown', levels: [1, 1] });
  },
  // Everyone owns a little; open offers between the others (s1 to s2, s2 to s3) and one to s0, s0 to roll
  trades: (s, run) => {
    own(s, 's0', [1, 3, 6]);
    own(s, 's1', [8, 9, 11]);
    own(s, 's2', [16, 18, 5]);
    own(s, 's3', [21, 23, 39]);
    run('s1', { k: 'propose', to: 's2', give: { cash: 0, props: [11], cards: [] }, get: { cash: 200, props: [16], cards: [] } });
    run('s2', { k: 'propose', to: 's3', give: { cash: 0, props: [5, 18], cards: [] }, get: { cash: 0, props: [39], cards: [] } });
    run('s3', { k: 'propose', to: 's0', give: { cash: 0, props: [21], cards: [] }, get: { cash: 0, props: [6], cards: [] } });
  },
  // s0 owns a full colour set (ready to build), part of another, a station, a mortgaged station and a board
  build: (s) => {
    own(s, 's0', [6, 8, 9]);
    own(s, 's0', [1, 5, 12]);
    own(s, 's0', [15], 0, true);
  },
  // One End turn from the game's end: everyone else is out
  over: (s) => {
    for (const seat of ['s1', 's2', 's3'] as const) if (s.players[seat]) s.players[seat].out = 'bankrupt';
    s.phase = { k: 'postRoll' };
  },
};

const scenario = q.get('scenario');
if (scenario && SCENARIOS[scenario]) {
  const doc = createDoc({ gid: 'g_devscenario', seats: localSeats(seats), rules, seed, at: Date.now() });
  let s = doc.game;
  s.order = seats.map((_, i) => `s${i}` as SeatId);
  s.turn = { seat: 's0', no: 1, doubles: 0, again: false };
  s.phase = { k: 'preRoll' };
  for (const p of Object.values(s.players)) if (p && rules.speedDie) p.speed = true;
  const run: Run = (seat, a) => {
    const r = apply(s, { by: seat, a }, { check: false });
    if (!r.ok) throw new Error(`${scenario}: ${seat} ${a.k} refused: ${r.error.message}`);
    s = r.state;
  };
  SCENARIOS[scenario](s, (seat, a) => {
    // An accept needs the offer's id, known only once proposed
    run(seat, a);
    if (a.k === 'propose' && scenario === 'xfer') {
      const t = Object.values(s.trades ?? {})[0] as { id: string } | undefined;
      if (t) run('s0', { k: 'accept', id: t.id });
    }
  });
  doc.game = s;
  doc.seq = s.seq;
  // The resumed session restarts a running deadline from now
  const t = timer(s);
  if (t && phaseSecs(t.kind, doc.timers) > 0) doc.deadline = { key: t.key, at: Date.now() };
  else delete doc.deadline;
  localStorage.setItem(SOLO_SAVE_KEY, JSON.stringify({ v: RULES_VERSION, name: 'dev', at: Date.now(), doc: encodeDoc(doc) }));
}

const session = createLocalSession({ name: 'dev', seats, rules, seed, pace: Number(q.get('pace') ?? 1), resume: !!scenario });
// presence=1 fakes an online room's connection dots: the first human online, the others offline
if (q.get('presence') === '1') {
  const humans = seats.flatMap((x, i) => (x.kind === 'human' ? [`s${i}` as SeatId] : []));
  session.view.update({ presence: Object.fromEntries(humans.map((seat, i) => [seat, i === 0 ? 'online' : 'offline'])) });
}
sessionStore.set({ session });
initAudio();
(window as { audio?: typeof audioState }).audio = audioState;

const root = document.getElementById('root');
if (root)
  createRoot(root).render(
    <>
      <Stage />
      <GameView session={session} onLeave={() => location.reload()} />
    </>,
  );
