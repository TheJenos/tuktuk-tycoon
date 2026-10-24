import { describe, expect, it } from 'vitest';
import { apply, type GameState } from '../../../rules';
import {
  EMPTY_PLAN,
  mortgageProblem,
  normalizePlan,
  planActions,
  planEmpty,
  planSummary,
  stepLevel,
  stepProblem,
  targetLevel,
  toggleMortgage,
  type Plan,
} from '../manage/buildPlan';
import { act, game, own } from './helpers';

const LIGHT_BLUE = [6, 8, 9]; // Oriental, Vermont, Connecticut: houses Rs. 50
const BROWN = [1, 3];
const ORANGE = [16, 18, 19];
const READING = 5;

/** Plays the plan's actions through the engine; each must be accepted */
function applyPlan(s: GameState, plan: Plan): GameState {
  for (const a of planActions(s, 's0', plan)) s = act(s, 's0', a).state;
  return s;
}

const cash = (s: GameState) => s.players.s0!.cash;

/** Bob builds evenly on whole groups of his own until the bank has `left` houses (the stock stays consistent) */
function drainHouses(s: GameState, left: number): void {
  for (const group of [[11, 13, 14], [16, 18, 19], [21, 23, 24], [26, 27, 29], [37, 39]]) {
    if (s.bank.houses <= left || group.some((i) => s.props[`p${i}`])) continue;
    const total = Math.min(4 * group.length, s.bank.houses - left);
    group.forEach((space, i) => own(s, 's1', [space], Math.floor(total / group.length) + (i < total % group.length ? 1 : 0)));
  }
}

describe('buildPlan', () => {
  it('stages even building with hints naming the street to build on first', () => {
    const s = game();
    own(s, 's0', LIGHT_BLUE);
    expect(stepProblem(s, 's0', EMPTY_PLAN, 8, 1)).toBeNull();
    const p = stepLevel(s, 's0', EMPTY_PLAN, 6, 1);
    expect(targetLevel(s, p, 6)).toBe(1);
    expect(stepProblem(s, 's0', p, 6, 1)).toBe('Build evenly: Hoppers Corner first');
    expect(stepProblem(s, 's0', p, 8, -1)).toBe('No buildings to sell');
    expect(planActions(s, 's0', p)).toEqual([{ k: 'build', group: 'lightBlue', levels: [1, 0, 0] }]);
    const sum = planSummary(s, 's0', p);
    expect(sum.cash).toBe(-50);
    expect(sum.bankHouses).toBe(31);
    const after = applyPlan(s, p);
    expect(cash(after)).toBe(cash(s) - 50);
    expect(planEmpty(normalizePlan(after, 's0', p))).toBe(true);
  });

  it('needs the whole group, and nothing mortgaged in it, to build', () => {
    const s = game();
    own(s, 's0', [6, 8]);
    expect(stepProblem(s, 's0', EMPTY_PLAN, 6, 1)).toBe('Own the whole colour group to build');
    own(s, 's0', [9], 0, true);
    expect(stepProblem(s, 's0', EMPTY_PLAN, 6, 1)).toBe('Lift every mortgage in the group first');
    // Staging the lift opens building; Apply lifts first, then builds
    let p = toggleMortgage(s, 's0', EMPTY_PLAN, 9);
    expect(stepProblem(s, 's0', p, 6, 1)).toBeNull();
    p = stepLevel(s, 's0', p, 6, 1);
    expect(planActions(s, 's0', p).map((a) => a.k)).toEqual(['unmortgage', 'build']);
    expect(planSummary(s, 's0', p).cash).toBe(-(66 + 50));
    const after = applyPlan(s, p);
    expect(after.props.p9?.mortgaged).toBeUndefined();
    expect(after.props.p6?.level).toBe(1);
    // Mortgaging again drops the staged build
    const back = toggleMortgage(s, 's0', p, 9);
    expect(planEmpty(back)).toBe(true);
  });

  it('sells before mortgaging, and refuses a mortgage under buildings', () => {
    const s = game();
    own(s, 's0', LIGHT_BLUE, 2);
    own(s, 's0', [READING]);
    expect(mortgageProblem(s, 's0', EMPTY_PLAN, 6)).toBe("Sell the group's buildings first");
    let p: Plan = EMPTY_PLAN;
    for (const space of [6, 8, 9, 6, 8, 9]) {
      expect(stepProblem(s, 's0', p, space, -1)).toBeNull();
      p = stepLevel(s, 's0', p, space, -1);
    }
    expect(mortgageProblem(s, 's0', p, 6)).toBeNull();
    p = toggleMortgage(s, 's0', p, 6);
    p = toggleMortgage(s, 's0', p, READING);
    expect(planActions(s, 's0', p)).toEqual([
      { k: 'sell', group: 'lightBlue', levels: [0, 0, 0] },
      { k: 'mortgage', space: READING },
      { k: 'mortgage', space: 6 },
    ]);
    const sum = planSummary(s, 's0', p);
    expect(sum.cash).toBe(6 * 25 + 50 + 100);
    expect(sum.bankHouses).toBe(32);
    const after = applyPlan(s, p);
    expect(cash(after)).toBe(cash(s) + sum.cash);
  });

  it('sells evenly from the highest street', () => {
    const s = game();
    own(s, 's0', LIGHT_BLUE, 2);
    s.props.p9!.level = 3;
    s.bank.houses -= 1;
    expect(stepProblem(s, 's0', EMPTY_PLAN, 6, -1)).toBe('Sell evenly: Kiribath Junction first');
    // A swap (down on one street, up on another) sells first, then builds
    let p = stepLevel(s, 's0', EMPTY_PLAN, 9, -1);
    p = stepLevel(s, 's0', p, 6, 1);
    expect(planActions(s, 's0', p)).toEqual([
      { k: 'sell', group: 'lightBlue', levels: [2, 2, 2] },
      { k: 'build', group: 'lightBlue', levels: [3, 2, 2] },
    ]);
    expect(planSummary(s, 's0', p).cash).toBe(25 - 50);
    applyPlan(s, p);
  });

  it('counts hotels against the bank', () => {
    const s = game();
    own(s, 's0', LIGHT_BLUE, 4);
    const p = stepLevel(s, 's0', EMPTY_PLAN, 6, 1);
    const sum = planSummary(s, 's0', p);
    expect(sum.cash).toBe(-50);
    expect(sum.bankHouses).toBe(32 - 12 + 4);
    expect(sum.bankHotels).toBe(11);
    expect(stepProblem(s, 's0', p, 6, 1)).toBe('It already has a hotel');
    applyPlan(s, p);
  });

  it('reports cash and bank shortfalls', () => {
    const s = game();
    own(s, 's0', LIGHT_BLUE);
    s.players.s0!.cash = 60;
    s.bank.houses = 2;
    let p: Plan = EMPTY_PLAN;
    for (const space of LIGHT_BLUE) p = stepLevel(s, 's0', p, space, 1);
    const sum = planSummary(s, 's0', p);
    expect(sum.problems).toEqual(['You need Rs. 90 more', 'The bank has only 2 houses']);
  });

  it('checks the bank step by step, as the engine does, not just the net change', () => {
    // (4,4,3) to a hotel with no houses left: the 3 must go to 4 first, and that needs a house
    const s = game();
    own(s, 's0', LIGHT_BLUE, 4);
    s.props.p9!.level = 3;
    s.bank.houses += 1;
    drainHouses(s, 0);
    s.players.s0!.cash = 5_000;
    let p = stepLevel(s, 's0', EMPTY_PLAN, 9, 1);
    p = stepLevel(s, 's0', p, 6, 1);
    expect(p.levels.lightBlue).toEqual([5, 4, 4]);
    expect(planSummary(s, 's0', p).problems).toEqual(['The bank has only 0 houses']);
    expect(apply(s, { by: 's0', a: planActions(s, 's0', p)[0]! }, { check: true }).ok).toBe(false);

    // (3,3,3) to (4,4,5) with 2 houses: 3 are needed before the hotel gives 4 back
    const o = game();
    own(o, 's0', ORANGE, 3);
    drainHouses(o, 2);
    o.players.s0!.cash = 5_000;
    const q: Plan = { levels: { orange: [4, 4, 5] }, mortgage: {} };
    expect(planSummary(o, 's0', q).problems).toEqual(['The bank has only 2 houses']);
  });

  it('builds the group that frees houses first, so a shortage plan that can work does', () => {
    const s = game();
    own(s, 's0', BROWN);
    own(s, 's0', LIGHT_BLUE, 4);
    drainHouses(s, 0);
    s.players.s0!.cash = 5_000;
    // Bob can't afford to build, so no shortage contest starts
    s.players.s1!.cash = 0;
    let p = stepLevel(s, 's0', EMPTY_PLAN, 1, 1);
    p = stepLevel(s, 's0', p, 3, 1);
    p = stepLevel(s, 's0', p, 6, 1);
    expect(planSummary(s, 's0', p).problems).toEqual([]);
    expect(planActions(s, 's0', p).map((a) => (a.k === 'build' ? a.group : a.k))).toEqual(['lightBlue', 'brown']);
    const after = applyPlan(s, p);
    expect(after.props.p6?.level).toBe(5);
    expect([after.props.p1?.level, after.props.p3?.level]).toEqual([1, 1]);
  });

  it('follows the phases: no building during a debt, but selling and mortgaging are open', () => {
    const s = game();
    own(s, 's0', LIGHT_BLUE, 1);
    s.phase = { k: 'debt', debtor: 's0', owed: { bank: 500 }, why: 'tax', resume: { k: 'postRoll' } };
    expect(stepProblem(s, 's0', EMPTY_PLAN, 6, 1)).toBe('You can build before or after rolling');
    expect(stepProblem(s, 's0', EMPTY_PLAN, 6, -1)).toBeNull();
    own(s, 's0', [READING], 0, true);
    expect(mortgageProblem(s, 's0', EMPTY_PLAN, READING)).toBe('You can lift mortgages before or after rolling');
  });

  it('keeps what is left after a partial apply', () => {
    const s = game();
    own(s, 's0', LIGHT_BLUE);
    own(s, 's0', [READING]);
    let p = stepLevel(s, 's0', EMPTY_PLAN, 6, 1);
    p = toggleMortgage(s, 's0', p, READING);
    const [first] = planActions(s, 's0', p);
    expect(first).toEqual({ k: 'mortgage', space: READING });
    const after = act(s, 's0', first!).state;
    const rest = normalizePlan(after, 's0', p);
    expect(rest.mortgage).toEqual({});
    expect(rest.levels).toEqual({ lightBlue: [1, 0, 0] });
  });
});
