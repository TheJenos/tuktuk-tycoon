import { createRoot } from 'react-dom/client';
import '../style.css';
import { audioState, initAudio } from '../audio';
import { createLocalSession, createDoc, encodeDoc, type LocalSeat } from '../net';
import { localSeats, SOLO_SAVE_KEY } from '../net/local';
import { apply, RULES_VERSION, timer, type Action, type GameState, type SeatId } from '../rules';
import { Stage } from '../scene/Stage';
import { phaseSecs } from '../shared/timing';
import { SEAT_COLORS, DEFAULT_TOKEN, boardTokens, isTokenId, seatToken } from '../shared/tokens';
import { sessionStore } from '../state/session';
import { GameView } from '../ui/game';
import { settings, type AnimSpeed, type Quality } from '../ui/settings';
import { fontsReady } from '../ui/fonts';

/*
 * DEV TOOL (not part of the app or its build): the whole game screen (3D stage + GameView) over a local session,
 * for checking the HUD without the lobby.
 *   npx vite, then open /src/dev/game.html?seats=hhbb&speed=1[&board=colombo|hill|south|heroes][&quality=low][&anim=fast][&seed=7][&gl=0][&pace=20]
 *   [&scenario=start|buy|tax|bus|triple|auction|jail|debt|xfer|claim|trades|build|cards|bigtrade|over][&presence=1][&reduced=1]
 *   seats: one letter per seat, h = human (all played from this tab: hot-seat), b = bot. The rules have debug on,
 *   so window.game.test.rig() works. A scenario starts the game mid-way at that decision for s0 (saved as the solo
 *   game, then resumed). `trades` leaves offers open between other seats and to s0: add &pace=500 so the bots
 *   take their time answering them.
 *   Hero League (&board=heroes, up to 6 seats) has its own: react (s0's Thunder Call asked about its own throw), aim
 *   (Dead Aim on Villain Strike), boost (Viper Strike), smash (Titan Smash before the first roll, heroes spread out),
 *   and three where s0's next roll does it, rigged (the other heroes' superpowers used): shield (a Villain Strike card
 *   at s0, the Star Captain), backup (s0 lands short of a location's cost: the Hero die picks a back-up hero) and saved
 *   (the last location: the end).
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
const board = q.get('board') ?? 'lanka';
const tokens = boardTokens(board);
const seats: LocalSeat[] = letters.map((l, i) => ({
  name: l === 'h' ? `Human${i + 1}` : `Bot${i + 1}`,
  token: tokens[i % tokens.length] ?? DEFAULT_TOKEN,
  color: SEAT_COLORS[i] ?? '#888',
  kind: l === 'h' ? 'human' : 'bot',
}));
const rules = { speedDie: q.get('speed') === '1', debug: true, ...(q.get('board') ? { board } : {}) };
const seed = Number(q.get('seed') ?? 7);

type Run = (seat: SeatId, a: Action) => void;
/** The scenario's game as it is now (`run` replaces it) */
type Now = () => GameState;
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
/** Hero League: `seat` plays `hero` (the seat that had it takes this one's) */
const playHero = (s: GameState, seat: SeatId, hero: string) => {
  const p = s.players[seat]!;
  const holder = Object.values(s.players).find((x) => x?.hero === hero);
  if (holder) holder.hero = p.hero;
  p.hero = hero;
};
/** Hero League: every other hero passes the reaction windows in the way (their Thunder Call on s0's throw) */
const passWindows = (run: Run, now: Now) => {
  for (let ph = now().phase; ph.k === 'react'; ph = now().phase) run(ph.open[0] as SeatId, { k: 'pass', at: now().since });
};
/** Hero League: every other hero's superpower used, so nobody re-rolls (or shields against) s0's rigged throw */
const spendOthers = (s: GameState) => {
  for (const p of Object.values(s.players)) if (p && p.seat !== 's0') p.powerUsed = s.turn.no;
};
/** Puts this card on top of its deck */
const topCard = (s: GameState, deck: 'chance' | 'chest', id: string) => {
  s.decks[deck] = [id, ...s.decks[deck].filter((c) => c !== id)];
};
const SCENARIOS: Record<string, (s: GameState, run: Run, now: Now) => void> = {
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
  // s0 and s1 each hold a Get Out of Jail Free card (out of its deck) beside a little property
  cards: (s) => {
    own(s, 's0', [1, 5]);
    own(s, 's1', [6, 8]);
    const hold = (seat: SeatId, deck: 'chance' | 'chest', id: string) => {
      s.decks[deck] = s.decks[deck].filter((x) => x !== id);
      s.players[seat]!.goojf.push(id);
    };
    hold('s0', 'chance', 'ch-goojf');
    hold('s1', 'chest', 'cc-goojf');
  },
  // s0 and s1 own most of the board (a long trade builder): some mortgaged, houses on one of s1's sets
  bigtrade: (s) => {
    own(s, 's0', [1, 3, 5, 11, 12, 14, 15, 21, 23, 24, 25, 28, 35]);
    own(s, 's0', [13], 0, true);
    own(s, 's1', [6, 8, 9, 16, 18, 19, 26, 27, 29, 31, 32, 34]);
    own(s, 's1', [37, 39], 1);
    s.decks.chance = s.decks.chance.filter((x) => x !== 'ch-goojf');
    s.players.s0!.goojf.push('ch-goojf');
  },
  // One End turn from the game's end: everyone else is out
  over: (s) => {
    for (const seat of ['s1', 's2', 's3'] as const) if (s.players[seat]) s.players[seat].out = 'bankrupt';
    s.phase = { k: 'postRoll' };
  },
  // Hero League (&board=heroes)
  react: (s, run) => {
    playHero(s, 's0', 'stormLord');
    roll(run, [2, 3]);
  },
  aim: (s, run, now) => {
    playHero(s, 's0', 'sharpshot');
    roll(run, [2, 3]);
    passWindows(run, now);
  },
  boost: (s, run, now) => {
    playHero(s, 's0', 'velvetViper');
    roll(run, [1, 2]);
    passWindows(run, now);
  },
  smash: (s) => {
    playHero(s, 's0', 'jadeTitan');
    own(s, 's1', [9, 10]);
    (['s1', 's2', 's3', 's4', 's5'] as const).forEach((seat, i) => {
      const p = s.players[seat];
      if (p) p.pos = [9, 16, 24, 12, 19][i] ?? 0;
    });
  },
  shield: (s, run) => {
    playHero(s, 's0', 'starCaptain');
    spendOthers(s);
    topCard(s, 'chance', 'ch-drain');
    run('s0', { k: 'debugRig', dice: [[2, 3]] });
  },
  backup: (s, run) => {
    spendOthers(s);
    s.players.s0!.cash = 50;
    run('s0', { k: 'debugRig', dice: [[1, 3]] });
  },
  saved: (s, run) => {
    spendOthers(s);
    const others = s.order.filter((seat) => seat !== 's0');
    [1, 2, 6, 9, 10, 12, 13, 15, 16, 17, 19, 22, 24, 26, 27].forEach((space, i) => own(s, others[i % others.length] ?? 's0', [space]));
    run('s0', { k: 'debugRig', dice: [[1, 3]] });
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
  SCENARIOS[scenario](
    s,
    (seat, a) => {
      // An accept needs the offer's id, known only once proposed
      run(seat, a);
      if (a.k === 'propose' && scenario === 'xfer') {
        const t = Object.values(s.trades ?? {})[0] as { id: string } | undefined;
        if (t) run('s0', { k: 'accept', id: t.id });
      }
    },
    () => s,
  );
  // On Hero League a seat's token is the hero it plays (a scenario may have handed out others)
  for (const info of Object.values(doc.seats)) {
    const token = info && seatToken(s, info.seat, info.token);
    if (info && isTokenId(token)) info.token = token;
  }
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
  void fontsReady().then(() =>
    createRoot(root).render(
      <>
        <Stage />
        <GameView session={session} onLeave={() => location.reload()} />
      </>,
    ),
  );
