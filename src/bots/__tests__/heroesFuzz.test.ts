import { describe, expect, it } from 'vitest';
import { HEROES } from '../../rules';
import { variedRules } from '../../rules/randomPlayer';
import { type ArenaSkill, playGame, rng } from '../arena';

/*
 * Bot-only Hero League games through the engine with invariants checked after every command: 2 to 6 seats, every
 * skill (and now and then a random player), heroes shuffled game by game, rich and poor starts. Every decision must be
 * the bot's own and accepted, and every game must end with every location saved (bots never resign).
 */

const GAMES = 30;
const SEATS: ArenaSkill[] = ['easy', 'normal', 'hard', 'expert'];

describe('bot fuzz: bots of every skill play legal Hero League games to the end', () => {
  for (let i = 0; i < GAMES; i++) {
    it(`game ${i}`, () => {
      const seed = 9000 + i;
      const players = 2 + (i % 5);
      const heroes = HEROES.heroes!.list.map((h) => h.id);
      const r0 = rng(seed);
      for (let k = heroes.length - 1; k > 0; k--) {
        const x = Math.floor(r0() * (k + 1));
        [heroes[k], heroes[x]] = [heroes[x] as string, heroes[k] as string];
      }
      const skills = Array.from({ length: players }, (_, k) => SEATS[(k + i) % SEATS.length] as ArenaSkill);
      if (i % 4 === 3) skills[players - 1] = 'random';
      const r = playGame({
        seed,
        players,
        skills,
        speedDie: false,
        turnLimit: 300,
        heroes: heroes.slice(0, players),
        cfg: { ...variedRules(seed), board: 'heroes', startCash: i % 2 ? 600 : 1500 },
      });
      expect(r.failures).toEqual([]);
      expect(['allSaved', 'lastStanding']).toContain(r.ended);
      expect(r.ranking).toHaveLength(players);
      expect(Object.keys(r.heroes ?? {})).toHaveLength(players);
      expect(Object.keys(r.scores ?? {})).toHaveLength(players);
    });
  }
});
