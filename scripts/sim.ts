// Headless random-legal-action games against the rules engine, with invariants checked after every command.
// npm run sim -- [games] [--board=ID] [--players=N] [--cash=N] [--speed] [--seed=N] [--turns=N] [--options]
// --board picks the board (default lanka; the players are clamped to its cap). --cash sets the starting cash. --options
// varies the optional rules (jackpot, auctions off, first lap, quick deal, ...) game by game. Prints how the games
// ended and how many rounds they took; on Hero League also the share of games ending allSaved within 60 rounds,
// counted over the games no random resignation ended, against the 95% bar (PASS / FAIL on the exact counts; the plan
// sets that bar for the mixed 2-6 seat table, heroesEnd.test.ts, so one seat count may miss it). Each game is
// randomPlayer.ts's playRandomGame, which heroesEnd.test.ts plays too.
import { BOARD_IDS, encode, getBoard } from '../src/rules';
import { ALL_SAVED_ROUNDS, playRandomGame, variedRules } from '../src/rules/randomPlayer';
import type { OverPhase } from '../src/rules';

const args = process.argv.slice(2);
const flag = (name: string, fallback: number): number => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  const n = hit ? Number(hit.split('=')[1]) : fallback;
  return Number.isFinite(n) ? n : fallback;
};
const games = Number(args.find((a) => /^\d+$/.test(a)) ?? 100);
const boardArg = args.find((a) => a.startsWith('--board='))?.split('=')[1] ?? 'lanka';
if (!BOARD_IDS.includes(boardArg)) {
  console.error(`unknown board ${boardArg}: one of ${BOARD_IDS.join(', ')}`);
  process.exit(2);
}
const board = getBoard(boardArg);
const players = Math.min(board.maxPlayers, Math.max(2, flag('players', 4)));
const speedDie = args.includes('--speed');
const seed0 = flag('seed', 1);
const turnLimit = flag('turns', 400);
const startCash = flag('cash', -1);
const options = args.includes('--options');

interface Stats {
  ends: Record<OverPhase['why'] | 'stuck', number>;
  turns: number[];
  /** Rounds per game: every player's turn once (turns / players, rounded up) */
  rounds: number[];
  /** Games ended allSaved within ALL_SAVED_ROUNDS rounds */
  savedInCap: number;
  /** Games a random resignation ended (lastStanding) */
  resignedOut: number;
  shorts: number;
  noSaves: number;
  powers: number;
  commands: number;
  refused: number;
  bankruptcies: number;
  resignations: number;
  auctions: number;
  trades: number;
  maxBytes: number;
  failures: string[];
}

const stats: Stats = {
  ends: { lastStanding: 0, firstBankrupt: 0, turnLimit: 0, endGame: 0, timeUp: 0, allSaved: 0, stuck: 0 },
  turns: [],
  rounds: [],
  savedInCap: 0,
  resignedOut: 0,
  shorts: 0,
  noSaves: 0,
  powers: 0,
  commands: 0,
  refused: 0,
  bankruptcies: 0,
  resignations: 0,
  auctions: 0,
  trades: 0,
  maxBytes: 0,
  failures: [],
};

const started = Date.now();
for (let g = 0; g < games; g++) {
  const seed = seed0 + g;
  const cfg = {
    ...(options ? variedRules(seed) : {}),
    board: board.id,
    speedDie,
    turnLimit,
    ...(startCash >= 0 ? { startCash } : {}),
  };
  const game = playRandomGame(cfg, players, seed, {
    onApply(events, state) {
      for (const e of events) {
        if (e.t === 'bankrupt') e.resigned ? stats.resignations++ : stats.bankruptcies++;
        else if (e.t === 'auctionStart') stats.auctions++;
        else if (e.t === 'tradeDone') stats.trades++;
        else if (e.t === 'short') stats.shorts++;
        else if (e.t === 'noSave') stats.noSaves++;
        else if (e.t === 'power') stats.powers++;
      }
      stats.maxBytes = Math.max(stats.maxBytes, encode(state).length);
    },
  });
  const { state: s, rounds } = game;
  stats.commands += game.commands;
  stats.refused += game.refused;
  stats.failures.push(...game.failures);
  stats.turns.push(s.turn.no);
  stats.rounds.push(rounds);
  if (s.phase.k === 'over') stats.ends[s.phase.why]++;
  else stats.ends.stuck++;
  if (s.phase.k === 'over' && s.phase.why === 'allSaved' && rounds <= ALL_SAVED_ROUNDS) stats.savedInCap++;
  if (s.phase.k === 'over' && s.phase.why === 'lastStanding') stats.resignedOut++;
  if (stats.failures.length > 20) break;
}

const avg = (xs: number[]): number => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : 0);
/** The value at quantile q of a list (nearest rank) */
const quantile = (xs: number[], q: number): number => {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))] ?? 0;
};
const played = stats.turns.length;
const heroes = !!board.heroes;
const cashNote = startCash >= 0 ? `, start cash ${startCash}` : '';
console.log(
  `sim: ${played} games on ${board.display.name}, ${players} players${cashNote}, Speed Die ${speedDie ? 'on' : 'off'}, turn limit ${turnLimit}${options ? ', options varied' : ''}`,
);
console.log(`  ended: ${JSON.stringify(Object.fromEntries(Object.entries(stats.ends).filter(([, n]) => n > 0)))}`);
console.log(`  turns per game: avg ${avg(stats.turns).toFixed(1)}, max ${Math.max(...stats.turns)}`);
console.log(
  `  rounds per game: median ${quantile(stats.rounds, 0.5)}, p95 ${quantile(stats.rounds, 0.95)}, max ${Math.max(...stats.rounds)}`,
);
if (heroes) {
  // Hero League has no bankruptcy: lastStanding only comes from the random player's resignations
  const counted = played - stats.resignedOut;
  // Judged on the exact counts and shown rounded down, so a rate under the bar never reads as 95% (908/956 is 94.97%)
  const pass = stats.savedInCap * 100 >= 95 * counted;
  const pct = Math.floor((10_000 * stats.savedInCap) / Math.max(1, counted)) / 100;
  console.log(
    `  allSaved within ${ALL_SAVED_ROUNDS} rounds: ${stats.savedInCap}/${counted} games not ended by resignations, ${pct.toFixed(2)}% (bar 95%: ${pass ? 'PASS' : 'FAIL'})`,
  );
  console.log(`  superpowers used ${stats.powers}, short payments ${stats.shorts}, no-save landings ${stats.noSaves}`);
}
console.log(`  commands: ${stats.commands} (${(stats.commands / Math.max(1, played)).toFixed(0)} per game)`);
console.log(`  bankruptcies ${stats.bankruptcies}, resignations ${stats.resignations}`);
console.log(`  auctions ${stats.auctions}, trades ${stats.trades}`);
console.log(`  refused random offers ${stats.refused}; largest state ${(stats.maxBytes / 1024).toFixed(1)} KB`);
console.log(`  ${((Date.now() - started) / 1000).toFixed(1)} s`);
if (stats.failures.length) {
  console.log(`FAILURES (${stats.failures.length}):`);
  for (const f of stats.failures.slice(0, 20)) console.log(`  ${f}`);
  process.exitCode = 1;
}
