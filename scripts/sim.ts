// Headless random-legal-action games against the rules engine, with invariants checked after every command.
// npm run sim -- [games] [--players=N] [--speed] [--seed=N] [--turns=N] [--options]
// --options varies the optional rules (jackpot, auctions off, first lap, quick deal, ...) game by game.
import { apply, createGame, encode, SEAT_IDS } from '../src/rules';
import { randFrom, randomCommand, variedRules } from '../src/rules/randomPlayer';
import type { GameState, OverPhase } from '../src/rules';

const args = process.argv.slice(2);
const flag = (name: string, fallback: number): number => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  const n = hit ? Number(hit.split('=')[1]) : fallback;
  return Number.isFinite(n) ? n : fallback;
};
const games = Number(args.find((a) => /^\d+$/.test(a)) ?? 100);
const players = Math.min(8, Math.max(2, flag('players', 4)));
const speedDie = args.includes('--speed');
const seed0 = flag('seed', 1);
const turnLimit = flag('turns', 400);
const options = args.includes('--options');
const MAX_COMMANDS = 50_000;

interface Stats {
  ends: Record<OverPhase['why'] | 'stuck', number>;
  turns: number[];
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
  ends: { lastStanding: 0, firstBankrupt: 0, turnLimit: 0, endGame: 0, timeUp: 0, stuck: 0 },
  turns: [],
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
  const seats = SEAT_IDS.slice(0, players).map((id, i) => ({ id, name: `Bot ${i + 1}` }));
  let s: GameState = createGame({ ...(options ? variedRules(seed) : {}), speedDie, turnLimit }, seats, seed).state;
  const r = randFrom(seed * 2654435761);
  let n = 0;
  for (; n < MAX_COMMANDS && s.phase.k !== 'over'; n++) {
    const cmd = randomCommand(s, r, { resign: 0.0005 });
    if (!cmd) break;
    const res = apply(s, cmd, { check: true });
    if (!res.ok) {
      if (cmd.a.k === 'propose') stats.refused++;
      else stats.failures.push(`game ${seed} #${n}: ${JSON.stringify(cmd)} -> ${res.error.code} ${res.error.message}`);
      continue;
    }
    for (const e of res.events) {
      if (e.t === 'bankrupt') e.resigned ? stats.resignations++ : stats.bankruptcies++;
      else if (e.t === 'auctionStart') stats.auctions++;
      else if (e.t === 'tradeDone') stats.trades++;
    }
    s = res.state;
    stats.maxBytes = Math.max(stats.maxBytes, encode(s).length);
  }
  stats.commands += n;
  stats.turns.push(s.turn.no);
  if (s.phase.k === 'over') stats.ends[s.phase.why]++;
  else stats.ends.stuck++;
  if (stats.failures.length > 20) break;
}

const avg = (xs: number[]): number => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : 0);
const played = stats.turns.length;
console.log(`sim: ${played} games, ${players} players, Speed Die ${speedDie ? 'on' : 'off'}, turn limit ${turnLimit}${options ? ', options varied' : ''}`);
console.log(`  ended: ${JSON.stringify(stats.ends)}`);
console.log(`  turns per game: avg ${avg(stats.turns).toFixed(1)}, max ${Math.max(...stats.turns)}`);
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
