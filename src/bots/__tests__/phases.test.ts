import { describe, expect, it } from 'vitest';
import { awaiting, type Action, type GameState } from '../../rules';
import { decide, seatsToAsk, thinkMs } from '..';
import { SKILLS, act, bot, botStep, own, rig, scenario, setCash, setPos } from './helpers';

/*
 * One scenario per phase and interrupt, for every skill: the bot's own choice is legal (the helper fails on any
 * fallback or refusal) and sensible.
 */

const each = (name: string, fn: (skill: (typeof SKILLS)[number]) => void): void => {
  for (const skill of SKILLS) it(`${name} (${skill})`, () => fn(skill));
};

/** s0 throws (no doubles) and lands on `to` (3 or more), walking from up to 9 squares back */
function landOn(s: GameState, to: number): GameState {
  const from = Math.max(0, to - 9);
  setPos(s, 's0', from);
  const d = to - from;
  rig(s, d % 2 ? [(d - 1) / 2, (d + 1) / 2] : [d / 2 - 1, d / 2 + 1]);
  return act(s, 's0', { k: 'roll' });
}

describe('turn phases', () => {
  each('preRoll: rolls', (skill) => {
    const s = scenario(3);
    expect(bot(s, 's0', skill)).toEqual({ k: 'roll' });
  });

  each('jail: leaves early in the opening, by card when it holds one', (skill) => {
    const s = scenario(2);
    setPos(s, 's0', 10);
    s.players.s0!.jail = { tries: 0 };
    expect(bot(s, 's0', skill).k).toBe('payFine');
    s.decks.chance = s.decks.chance.filter((id) => id !== 'ch-goojf');
    s.players.s0!.goojf = ['ch-goojf'];
    expect(bot(s, 's0', skill)).toEqual({ k: 'useCard', card: 'ch-goojf' });
  });

  each('jail: stays and rolls once rivals have built (easy: when poor)', (skill) => {
    const s = scenario(2);
    setPos(s, 's0', 10);
    s.players.s0!.jail = { tries: 1 };
    own(s, 's1', [16, 18, 19, 21, 23, 24], { level: 3 }); // two built-up sets: one is a coin flip for Expert's short rollouts
    own(s, 's1', [26, 27, 29, 31, 32, 34, 37, 39, 5, 15, 25, 35]);
    if (skill === 'easy') setCash(s, 's0', 250);
    expect(bot(s, 's0', skill)).toEqual({ k: 'roll' });
  });

  each('jail: must roll on the third try with no card', (skill) => {
    const s = scenario(2);
    setPos(s, 's0', 10);
    s.players.s0!.jail = { tries: 2 };
    expect(bot(s, 's0', skill)).toEqual({ k: 'roll' });
  });

  each('buy: buys an affordable property early on', (skill) => {
    let s = scenario(2);
    s = landOn(s, 6);
    expect(s.phase.k).toBe('buy');
    // Easy buys about 80% of the time: its rnd here is 0.5
    expect(bot(s, 's0', skill)).toEqual({ k: 'buy' });
  });

  each('buy: declines what it cannot afford (and the auction follows)', (skill) => {
    let s = scenario(2);
    setCash(s, 's0', 30);
    s = landOn(s, 6);
    const a = bot(s, 's0', skill);
    expect(a).toEqual({ k: 'decline' });
    s = act(s, 's0', a);
    expect(s.phase.k).toBe('auction');
  });

  it('buy: Hard mortgages lone property to complete a set it cannot quite afford', () => {
    let s = scenario(2);
    own(s, 's0', [6, 8, 12]);
    setCash(s, 's0', 80);
    s = landOn(s, 9);
    expect(s.phase.k).toBe('buy');
    const a = bot(s, 's0', 'hard');
    expect(a).toEqual({ k: 'mortgage', space: 12 });
    s = act(s, 's0', a);
    expect(bot(s, 's0', 'hard')).toEqual({ k: 'buy' });
  });

  each('income tax: picks the cheaper option', (skill) => {
    let s = scenario(2);
    setCash(s, 's0', 1000);
    s = landOn(s, 4);
    expect(s.phase.k).toBe('incomeTax');
    // Easy is sloppy a quarter of the time; with rnd 0.5 it computes
    expect(bot(s, 's0', skill)).toEqual({ k: 'incomeTax', pick: 'percent' });
  });

  each('bus: never takes the bus to Go To Jail when another move is safe', (skill) => {
    let s = scenario(2, { speedDie: true });
    s.players.s0!.speed = true;
    setPos(s, 's0', 25);
    rig(s, [1, 5, 'bus']);
    s = act(s, 's0', { k: 'roll' });
    expect(s.phase).toMatchObject({ k: 'bus', opts: [1, 5, 6] });
    const a = bot(s, 's0', skill);
    expect(a.k).toBe('bus');
    expect(a).not.toEqual({ k: 'bus', n: 5 });
  });

  each('triples: picks a legal space, not an opponent hotel', (skill) => {
    let s = scenario(2, { speedDie: true });
    s.players.s0!.speed = true;
    own(s, 's1', [37, 39], { level: 5 });
    rig(s, [2, 2, 2]);
    s = act(s, 's0', { k: 'roll' });
    expect(s.phase.k).toBe('chooseSpace');
    const a = bot(s, 's0', skill);
    expect(a.k).toBe('chooseSpace');
    if (a.k === 'chooseSpace') expect([37, 39]).not.toContain(a.space);
  });

  each('postRoll: ends the turn when there is nothing to do', (skill) => {
    let s = scenario(2);
    s = landOn(s, 10); // Just Visiting
    expect(s.phase.k).toBe('postRoll');
    expect(bot(s, 's0', skill)).toEqual({ k: 'endTurn' });
  });

  each('postRoll: builds evenly on a complete set, then ends the turn', (skill) => {
    let s = scenario(2);
    own(s, 's0', [16, 18, 19]);
    setCash(s, 's0', 2500);
    s = landOn(s, 10);
    const a = bot(s, 's0', skill);
    expect(a.k).toBe('build');
    if (a.k !== 'build') return;
    expect(a.group).toBe('orange');
    expect(Math.max(...a.levels) - Math.min(...a.levels)).toBeLessThanOrEqual(1);
    for (let i = 0; i < 30 && s.phase.k === 'postRoll'; i++) {
      const next = bot(s, 's0', skill);
      s = act(s, 's0', next);
      if (next.k === 'endTurn') break;
    }
    expect(s.turn.seat).toBe('s1');
    expect(s.props.p16?.level).toBeGreaterThan(0);
  });

  it('postRoll: Normal lifts a mortgage in its set first, and never builds into its reserve', () => {
    let s = scenario(2);
    own(s, 's0', [16, 18]);
    own(s, 's0', [19], { mortgaged: true });
    setCash(s, 's0', 700);
    s = landOn(s, 10);
    expect(bot(s, 's0', 'normal')).toEqual({ k: 'unmortgage', space: 19 });
  });

  it('postRoll: Hard holds at 4 houses while a rival could still build', () => {
    let s = scenario(2);
    own(s, 's0', [16, 18, 19], { level: 4 });
    own(s, 's1', [1, 3]);
    setCash(s, 's0', 5000);
    s = landOn(s, 10);
    expect(bot(s, 's0', 'hard')).toEqual({ k: 'endTurn' });
    expect(bot(s, 's0', 'normal').k).toBe('build');
  });
});

describe('interrupts', () => {
  each('auction: bids below its limit in small steps, passes above it, never bids against itself', (skill) => {
    let s = scenario(2);
    setCash(s, 's0', 30);
    s = landOn(s, 6);
    s = act(s, 's0', { k: 'decline' });
    const a = bot(s, 's1', skill);
    expect(a.k).toBe('bid');
    if (a.k !== 'bid') return;
    expect(a.amount).toBeLessThanOrEqual(100);
    s = act(s, 's1', a);
    // The high bidder is not awaited and has nothing to do
    expect(decide(s, 's1', skill, () => 0.5)).toBeNull();
    // s0 (cash 30) cannot beat it and is passed by the engine, or passes
    if (s.phase.k === 'auction') s = act(s, 's0', { k: 'pass' });
    expect(s.props.p6?.owner).toBe('s1');
    // Way above its limit: pass
    let t = scenario(2);
    setCash(t, 's0', 1000);
    t = landOn(t, 6);
    t = act(t, 's0', { k: 'decline' });
    t = act(t, 's0', { k: 'bid', amount: 400 });
    expect(bot(t, 's1', skill)).toEqual({ k: 'pass' });
  });

  each('debt: mortgages lone property first, then sells houses evenly, then mortgages the set', (skill) => {
    let s = scenario(2);
    own(s, 's1', [37, 39], { level: 2 });
    own(s, 's0', [16, 18, 19], { level: 1 });
    own(s, 's0', [5]);
    setCash(s, 's0', 100);
    setPos(s, 's0', 35);
    rig(s, [1, 3]);
    s = act(s, 's0', { k: 'roll' });
    expect(s.phase).toMatchObject({ k: 'debt', owed: { s1: 600 } });
    expect(bot(s, 's0', skill)).toEqual({ k: 'mortgage', space: 5 });
    s = act(s, 's0', { k: 'mortgage', space: 5 });
    for (let i = 0; i < 3; i++) {
      const sell = bot(s, 's0', skill);
      expect(sell.k).toBe('sell');
      s = act(s, 's0', sell);
    }
    expect(bot(s, 's0', skill).k).toBe('mortgage');
    let guard = 0;
    while (s.phase.k === 'debt' && guard++ < 10) s = botStep(s, 's0', skill);
    expect(s.players.s0?.out).toBeUndefined();
    expect(s.players.s1?.cash).toBe(1500 + 600);
  });

  each('debt: goes bankrupt at once when even everything cannot cover it', (skill) => {
    let s = scenario(2);
    own(s, 's1', [37, 39], { level: 5 });
    own(s, 's0', [5]);
    setCash(s, 's0', 100);
    setPos(s, 's0', 35);
    rig(s, [1, 3]);
    s = act(s, 's0', { k: 'roll' });
    expect(s.phase.k).toBe('debt');
    expect(bot(s, 's0', skill)).toEqual({ k: 'bankrupt' });
  });

  each('debt: raises just what it needs and the game goes on', (skill) => {
    let s = scenario(2);
    own(s, 's1', [39]);
    own(s, 's1', [37]);
    own(s, 's0', [1, 3, 5, 12]);
    setCash(s, 's0', 50);
    setPos(s, 's0', 35);
    rig(s, [1, 3]);
    s = act(s, 's0', { k: 'roll' });
    expect(s.phase.k).toBe('debt');
    let guard = 0;
    while (s.phase.k === 'debt' && guard++ < 10) s = botStep(s, 's0', skill);
    expect(s.players.s0?.out).toBeUndefined();
    expect(s.phase.k).not.toBe('debt');
    // The set of browns is mortgaged last
    expect(s.props.p1?.mortgaged).toBeUndefined();
  });

  each('mortgageXfer: lifts received mortgages it can comfortably afford', (skill) => {
    let s = scenario(2);
    own(s, 's1', [5], { mortgaged: true });
    setCash(s, 's0', 3000);
    s = act(s, 's1', { k: 'propose', to: 's0', give: { cash: 0, props: [5], cards: [] }, get: { cash: 10, props: [], cards: [] } });
    const id = Object.keys(s.trades)[0] as string;
    s = act(s, 's0', { k: 'accept', id });
    expect(s.phase.k).toBe('mortgageXfer');
    const a = bot(s, 's0', skill);
    expect(a).toEqual({ k: 'settleMortgages', lift: skill === 'easy' ? [] : [5] });
  });

  each('building contest: asks for houses when it wants them, places them on its best street', (skill) => {
    let s = scenario(2, { houses: 4 });
    own(s, 's0', [37, 39]);
    own(s, 's1', [16, 18, 19]);
    setCash(s, 's0', 3000);
    setCash(s, 's1', 3000);
    s = act(s, 's0', { k: 'build', group: 'darkBlue', levels: [2, 2] });
    expect(s.phase.k).toBe('buildClaim');
    expect(awaiting(s)).toEqual(['s1']);
    const a = bot(s, 's1', skill);
    expect(a.k).toBe('requestBuild');
    s = act(s, 's1', a);
    let guard = 0;
    while (s.phase.k !== 'preRoll' && guard++ < 300) {
      const seat = awaiting(s)[0];
      if (!seat) break;
      s = botStep(s, seat, skill);
    }
    expect(s.phase.k).toBe('preRoll');
    expect(s.bank.houses).toBeGreaterThanOrEqual(0);
  });

  each('building contest: passes with no cash to spare', (skill) => {
    let s = scenario(2, { houses: 4 });
    own(s, 's0', [37, 39]);
    own(s, 's1', [1, 3]);
    setCash(s, 's0', 3000);
    setCash(s, 's1', skill === 'easy' ? 450 : 60);
    s = act(s, 's0', { k: 'build', group: 'darkBlue', levels: [2, 2] });
    expect(s.phase.k).toBe('buildClaim');
    expect(bot(s, 's1', skill)).toEqual({ k: 'pass' });
  });
});

describe('trades', () => {
  const offer = (s: GameState, a: Extract<Action, { k: 'propose' }>, by = 's1' as const): GameState => act(s, by, a);

  each('accepts an offer that clearly favours it and rejects a bad one', (skill) => {
    let s = scenario(2);
    own(s, 's1', [1]);
    own(s, 's0', [12]);
    s = offer(s, { k: 'propose', to: 's0', give: { cash: 400, props: [], cards: [] }, get: { cash: 0, props: [12], cards: [] } });
    const id = Object.keys(s.trades)[0] as string;
    expect(bot(s, 's0', skill)).toEqual({ k: 'accept', id });
    let t = scenario(2);
    own(t, 's0', [16, 18]);
    own(t, 's1', [19]);
    t = offer(t, { k: 'propose', to: 's0', give: { cash: 10, props: [], cards: [] }, get: { cash: 0, props: [16, 18], cards: [] } });
    const id2 = Object.keys(t.trades)[0] as string;
    expect(bot(t, 's0', skill)).toEqual({ k: 'reject', id: id2 });
  });

  each('answers an offer even when the game is not waiting for it', (skill) => {
    let s = scenario(3);
    own(s, 's2', [12]);
    s = offer(s, { k: 'propose', to: 's2', give: { cash: 500, props: [], cards: [] }, get: { cash: 0, props: [12], cards: [] } });
    expect(awaiting(s)).toEqual(['s0']);
    expect(seatsToAsk(s)).toEqual(['s2', 's0']);
    expect(bot(s, 's2', skill).k).toBe('accept');
  });

  it('Hard proposes a set-completing deal at the start of its turn, once', () => {
    let s = scenario(2);
    own(s, 's0', [37, 6, 8]);
    own(s, 's1', [39, 9, 1]);
    const a = bot(s, 's0', 'hard');
    expect(a.k).toBe('propose');
    if (a.k !== 'propose') return;
    expect(a.to).toBe('s1');
    expect(a.get.props.some((x) => x === 39 || x === 9)).toBe(true);
    s = act(s, 's0', a);
    // Offers never block play: the bot rolls on while the receiver thinks
    expect(bot(s, 's0', 'hard')).toEqual({ k: 'roll' });
    const id = Object.keys(s.trades)[0] as string;
    s = act(s, 's1', { k: 'reject', id });
    expect(bot(s, 's0', 'hard')).toEqual({ k: 'roll' });
  });

  it('Normal proposes only swaps that complete a set for both sides; Easy never proposes', () => {
    const s = scenario(2);
    own(s, 's0', [37, 6, 8]);
    own(s, 's1', [39, 9]);
    const a = bot(s, 's0', 'normal');
    expect(a.k).toBe('propose');
    if (a.k === 'propose') expect([...a.give.props].sort()).toEqual([37]);
    expect(bot(s, 's0', 'easy')).toEqual({ k: 'roll' });
  });

  it('a bot neither awaited nor offered anything does nothing', () => {
    const s = scenario(3);
    for (const skill of SKILLS) expect(decide(s, 's1', skill, () => 0.5)).toBeNull();
    expect(decide({ ...s, phase: { k: 'over', winner: 's0', ranking: ['s0', 's1', 's2'], why: 'endGame' } }, 's0', 'hard', () => 0.5)).toBeNull();
  });
});

describe('expert search', () => {
  it('buys the missing street of a set at a price the other bots accept, and will not sell its own that way', () => {
    let s = scenario(2);
    own(s, 's0', [16, 18]);
    own(s, 's1', [19, 5]);
    const a = bot(s, 's0', 'expert');
    expect(a).toMatchObject({ k: 'propose', to: 's1', get: { props: [19] } });
    if (a.k !== 'propose') return;
    expect(a.give.cash).toBeGreaterThan(200);
    s = act(s, 's0', a);
    const id = Object.keys(s.trades)[0] as string;
    for (const skill of ['easy', 'normal', 'hard'] as const) expect(bot(s, 's1', skill)).toEqual({ k: 'accept', id });
    expect(bot(s, 's1', 'expert')).toEqual({ k: 'reject', id });
  });

  it('answers the same however warm its memo is', () => {
    let a = scenario(2);
    own(a, 's0', [16, 18, 19, 5]);
    setCash(a, 's0', 900);
    a = landOn(a, 10);
    expect(a.phase.k).toBe('postRoll');
    const b = scenario(2);
    own(b, 's0', [37, 39]);
    const first = decide(a, 's0', 'expert', () => 0.5);
    decide(b, 's0', 'expert', () => 0.5);
    expect(decide(a, 's0', 'expert', () => 0.5)).toEqual(first);
    expect(first?.k).toBe('build');
  });
});

describe('contract', () => {
  it('is pure: the same inputs give the same action', () => {
    let s = scenario(4);
    own(s, 's1', [16, 18]);
    s = landOn(s, 19);
    for (const skill of SKILLS) {
      const r1 = (() => { let x = 7; return () => ((x = (x * 9301 + 49297) % 233280) / 233280); })();
      const r2 = (() => { let x = 7; return () => ((x = (x * 9301 + 49297) % 233280) / 233280); })();
      expect(decide(s, 's0', skill, r1)).toEqual(decide(s, 's0', skill, r2));
    }
  });

  it('thinks faster at higher skill', () => {
    expect(thinkMs('easy')).toBeGreaterThan(thinkMs('hard'));
    expect(thinkMs('expert')).toBeGreaterThan(0);
  });
});
