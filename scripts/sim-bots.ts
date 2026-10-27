// Bot-vs-bot games through the engine with invariants checked after every command (Milestones 3 and 8).
// npm run sim:bots -- [--games 100] [--players 4] [--speed] [--seed 1] [--skills easy,normal,hard,expert] [--turns 400]
//   [--jobs 1] [--fast] [--expect expert=0.57,...] [--options] [--board lanka|colombo|hill|south]
// --jobs N plays the games on N worker threads (decision times are then only indicative: the threads compete);
// --fast skips the invariant checks (strength runs); --expect fails the run when a skill wins a smaller share of the
// games. Exits with code 1 on any illegal or fallen-back bot decision, broken invariant, game that does not end or
// missed --expect. --options varies the optional rules (jackpot, auctions off, first lap, quick deal...) game by
// game. --board plays that board with its standard rules (All Island by default). The Expert check: --players 2 --skills hard,expert --games 600 --jobs 8 --fast --expect expert=0.57
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import type { BotSkill } from '../src/net/types';
import { type DecisionTimes, type GameReport, SLOW_MS, playGame } from '../src/bots/arena';
import { variedRules } from '../src/rules/randomPlayer';
import { getBoard, hasBoard } from '../src/rules/board';

const SKILLS: readonly BotSkill[] = ['easy', 'normal', 'hard', 'expert'];

interface Setup {
  games: number;
  players: number;
  seed0: number;
  turnLimit: number;
  speedDie: boolean;
  skills: BotSkill[];
  check: boolean;
  /** Vary the optional rules game by game */
  options: boolean;
  /** Least share of the games each listed skill must win */
  expect: Partial<Record<BotSkill, number>>;
  /** The board (played with its standard rules) */
  board: string;
}

/** Rotate skills over the seats game by game, so no skill always sits first */
const lineup = (st: Setup, g: number): BotSkill[] =>
  Array.from({ length: st.players }, (_, i) => st.skills[(i + g) % st.skills.length] as BotSkill);

/** Plays games from, from + step, ... (stops early once failures pile up) */
function playSome(st: Setup, from: number, step: number): GameReport[] {
  const out: GameReport[] = [];
  let failures = 0;
  for (let g = from; g < st.games && failures <= 50; g += step) {
    const seed = st.seed0 + g;
    const cfg = { ...getBoard(st.board).rules, ...(st.options ? variedRules(seed) : {}), board: st.board };
    const r = playGame({ seed, players: st.players, skills: lineup(st, g), speedDie: st.speedDie, turnLimit: st.turnLimit, check: st.check, cfg });
    failures += r.failures.length;
    out.push(r);
  }
  return out;
}

function setupFromArgs(args: string[]): Setup & { jobs: number } {
  /** `--name value` or `--name=value` */
  const opt = (name: string): string | undefined => {
    const i = args.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
    if (i < 0) return undefined;
    const arg = args[i] as string;
    return arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : args[i + 1];
  };
  const num = (name: string, fallback: number, min: number, max: number): number => {
    const n = Number(opt(name));
    return Number.isFinite(n) && opt(name) !== undefined ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
  };
  const skills = (opt('skills') ?? 'easy,normal,hard,expert')
    .split(',')
    .map((x) => x.trim())
    .filter((x): x is BotSkill => (SKILLS as readonly string[]).includes(x));
  if (skills.length === 0) {
    console.error(`--skills takes a comma-separated list of ${SKILLS.join(', ')}`);
    process.exit(2);
  }
  const expect: Partial<Record<BotSkill, number>> = {};
  for (const part of (opt('expect') ?? '').split(',').filter(Boolean)) {
    const [skill, share] = part.split('=');
    if (!(SKILLS as readonly string[]).includes(skill ?? '') || !Number.isFinite(Number(share))) {
      console.error(`--expect takes skill=share pairs, such as expert=0.57`);
      process.exit(2);
    }
    expect[skill as BotSkill] = Number(share);
  }
  return {
    games: num('games', 100, 1, 100_000),
    players: num('players', 4, 2, 8),
    seed0: num('seed', 1, 0, 2 ** 31),
    turnLimit: num('turns', 400, 1, 100_000),
    speedDie: args.includes('--speed'),
    skills,
    check: !args.includes('--fast'),
    options: args.includes('--options'),
    expect,
    board: hasBoard(opt('board') ?? '') ? (opt('board') as string) : 'lanka',
    jobs: num('jobs', 1, 1, Math.max(1, availableParallelism())),
  };
}

async function main(): Promise<void> {
  const st = setupFromArgs(process.argv.slice(2));
  const started = Date.now();
  let reports: GameReport[];
  if (st.jobs <= 1) reports = playSome(st, 0, 1);
  else {
    const file = fileURLToPath(import.meta.url);
    const parts = await Promise.all(
      Array.from(
        { length: st.jobs },
        (_, k) =>
          new Promise<GameReport[]>((resolve, reject) => {
            const w = new Worker(file, { workerData: { st, from: k, step: st.jobs } });
            w.once('message', resolve);
            w.once('error', reject);
          }),
      ),
    );
    reports = parts.flat().sort((a, b) => a.seed - b.seed);
  }

  const ends: Record<string, number> = {};
  const seatsBySkill: Record<string, number> = {};
  const winsBySkill: Record<string, number> = {};
  const times: Partial<Record<BotSkill, DecisionTimes>> = {};
  const failures: string[] = [];
  let turns = 0;
  let commands = 0;
  let trades = 0;
  let proposals = 0;
  let auctions = 0;
  let bankruptcies = 0;
  for (const r of reports) {
    ends[r.ended] = (ends[r.ended] ?? 0) + 1;
    for (const skill of Object.values(r.skills)) seatsBySkill[skill] = (seatsBySkill[skill] ?? 0) + 1;
    const winSkill = r.winner ? r.skills[r.winner] : undefined;
    if (winSkill) winsBySkill[winSkill] = (winsBySkill[winSkill] ?? 0) + 1;
    for (const [skill, t] of Object.entries(r.times) as [BotSkill, DecisionTimes][]) {
      const all = (times[skill] ??= { n: 0, ms: 0, max: 0, slow: 0 });
      all.n += t.n;
      all.ms += t.ms;
      all.max = Math.max(all.max, t.max);
      all.slow += t.slow;
    }
    turns += r.turns;
    commands += r.commands;
    trades += r.trades;
    proposals += r.proposals;
    auctions += r.auctions;
    bankruptcies += r.bankruptcies;
    failures.push(...r.failures);
  }

  const played = reports.length;
  const pct = (x: number, of: number): string => `${((100 * x) / Math.max(1, of)).toFixed(1)}%`;
  console.log(
    `sim:bots: ${played} games, ${st.players} players, Speed Die ${st.speedDie ? 'on' : 'off'}, turn limit ${st.turnLimit}, ` +
      `skills ${st.skills.join(',')}${st.check ? '' : ', invariants not checked'}${st.options ? ', options varied' : ''}${st.jobs > 1 ? `, ${st.jobs} threads` : ''}`,
  );
  console.log(`  finished: ${played - (ends.stuck ?? 0)}/${played}  ended: ${JSON.stringify(ends)}`);
  console.log(`  turns per game: avg ${(turns / Math.max(1, played)).toFixed(1)}; commands per game ${(commands / Math.max(1, played)).toFixed(0)}`);
  console.log(`  trades ${trades} (of ${proposals} offers), auctions ${auctions}, bankruptcies ${bankruptcies}`);
  console.log('  wins by skill (share of games won / share of seats held; +- is the 95% margin):');
  for (const skill of st.skills) {
    const wins = winsBySkill[skill] ?? 0;
    const p = wins / Math.max(1, played);
    const margin = 1.96 * Math.sqrt((p * (1 - p)) / Math.max(1, played));
    console.log(
      `    ${skill.padEnd(7)} ${String(wins).padStart(5)} wins  ${pct(wins, played).padStart(6)} +-${(100 * margin).toFixed(1)}  of games  ` +
        `(${pct(seatsBySkill[skill] ?? 0, played * st.players)} of seats)`,
    );
  }
  console.log(`  decision time per skill${st.jobs > 1 ? ' (threads compete: indicative only)' : ''}:`);
  for (const skill of st.skills) {
    const t = times[skill];
    if (!t) continue;
    console.log(
      `    ${skill.padEnd(7)} avg ${(t.ms / Math.max(1, t.n)).toFixed(2)} ms  max ${t.max.toFixed(1)} ms  ` +
        `over ${SLOW_MS} ms: ${t.slow} of ${t.n}`,
    );
  }
  console.log(`  ${((Date.now() - started) / 1000).toFixed(1)} s`);
  for (const [skill, share] of Object.entries(st.expect) as [BotSkill, number][]) {
    const won = (winsBySkill[skill] ?? 0) / Math.max(1, played);
    if (won >= share) continue;
    console.log(`EXPECTED ${skill} to win at least ${pct(share, 1)} of games, got ${pct(won, 1)}`);
    process.exitCode = 1;
  }
  if (failures.length) {
    console.log(`FAILURES (${failures.length}):`);
    for (const f of failures.slice(0, 30)) console.log(`  ${f}`);
    process.exitCode = 1;
  }
}

if (isMainThread) await main();
else {
  const { st, from, step } = workerData as { st: Setup; from: number; step: number };
  parentPort?.postMessage(playSome(st, from, step));
}
