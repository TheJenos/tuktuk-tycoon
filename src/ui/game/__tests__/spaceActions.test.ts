import { describe, expect, it } from 'vitest';
import type { Action, GameState } from '../../../rules';
import { spaceActions } from '../manage/spaceActions';
import { act, game, own } from './helpers';

const LIGHT_BLUE = [6, 8, 9]; // Oriental, Vermont, Connecticut: houses 50
const READING = 5;
const ELECTRIC = 12;

/** Sends the action (which must be there) through the engine */
function run(s: GameState, a: Action | null | undefined): GameState {
  expect(a).toBeTruthy();
  return act(s, 's0', a!).state;
}

describe('spaceActions', () => {
  it('sells a property back to the bank: the mortgage value, nothing when mortgaged; not with buildings in the group', () => {
    let s = game();
    own(s, 's0', [READING]);
    own(s, 's0', [ELECTRIC], 0, true);
    own(s, 's0', LIGHT_BLUE, 1);
    expect(spaceActions(s, 's0', READING)!.sale).toEqual({ mortgaged: false, amount: 100, reason: null, action: { k: 'sellProperty', space: READING } });
    expect(spaceActions(s, 's0', ELECTRIC)!.sale).toMatchObject({ mortgaged: true, amount: 0, action: { k: 'sellProperty', space: ELECTRIC } });
    expect(spaceActions(s, 's0', 8)!.sale).toMatchObject({ action: null, reason: 'Sell the buildings in the Light Blue group first' });
    const cash = s.players.s0!.cash;
    s = run(s, spaceActions(s, 's0', READING)!.sale.action);
    expect(s.props[`p${READING}`]).toBeUndefined();
    expect(s.players.s0!.cash).toBe(cash + 100);
    expect(spaceActions(s, 's0', READING)).toBeNull();
  });

  it('builds one house on exactly this street, evenly, through the engine', () => {
    let s = game();
    own(s, 's0', LIGHT_BLUE);
    const x = spaceActions(s, 's0', 6)!;
    expect(x.build).toMatchObject({ kind: 'house', amount: 50, reason: null, action: { k: 'build', group: 'lightBlue', levels: [1, 0, 0] } });
    expect(x.sell).toBeUndefined();
    const cash = s.players.s0!.cash;
    s = run(s, x.build?.action);
    expect(s.props.p6?.level).toBe(1);
    expect(s.players.s0!.cash).toBe(cash - 50);
    // Again on the same street: uneven, so it names the street to build on first
    const again = spaceActions(s, 's0', 6)!;
    expect(again.build?.action).toBeNull();
    expect(again.build?.reason).toBe('Build evenly: Hoppers Corner first');
    // The others can go up, and the first can be sold back
    expect(spaceActions(s, 's0', 8)!.build?.action).toEqual({ k: 'build', group: 'lightBlue', levels: [1, 1, 0] });
    expect(spaceActions(s, 's0', 6)!.sell).toMatchObject({ kind: 'house', amount: 25, action: { k: 'sell', group: 'lightBlue', levels: [0, 0, 0] } });
  });

  it('needs the whole set, unmortgaged', () => {
    const s = game();
    own(s, 's0', [6, 8]);
    expect(spaceActions(s, 's0', 6)!.build).toMatchObject({ action: null, reason: 'Own the whole colour group to build' });
    own(s, 's0', [9], 0, true);
    expect(spaceActions(s, 's0', 6)!.build).toMatchObject({ action: null, reason: 'Lift every mortgage in the group first' });
  });

  it('steps up to a hotel, and sells the hotel back', () => {
    let s = game();
    own(s, 's0', LIGHT_BLUE, 4);
    const x = spaceActions(s, 's0', 9)!;
    expect(x.build).toMatchObject({ kind: 'hotel', amount: 50, action: { k: 'build', group: 'lightBlue', levels: [4, 4, 5] } });
    s = run(s, x.build?.action);
    expect(s.props.p9?.level).toBe(5);
    const top = spaceActions(s, 's0', 9)!;
    expect(top.build).toBeUndefined();
    expect(top.sell).toMatchObject({ kind: 'hotel', amount: 25 });
    // Selling unevenly is refused with the street to sell first
    expect(spaceActions(s, 's0', 6)!.sell).toMatchObject({ action: null, reason: 'Sell evenly: Kiribath Junction first' });
    s = run(s, top.sell?.action);
    expect(s.props.p9?.level).toBe(4);
  });

  it('says when the bank has run out, or the cash is short', () => {
    const s = game();
    own(s, 's0', LIGHT_BLUE);
    s.bank.houses = 0;
    expect(spaceActions(s, 's0', 6)!.build).toMatchObject({ action: null, reason: 'The bank has no houses left' });
    s.bank.houses = 10;
    s.players.s0!.cash = 10;
    expect(spaceActions(s, 's0', 6)!.build?.action).toBeNull();
    expect(spaceActions(s, 's0', 6)!.build?.reason).toMatch(/^Building costs Rs\. 5,000/);
  });

  it('mortgages and lifts through the engine', () => {
    let s = game();
    own(s, 's0', [READING, ELECTRIC]);
    const m = spaceActions(s, 's0', READING)!;
    expect(m.build).toBeUndefined();
    expect(m.mortgage).toMatchObject({ kind: 'mortgage', amount: 100, action: { k: 'mortgage', space: READING } });
    s = run(s, m.mortgage.action);
    expect(s.props[`p${READING}`]?.mortgaged).toBe(true);
    const u = spaceActions(s, 's0', READING)!;
    expect(u.mortgage).toMatchObject({ kind: 'unmortgage', amount: 110, action: { k: 'unmortgage', space: READING } });
    s = run(s, u.mortgage.action);
    expect(s.props[`p${READING}`]?.mortgaged).toBeUndefined();
    // Not under buildings
    own(s, 's0', LIGHT_BLUE, 1);
    expect(spaceActions(s, 's0', 6)!.mortgage).toMatchObject({ action: null, reason: "Sell the group's buildings first" });
  });

  it('is nothing for property that is not mine', () => {
    const s = game();
    own(s, 's1', LIGHT_BLUE);
    expect(spaceActions(s, 's0', 6)).toBeNull();
    expect(spaceActions(s, 's0', 1)).toBeNull();
    expect(spaceActions(s, 's0', 0)).toBeNull();
  });

  it('follows the phases: no building or lifting during a debt, but selling and mortgaging are open', () => {
    const s = game();
    own(s, 's0', LIGHT_BLUE, 1);
    own(s, 's0', [READING], 0, true);
    s.phase = { k: 'debt', debtor: 's0', owed: { bank: 500 }, why: 'tax', resume: { k: 'postRoll' } };
    const x = spaceActions(s, 's0', 6)!;
    expect(x.build).toMatchObject({ action: null, reason: 'You can build before or after rolling' });
    expect(x.sell?.action).toEqual({ k: 'sell', group: 'lightBlue', levels: [0, 1, 1] });
    expect(spaceActions(s, 's0', READING)!.mortgage).toMatchObject({ action: null, reason: 'You can lift mortgages before or after rolling' });
    run(s, x.sell?.action);
  });
});
