import { describe, expect, it } from 'vitest';
import type { GameState } from '../../rules';
import { SKILLS, act, bot, own, rig, scenario, setCash, setPos } from './helpers';

/*
 * The bots under the optional room rules: every choice is their own and legal (bot() fails on a fallback or a
 * refusal) and follows the rule.
 */

/** s0 and s1 each hold what the other needs for a set (Hard and Expert propose a swap here by default) */
function swap(cfg: Parameters<typeof scenario>[1]): GameState {
  const s = scenario(2, cfg);
  own(s, 's0', [37, 6, 8]);
  own(s, 's1', [39, 9, 1]);
  return s;
}

describe('bots and the optional rules', () => {
  it('no proposals while trading is off or not yet open for the bot', () => {
    for (const skill of ['normal', 'hard', 'expert'] as const) {
      expect(bot(swap({}), 's0', skill).k).toBe('propose');
      expect(bot(swap({ trading: 'off' }), 's0', skill)).toEqual({ k: 'roll' });
      expect(bot(swap({ trading: 'afterLap', tradeAfterLap: 1 }), 's0', skill)).toEqual({ k: 'roll' });
    }
  });

  it('Income Tax follows a fixed mode (a safeguard: the phase does not come up then)', () => {
    for (const skill of SKILLS) {
      const s = scenario(2);
      setPos(s, 's0', 1);
      rig(s, [1, 2]);
      const t = act(s, 's0', { k: 'roll' });
      expect(t.phase.k).toBe('incomeTax');
      t.cfg.incomeTaxMode = 'percent';
      setCash(t, 's0', 5000);
      expect(bot(t, 's0', skill)).toEqual({ k: 'incomeTax', pick: 'percent' });
    }
  });

  it('a big jackpot draws a triple to the Tuk-Tuk Stand', () => {
    for (const skill of ['normal', 'hard', 'expert'] as const) {
      const s = scenario(2, { speedDie: true, jackpot: true });
      s.players.s0!.speed = true;
      s.players.s0!.laps = 1;
      s.pot = 2000;
      rig(s, [2, 2, 2]);
      const t = act(s, 's0', { k: 'roll' });
      expect(t.phase.k).toBe('chooseSpace');
      expect(bot(t, 's0', skill)).toEqual({ k: 'chooseSpace', space: 20 });
    }
  });

  it('Normal buys with less cash in hand when declining would not start an auction', () => {
    const at = (auctions: boolean): GameState => {
      const s = scenario(2, { auctions });
      own(s, 's1', [37, 39], { level: 3 });
      setCash(s, 's0', 450);
      setPos(s, 's0', 21);
      rig(s, [1, 2]);
      return act(s, 's0', { k: 'roll' });
    };
    expect(at(true).phase).toEqual({ k: 'buy', space: 24 });
    expect(bot(at(true), 's0', 'normal')).toEqual({ k: 'decline' });
    expect(bot(at(false), 's0', 'normal')).toEqual({ k: 'buy' });
  });
});
