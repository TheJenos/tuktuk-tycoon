import { getBoard } from './board';
import { err, isActive, isSeat, makeCtx } from './ctx';
import { drain } from './flow';
import type { Handler } from './handler';
import { HANDLERS } from './handlers';
import { checkInvariants } from './invariants';
import { overError } from './over';
import type { Action, ApplyOptions, Command, GameState, Result, RuleError } from './types';

/** Assert invariants after every command in dev and test builds (off in production and the headless sim) */
const CHECK_BY_DEFAULT = import.meta.env?.DEV === true;

const fail = (error: RuleError): Result => ({ ok: false, error });

/** The envelope: a known action, a valid actor, and basis === seq when present (required for the system) */
function envelopeProblem(s: GameState, cmd: Command): RuleError | null {
  if (typeof cmd !== 'object' || cmd === null) return err('badCommand', 'Malformed command');
  const a = cmd.a as Action | undefined;
  if (typeof a !== 'object' || a === null || typeof a.k !== 'string' || !Object.hasOwn(HANDLERS, a.k)) {
    return err('badAction', 'Unknown action');
  }
  if (cmd.by !== 'system' && !isSeat(s, cmd.by)) return err('badActor', 'Unknown seat');
  if (cmd.basis !== undefined && cmd.basis !== s.seq) return err('stale', 'The game moved on; decide again');
  if (cmd.by === 'system' && cmd.basis === undefined) return err('basis', 'System commands must carry a basis');
  return null;
}

/**
 * Applies one command. Never throws and never mutates `state`: it clones it, runs the action, then drains the
 * pending steps until the game waits for someone again. Every accepted command bumps seq by 1.
 */
export function apply(state: GameState, cmd: Command, opts: ApplyOptions = {}): Result {
  try {
    const bad = envelopeProblem(state, cmd);
    if (bad) return fail(bad);
    const { by, a } = cmd;
    const h = HANDLERS[a.k] as Handler<Action['k']>;
    if (h.who === 'seat' && by === 'system') return fail(err('badActor', 'Only a player can do that'));
    if (h.who === 'system' && by !== 'system') return fail(err('badActor', 'Only the system can do that'));
    if (by !== 'system' && !isActive(state, by)) return fail(err('out', 'You are out of the game'));
    if (state.phase.k === 'over') return fail(overError);
    const problem = h.check(state, getBoard(state.cfg.board), by, a as never);
    if (problem) return fail(problem);

    const c = makeCtx(structuredClone(state));
    h.run(c, by, structuredClone(a) as never);
    drain(c);
    c.s.seq = state.seq + 1;
    if (c.entered) c.s.since = c.s.seq;
    if (opts.check ?? CHECK_BY_DEFAULT) {
      const broken = checkInvariants(c.s);
      if (broken.length) return fail(err('invariant', broken.join('; ')));
    }
    return { ok: true, state: c.s, events: c.ev };
  } catch (e) {
    return fail(err('internal', e instanceof Error ? e.message : String(e)));
  }
}
